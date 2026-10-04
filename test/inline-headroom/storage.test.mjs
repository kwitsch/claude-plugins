import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { MIGRATIONS, PROTOCOL, VERSION, compareVersions, execOp, isStorageEnabled, isStorageService, migrate, resolveStorage } from "../../plugins/inline-headroom/mcp/server.mjs";

const SERVER = fileURLToPath(new URL("../../plugins/inline-headroom/mcp/server.mjs", import.meta.url));
const IT = { timeout: 30000 };
const STATS_KEYS = ["steps", "clamped", "cache_drops", "input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"];

/**
 * Six counters in stats column order, stepping by `d` from `first`: distinct per field, so a
 * column-order drift changes every sum.
 * @param {number} first
 * @param {number} d
 * @returns {Record<string, number>}
 */
const seq = (first, d) => Object.fromEntries(STATS_KEYS.map((k, i) => [k, first + i * d]));

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
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'stats'").get());
  assert.equal(migrate(db), MIGRATIONS.length);
  db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
  assert.throws(() => migrate(db), /newer/);
  db.close();
});

test("migrate upgrades a v1 database to v2 and keeps its kv rows", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(MIGRATIONS[0]);
  db.exec("PRAGMA user_version = 1");
  db.prepare("INSERT INTO kv(key, value) VALUES (?, ?)").run("notes/s1", "42");
  assert.equal(migrate(db), 2);
  assert.deepEqual({ ...db.prepare("SELECT key, value FROM kv").get() }, { key: "notes/s1", value: "42" });
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'stats'").get());
  db.close();
});

test("stats_put replaces absolute rows per day and writer, stats_sum totals every writer from since on, the purge drops older days", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  /** @param {string} writer @param {Record<string, unknown>[]} rows @param {string} [purgeBefore] */
  const put = (writer, rows, purgeBefore = "2026-01-01") => execOp(db, "stats_put", { writer, rows, purgeBefore });
  /** @param {string} since */
  const sum = (since) => execOp(db, "stats_sum", { since });
  /** @param {string} day @param {number} base */
  const row = (day, base) => ({ day, ...seq(base + 1, 1) });
  const a = [row("2026-10-01", 0), row("2026-10-02", 10), row("2026-10-03", 100)];
  const b = [row("2026-10-01", 1000), row("2026-10-03", 10000)];
  assert.deepEqual(put("wa", a), { ok: true, purged: 0 });
  assert.deepEqual(put("wb", b), { ok: true, purged: 0 });
  assert.deepEqual(sum("2026-10-01"), seq(11115, 5));
  assert.deepEqual(sum("2026-10-02"), seq(10113, 3));
  assert.deepEqual(sum("2026-10-03"), seq(10102, 2));
  assert.deepEqual(sum("2026-10-04"), seq(0, 0));
  // idempotent: a replay changes nothing; a bigger snapshot of the same (day, writer) replaces, never adds
  put("wa", a);
  assert.deepEqual(sum("2026-10-01"), seq(11115, 5));
  put("wa", [row("2026-10-03", 200)]);
  assert.deepEqual(sum("2026-10-03"), seq(10202, 2));
  // the purge is global: every writer's rows before purgeBefore go, later ones stay
  assert.deepEqual(put("wb", [row("2026-10-03", 10000)], "2026-10-02"), { ok: true, purged: 2 });
  assert.deepEqual(sum("2026-01-01"), seq(10213, 3));
  // a counter past 2**31 round-trips unchanged
  put("wc", [{ ...row("2026-10-05", 0), steps: 3e9 }]);
  assert.equal(sum("2026-10-05").steps, 3e9);
  db.close();
});

