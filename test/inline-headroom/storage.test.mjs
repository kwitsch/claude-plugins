import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { MIGRATIONS, PROTOCOL, execOp, isStorageEnabled, migrate, resolveStorage } from "../../plugins/inline-headroom/mcp/server.mjs";

const SERVER = fileURLToPath(new URL("../../plugins/inline-headroom/mcp/server.mjs", import.meta.url));
const IT = { timeout: 30000 };

// ------------------------------------------------------------------ unit

test("isStorageEnabled is fail-closed: only the trimmed literal true enables", () => {
  assert.equal(isStorageEnabled("true"), true);
  assert.equal(isStorageEnabled(" true "), true);
  for (const value of ["false", "", undefined, "TRUE", "${user_config.storage_enabled}"]) {
    assert.equal(isStorageEnabled(value), false, String(value));
  }
});

test("resolveStorage joins the three files under the data dir and refuses unusable values", () => {
  assert.deepEqual(resolveStorage(" /data/ih "), { dataDir: "/data/ih", db: "/data/ih/storage.db", sock: "/data/ih/storage.sock", log: "/data/ih/service.log" });
  for (const value of [undefined, "", "   ", "${CLAUDE_PLUGIN_DATA}"]) {
    assert.throws(() => resolveStorage(value), /CLAUDE_PLUGIN_DATA/, String(value));
  }
  assert.throws(() => resolveStorage("/" + "d".repeat(100)), /too long/);
});

test("migrate brings a fresh DB to MIGRATIONS.length, is idempotent and refuses a newer schema", () => {
  const db = new DatabaseSync(":memory:");
  assert.equal(migrate(db), MIGRATIONS.length);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, MIGRATIONS.length);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kv'").get());
  assert.equal(migrate(db), MIGRATIONS.length);
  db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
  assert.throws(() => migrate(db), /newer/);
  db.close();
});

test("execOp round-trips set/get/overwrite/delete and rejects invalid keys, values and ops", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  assert.deepEqual(execOp(db, "kv_set", { key: "stats/s1", value: { a: [1, "x"] } }), { ok: true });
  assert.deepEqual(execOp(db, "kv_get", { key: "stats/s1" }), { found: true, value: { a: [1, "x"] } });
  assert.deepEqual(execOp(db, "kv_set", { key: "stats/s1", value: 7 }), { ok: true });
  assert.deepEqual(execOp(db, "kv_get", { key: "stats/s1" }), { found: true, value: 7 });
  assert.deepEqual(execOp(db, "kv_delete", { key: "stats/s1" }), { deleted: true });
  assert.deepEqual(execOp(db, "kv_delete", { key: "stats/s1" }), { deleted: false });
  assert.deepEqual(execOp(db, "kv_get", { key: "stats/s1" }), { found: false });
  assert.throws(() => execOp(db, "kv_get", { key: "" }), /key must be/);
  assert.throws(() => execOp(db, "kv_get", { key: "k".repeat(513) }), /key must be/);
  // lone surrogates would collapse onto U+FFFD in SQLite; a valid astral pair is fine
  assert.throws(() => execOp(db, "kv_set", { key: "\ud800", value: 1 }), /key must be/);
  assert.throws(() => execOp(db, "kv_get", { key: "a\udfff" }), /key must be/);
  assert.deepEqual(execOp(db, "kv_set", { key: "😀", value: 1 }), { ok: true });
  // maxLength counts code points (as in the advertised JSON Schema), not UTF-16 units
  assert.deepEqual(execOp(db, "kv_set", { key: "😀".repeat(512), value: 1 }), { ok: true });
  assert.throws(() => execOp(db, "kv_get", { key: "😀".repeat(513) }), /key must be/);
  assert.throws(() => execOp(db, "kv_set", { key: "k", value: undefined }), /value must be/);
  assert.throws(() => execOp(db, "kv_set", { key: "k", value: "x".repeat(1048576) }), /value must be/);
  assert.throws(() => execOp(db, "kv_list", { key: "k" }), /unknown op: kv_list/);
  db.close();
});

// ------------------------------------------------------------------ integration helpers