test("stats ops validate writer, days, rows and counters before writing anything", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  const row = { day: "2026-10-03", ...seq(1, 1) };
  const ok = { writer: "w1", rows: [row], purgeBefore: "2026-09-04" };
  const missing = Object.fromEntries(Object.entries(row).filter(([k]) => k !== "cache_creation_input_tokens"));
  /** @type {[Record<string, unknown>, RegExp][]} */
  const bad = [
    [{ ...ok, writer: "" }, /writer must be/],
    [{ ...ok, writer: "a b" }, /writer must be/],
    [{ ...ok, writer: "w".repeat(65) }, /writer must be/],
    [{ ...ok, purgeBefore: "2026-1-03" }, /purgeBefore must be/],
    [{ ...ok, purgeBefore: "2026-02-30" }, /purgeBefore must be/],
    [{ ...ok, rows: "x" }, /rows must hold 1-31 rows/],
    [{ ...ok, rows: [] }, /rows must hold 1-31 rows/],
    [{ ...ok, rows: Array.from({ length: 32 }, () => row) }, /rows must hold 1-31 rows/],
    [{ ...ok, rows: [missing] }, /each row needs/],
    [{ ...ok, rows: [null] }, /each row needs/],
    [{ ...ok, rows: [[]] }, /each row needs/],
    [{ ...ok, rows: [{ ...row, steps: -1 }] }, /each row needs/],
    [{ ...ok, rows: [{ ...row, steps: 1.5 }] }, /each row needs/],
    [{ ...ok, rows: [{ ...row, steps: "7" }] }, /each row needs/],
    [{ ...ok, rows: [{ ...row, steps: 2 ** 53 }] }, /each row needs/],
    [{ ...ok, rows: [row, { ...row, day: "2026-13-45" }] }, /each row needs/],
  ];
  for (const [args, re] of bad) assert.throws(() => execOp(db, "stats_put", args), re, JSON.stringify(args).slice(0, 120));
  assert.throws(() => execOp(db, "stats_sum", { since: "2026-02-30" }), /since must be/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM stats").get().n, 0); // a failed validation wrote nothing
  // stats ops need no key; kv ops still do; a non-string op is an unknown op, not a TypeError
  assert.deepEqual(execOp(db, "stats_put", ok), { ok: true, purged: 0 });
  assert.throws(() => execOp(db, "kv_get", {}), /key must be/);
  assert.throws(() => execOp(db, /** @type {any} */ (7), {}), /unknown op: 7/);
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

test("VERSION comes from plugin.json and compareVersions orders dotted versions numerically", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../plugins/inline-headroom/.claude-plugin/plugin.json", import.meta.url), "utf8"));
  assert.equal(VERSION, manifest.version);
  assert.ok(compareVersions("0.2.0", "0.10.0") < 0);
  assert.ok(compareVersions("1.0.0", "0.9.9") > 0);
  assert.equal(compareVersions("1.2", "1.2.0"), 0);
  assert.equal(compareVersions(undefined, "0.0.0"), 0);
});

test("isStorageService refuses insane pids and processes that are not a server.mjs --service", () => {
  for (const pid of [undefined, "5", 0, 1, -3, 1.5, NaN]) assert.equal(isStorageService(pid), false, String(pid));
  assert.equal(isStorageService(process.pid), !existsSync("/proc/self/cmdline")); // the test runner is no service
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
    // Looks like a real service to isStorageService: a server.mjs run with --service.
    const script = `
      import net from "node:net";
      const [, , , sock, protocol] = process.argv;
      net.createServer((c) => c.once("data", () => c.end(JSON.stringify({ protocol: Number(protocol), pid: process.pid, error: "protocol mismatch" }) + "\\n")))
        .listen(sock, () => process.stdout.write("ready\\n"));`;
    mkdirSync(path.join(dir, "fake"), { recursive: true });
    writeFileSync(path.join(dir, "fake", "server.mjs"), script);
    const fake = spawn(process.execPath, [path.join(dir, "fake", "server.mjs"), "--service", path.join(dir, "storage.sock"), String(protocol)], { stdio: ["ignore", "pipe", "inherit"] });
    fakes.push(fake);
    await once(fake.stdout, "data");
    return fake;
  };

  return { dir, env, sock: path.join(dir, "storage.sock"), db: path.join(dir, "storage.db"), frontEnd, fakeService };
}

// ------------------------------------------------------------------ integration

test("tools/list advertises the six tools; a value set through one front-end is read through another", IT, async (/** @type {any} */ t) => {
  const box = sandbox(t);
  const a = box.frontEnd();
  assert.equal((await a.request("initialize", { protocolVersion: "2025-11-25" })).result.serverInfo.name, "storage");
  const list = await a.request("tools/list");
  assert.deepEqual(
    list.result.tools.map((/** @type {any} */ tool) => tool.name),
    ["kv_get", "kv_set", "kv_delete", "stats_put", "stats_sum", "storage_status"],
  );
  assert.deepEqual((await a.call("kv_set", { key: "stats/s1", value: { n: 1 } })).structuredContent, { ok: true });
  const b = box.frontEnd();
  assert.deepEqual((await b.call("kv_get", { key: "stats/s1" })).structuredContent, { found: true, value: { n: 1 } });
  assert.equal(typeof (await b.call("storage_status")).structuredContent.pid, "number");
});

test("stats_put through one front-end is summed through another, as structuredContent and as JSON text", IT, async (/** @type {any} */ t) => {
  const box = sandbox(t);
  const a = box.frontEnd();
  const rows = [{ day: "2026-10-03", ...seq(1, 1) }];
  assert.deepEqual((await a.call("stats_put", { writer: "w1", rows, purgeBefore: "2026-09-04" })).structuredContent, { ok: true, purged: 0 });
  const b = box.frontEnd();
  const res = await b.call("stats_sum", { since: "2026-09-27" });
  assert.deepEqual(res.structuredContent, seq(1, 1));
  assert.deepEqual(JSON.parse(res.content[0].text), seq(1, 1));
});

test("five concurrent front-ends share one service that locks out every other DB reader", IT, async (/** @type {any} */ t) => {
  const box = sandbox(t);
  const results = await Promise.all(Array.from({ length: 5 }, () => box.frontEnd().call("storage_status")));
  const pids = new Set(results.map((r) => r.structuredContent.pid));
  assert.equal(pids.size, 1);
  assert.deepEqual(results[0].structuredContent, { pid: [...pids][0], protocol: PROTOCOL, version: VERSION, schemaVersion: MIGRATIONS.length, dataDir: box.dir });
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

test("a foreign process holding storage.db fails the call and leaves a line in service.log", IT, async (/** @type {any} */ t) => {
  const box = sandbox(t);
  const foreign = new DatabaseSync(box.db);
  foreign.exec("PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE");
  try {
    const res = await box.frontEnd().call("kv_get", { key: "k" });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /did not start|service\.log/);
    assert.match(readFileSync(path.join(box.dir, "service.log"), "utf8"), /locked by another process/);
  } finally {
    foreign.close();
  }
});

test("a service shutting down drains the connection it already accepted", IT, async (/** @type {any} */ t) => {
  const box = sandbox(t);
  const fe = box.frontEnd();
  const pid = (await fe.call("storage_status")).structuredContent.pid;
  const conn = net.connect(box.sock);
  await once(conn, "connect");
  process.kill(pid, "SIGTERM");
  await sleep(100);
  conn.write(JSON.stringify({ protocol: PROTOCOL, op: "storage_status", args: {} }) + "\n");
  const [chunk] = await once(conn, "data");
  assert.equal(JSON.parse(String(chunk)).result.pid, pid);
  await waitDead(pid);
  assert.equal((await fe.call("kv_get", { key: "k" })).isError, undefined); // the next call respawns
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