/**
 * Pids of every `--service` process for this data dir (pgrep exits 1 when none match).
 * @param {string} dir
 * @returns {number[]}
 */
function servicePids(dir) {
  try {
    return execFileSync("pgrep", ["-f", `mcp/server.mjs --service ${dir}`], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}

/**
 * Polls until the pid no longer exists (ESRCH).
 * @param {number} pid
 * @returns {Promise<void>}
 */
async function waitDead(pid) {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    if (Date.now() > deadline) throw new Error(`pid ${pid} still alive`);
    await sleep(25);
  }
}

/**
 * A temp CLAUDE_PLUGIN_DATA with storage enabled. Its t.after closes every front-end, kills every
 * fake, SIGTERMs every --service process for this data dir until none is left, and removes the dir.
 * @param {any} t node:test context
 */
function sandbox(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ih-"));
  /** @type {Record<string, string|undefined>} */
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: dir, INLINE_HEADROOM_STORAGE_ENABLED: "true" };
  /** @type {any[]} */
  const fronts = [];
  /** @type {any[]} */
  const fakes = [];
  t.after(async () => {
    for (const fe of fronts) fe.stdin.end();
    for (const fake of fakes) fake.kill("SIGTERM");
    const deadline = Date.now() + 5000;
    for (let pids = servicePids(dir); pids.length > 0 && Date.now() < deadline; pids = servicePids(dir)) {
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          /* ESRCH: already gone */
        }
      }
      await sleep(50);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Spawns one MCP front-end. `request` sends a JSON-RPC request and resolves with its response
   * (or with `{error}` once the front-end has exited); `call` runs tools/call and resolves with the result.
   * @param {Record<string, string|undefined>} [feEnv]
   */
  const frontEnd = (feEnv = env) => {
    const proc = spawn(process.execPath, [SERVER], { env: feEnv, stdio: ["pipe", "pipe", "inherit"] });
    fronts.push(proc);
    /** @type {Map<number, (msg: any) => void>} */
    const pending = new Map();
    let nextId = 1;
    let closed = false;
    readline.createInterface({ input: proc.stdout }).on("line", (/** @type {string} */ line) => {
      const msg = JSON.parse(line);
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    });
    proc.stdin.on("error", () => {}); // EPIPE once the front-end is gone; its pending requests fail below
    proc.on("close", (/** @type {number|null} */ code) => {
      closed = true;
      for (const resolve of pending.values()) resolve({ error: { message: `front-end exited with code ${code}` } });
      pending.clear();
    });
    /** @param {string} method @param {any} [params] @returns {Promise<any>} */
    const request = (method, params) =>
      new Promise((resolve) => {
        if (closed) return resolve({ error: { message: "front-end exited" } });
        const id = nextId++;
        pending.set(id, resolve);
        proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    /** @param {string} name @param {Record<string, unknown>} [args] @returns {Promise<any>} */
    const call = async (name, args = {}) => (await request("tools/call", { name, arguments: args })).result;
    return { request, call };
  };

  /**
   * Starts a fake service on storage.sock that answers every request with the given protocol.
   * @param {number} protocol
   * @returns {Promise<any>} the fake's ChildProcess, once it listens
   */
  const fakeService = async (protocol) => {
    const script = `
      const net = require("node:net");
      const [sock, protocol] = process.argv.slice(1);
      net.createServer((c) => c.once("data", () => c.end(JSON.stringify({ protocol: Number(protocol), pid: process.pid, error: "protocol mismatch" }) + "\\n")))
        .listen(sock, () => process.stdout.write("ready\\n"));`;
    const fake = spawn(process.execPath, ["-e", script, path.join(dir, "storage.sock"), String(protocol)], { stdio: ["ignore", "pipe", "inherit"] });
    fakes.push(fake);
    await once(fake.stdout, "data");
    return fake;
  };

  return { dir, env, sock: path.join(dir, "storage.sock"), db: path.join(dir, "storage.db"), frontEnd, fakeService };
}

// ------------------------------------------------------------------ integration

test("tools/list advertises the four tools; a value set through one front-end is read through another", IT, async (/** @type {any} */ t) => {
  const box = sandbox(t);
  const a = box.frontEnd();
  assert.equal((await a.request("initialize", { protocolVersion: "2025-11-25" })).result.serverInfo.name, "storage");
  const list = await a.request("tools/list");
  assert.deepEqual(
    list.result.tools.map((/** @type {any} */ tool) => tool.name),
    ["kv_get", "kv_set", "kv_delete", "storage_status"],
  );
  assert.deepEqual((await a.call("kv_set", { key: "stats/s1", value: { n: 1 } })).structuredContent, { ok: true });
  const b = box.frontEnd();
  assert.deepEqual((await b.call("kv_get", { key: "stats/s1" })).structuredContent, { found: true, value: { n: 1 } });
  assert.equal(typeof (await b.call("storage_status")).structuredContent.pid, "number");
});

test("five concurrent front-ends share one service that locks out every other DB reader", IT, async (/** @type {any} */ t) => {
  const box = sandbox(t);
  const results = await Promise.all(Array.from({ length: 5 }, () => box.frontEnd().call("storage_status")));
  const pids = new Set(results.map((r) => r.structuredContent.pid));
  assert.equal(pids.size, 1);
  assert.deepEqual(results[0].structuredContent, { pid: [...pids][0], protocol: PROTOCOL, schemaVersion: MIGRATIONS.length, dataDir: box.dir });
  const reader = new DatabaseSync(box.db);
  try {
    assert.throws(
      () => reader.prepare("SELECT * FROM kv").all(),
      (/** @type {any} */ e) => e.errcode === 5,
    );
  } finally {
    reader.close();
  }
});

test("a SIGKILLed service is replaced and keeps every committed write", IT, async (/** @type {any} */ t) => {
  const box = sandbox(t);
  const fe = box.frontEnd();
  await fe.call("kv_set", { key: "k", value: 42 });
  const before = (await fe.call("storage_status")).structuredContent.pid;
  process.kill(before, "SIGKILL");
  await waitDead(before);
  assert.ok(existsSync(box.sock), "the stale socket is left behind");
  assert.deepEqual((await fe.call("kv_get", { key: "k" })).structuredContent, { found: true, value: 42 });
  assert.notEqual((await fe.call("storage_status")).structuredContent.pid, before);
});

test("an older-protocol service is SIGTERMed and replaced; the request runs on the new service", IT, async (/** @type {any} */ t) => {
  const box = sandbox(t);
  const fake = await box.fakeService(PROTOCOL - 1);
  const exited = once(fake, "exit");
  const fe = box.frontEnd();
  assert.deepEqual((await fe.call("kv_get", { key: "k" })).structuredContent, { found: false });
  await exited;
  assert.equal((await fe.call("storage_status")).structuredContent.protocol, PROTOCOL);
});

test("a newer-protocol service is refused and left running", IT, async (/** @type {any} */ t) => {
  const box = sandbox(t);
  const fake = await box.fakeService(PROTOCOL + 1);
  const res = await box.frontEnd().call("kv_get", { key: "k" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /newer/);
  assert.equal(fake.exitCode, null);
  assert.doesNotThrow(() => process.kill(fake.pid, 0));
});

test("storage disabled: no tools advertised, calls refused, no files created", IT, async (/** @type {any} */ t) => {
  const box = sandbox(t);
  const fe = box.frontEnd({ ...box.env, INLINE_HEADROOM_STORAGE_ENABLED: undefined });
  assert.deepEqual((await fe.request("tools/list")).result.tools, []);
  const res = await fe.call("kv_get", { key: "k" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /disabled/);
  assert.deepEqual(readdirSync(box.dir), []);
});

test("an unresolved CLAUDE_PLUGIN_DATA is refused", IT, async (/** @type {any} */ t) => {
  const box = sandbox(t);
  const res = await box.frontEnd({ ...box.env, CLAUDE_PLUGIN_DATA: "${CLAUDE_PLUGIN_DATA}" }).call("kv_get", { key: "k" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /CLAUDE_PLUGIN_DATA/);
});
