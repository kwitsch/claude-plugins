#!/usr/bin/env node
// mcp/server.mjs — inline-headroom: host-wide SQLite storage MCP server (Node built-ins only).
// Invoked directly as the .mcp.json command (#!/usr/bin/env node, mode 100755, node-only, no wrapper).
//
// One file, two modes:
// - default: the per-session stdio MCP front-end. Newline-delimited JSON-RPC 2.0; stdout carries
//   JSON-RPC only, every diagnostic goes to stderr. It never imports node:sqlite.
// - `--service <dataDir>`: the detached singleton, spawned on demand by a front-end. It is the ONLY
//   process that opens storage.db, held under PRAGMA locking_mode=EXCLUSIVE from start to exit: that
//   OS-level lock is the host-wide election mutex (freed by the kernel on any process death). It serves
//   one JSON line per connection on the owner-only Unix socket <dataDir>/storage.sock, never writes
//   stdout, and its stderr is <dataDir>/service.log.
//
// PROTOCOL must be bumped on any op or schema change. MIGRATIONS is append-only and additive:
// never edit, reorder or remove an entry.
import process from "node:process";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, realpathSync, unlinkSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const SERVER_NAME = "storage"; // keep aligned with the .mcp.json key
const SERVER_INFO = { name: SERVER_NAME, version: "0.2.0" };
const DEFAULT_PROTOCOL = "2025-11-25"; // MCP version; only used if the client omits protocolVersion
/** Front-end <-> service wire protocol. Bump on any op or schema change. */
export const PROTOCOL = 1;
/** Append-only schema migrations; entry i takes PRAGMA user_version from i to i+1. */
export const MIGRATIONS = ["CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT, WITHOUT ROWID"];
const START_TIMEOUT_MS = 3000;
const POLL_MS = 50;
const SPAWN_RETRY_MS = 500;
const REQUEST_TIMEOUT_MS = 5000;
const FAILURE_COOLDOWN_MS = 60000;
const IDLE_MS = 600000;
const MAX_REQUEST_BYTES = 2097152;
const MAX_VALUE_BYTES = 1048576;
const MAX_KEY_LENGTH = 512;
const MAX_SOCKET_PATH_BYTES = 103; // macOS sun_path limit; Linux allows 107
const SQLITE_BUSY = 5;
const SELF = fileURLToPath(import.meta.url);
// SQLite stores a lone UTF-16 surrogate as U+FFFD, so distinct keys would collapse to one row: reject them.
// (String#isWellFormed is not in the tsconfig's ES2022 lib.)
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

const KEY_SCHEMA = { type: "string", minLength: 1, maxLength: MAX_KEY_LENGTH };
const KEY_INPUT = { type: "object", properties: { key: KEY_SCHEMA }, required: ["key"], additionalProperties: false };
const TOOLS = [
  { name: "kv_get", description: "inline-headroom persistent storage: read the JSON value stored under key", inputSchema: KEY_INPUT },
  {
    name: "kv_set",
    description: `inline-headroom persistent storage: store a JSON value under key (max ${MAX_VALUE_BYTES / 2 ** 20} MiB)`,
    inputSchema: {
      type: "object",
      properties: { key: KEY_SCHEMA, value: { description: `any JSON value, at most ${MAX_VALUE_BYTES / 2 ** 20} MiB serialized` } },
      required: ["key", "value"],
      additionalProperties: false,
    },
  },
  { name: "kv_delete", description: "inline-headroom persistent storage: delete key", inputSchema: KEY_INPUT },
  {
    name: "storage_status",
    description: "inline-headroom persistent storage: service pid, protocol and schema version",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

// ------------------------------------------------------------------ pure exports

/**
 * userConfig storage_enabled, fail-closed: only the trimmed literal "true" enables, because an
 * enabled store creates files and a host-wide process.
 * @param {string|undefined} value
 * @returns {boolean}
 */
export function isStorageEnabled(value) {
  return String(value ?? "").trim() === "true";
}

/**
 * Storage paths under CLAUDE_PLUGIN_DATA. No fallback dir: data must survive plugin updates.
 * @param {string|undefined} dataDirValue
 * @returns {{dataDir: string, db: string, sock: string, log: string}}
 */
export function resolveStorage(dataDirValue) {
  const dataDir = typeof dataDirValue === "string" ? dataDirValue.trim() : "";
  if (dataDir === "" || dataDir.includes("${")) throw new Error("CLAUDE_PLUGIN_DATA is unset or unresolved; storage unavailable");
  const sock = path.join(dataDir, "storage.sock");
  // ponytail: the socket path is capped at 103 bytes (macOS sun_path), so a very long data dir fails
  // closed. Upgrade path: a per-uid 0700 dir under os.tmpdir() keyed by a hash of the data dir.
  const n = Buffer.byteLength(sock);
  if (n > MAX_SOCKET_PATH_BYTES) throw new Error(`socket path too long (${n} bytes > ${MAX_SOCKET_PATH_BYTES}): ${sock}`);
  return { dataDir, db: path.join(dataDir, "storage.db"), sock, log: path.join(dataDir, "service.log") };
}

/**
 * Applies every missing MIGRATIONS entry, one transaction each. Never downgrades.
 * @param {any} db a node:sqlite DatabaseSync
 * @returns {number} the schema version after migration
 */
export function migrate(db) {
  const v = Number(db.prepare("PRAGMA user_version").get().user_version);
  if (v > MIGRATIONS.length) throw new Error(`database schema v${v} is newer than this plugin (v${MIGRATIONS.length}); update inline-headroom`);
  for (let i = v; i < MIGRATIONS.length; i++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return MIGRATIONS.length;
}

/**
 * Runs one data op: the single trust boundary, validating every key and value.
 * @param {any} db a node:sqlite DatabaseSync
 * @param {string} op
 * @param {Record<string, unknown>} args
 * @returns {Record<string, unknown>}
 */
export function execOp(db, op, args) {
  const key = args.key;
  if (typeof key !== "string" || key.length < 1 || LONE_SURROGATE.test(key) || [...key].length > MAX_KEY_LENGTH)
    throw new Error(`key must be a non-empty string of at most ${MAX_KEY_LENGTH} characters`);
  switch (op) {
    case "kv_get": {
      const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key);
      return row === undefined ? { found: false } : { found: true, value: JSON.parse(row.value) };
    }
    case "kv_set": {
      let text = "";
      try {
        text = JSON.stringify(args.value) ?? "";
      } catch {
        /* cyclic or BigInt: not serializable */
      }
      if (text === "" || Buffer.byteLength(text) > MAX_VALUE_BYTES) throw new Error(`value must be JSON-serializable and at most ${MAX_VALUE_BYTES} bytes`);
      db.prepare("INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, text);
      return { ok: true };
    }
    case "kv_delete":
      return { deleted: Number(db.prepare("DELETE FROM kv WHERE key = ?").run(key).changes) > 0 };
    default:
      throw new Error(`unknown op: ${op}`);
  }
}

// ------------------------------------------------------------------ front-end

const ENABLED = isStorageEnabled(process.env.INLINE_HEADROOM_STORAGE_ENABLED);
/** @type {any} the service this front-end spawned, until it exits */
let child = null;
let nextSpawnAt = 0;
let coolDownUntil = 0;
let coolDownReason = "";

/**
 * One request over a fresh connection: writes one JSON line, resolves with the first reply line.
 * @param {string} sockPath
 * @param {Record<string, unknown>} msg
 * @returns {Promise<any>}
 */
function roundTrip(sockPath, msg) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const sock = net.connect(sockPath);
    sock.setEncoding("utf8");
    sock.setTimeout(REQUEST_TIMEOUT_MS, () => sock.destroy(new Error("storage request timed out")));
    sock.on("connect", () => sock.write(JSON.stringify(msg) + "\n"));
    sock.on("data", (/** @type {string} */ chunk) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      sock.destroy();
      try {
        const reply = JSON.parse(buf.slice(0, nl));
        if (typeof reply?.protocol !== "number") throw new Error("no protocol");
        resolve(reply);
      } catch {
        reject(new Error("malformed storage service reply"));
      }
    });
    sock.on("error", reject);
    sock.on("close", () => reject(new Error("storage service closed the connection without a reply")));
  });
}

/**
 * Starts the detached service: not a child that dies with this session.
 * @param {{dataDir: string, log: string}} storage
 * @returns {void}
 */
function spawnService(storage) {
  mkdirSync(storage.dataDir, { recursive: true, mode: 0o700 });
  // ponytail: service.log is never rotated; it only gets fatal service errors (about a line per
  // failed start). Upgrade path: rotate it if it ever grows noticeably.
  const fd = openSync(storage.log, "a", 0o600);
  try {
    // --disable-warning: node:sqlite's ExperimentalWarning (Node 22) would otherwise land in service.log on every start.
    // cwd: a long-lived daemon must not pin the caller's project dir (it would block an umount).
    child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", SELF, "--service", storage.dataDir], {
      detached: true,
      stdio: ["ignore", "ignore", fd],
      cwd: storage.dataDir,
    });
  } finally {
    closeSync(fd);
  }
  child.unref();
  /** @param {string} reason */
  const coolDown = (reason) => {
    coolDownUntil = Date.now() + FAILURE_COOLDOWN_MS;
    coolDownReason = reason;
  };
  child.on("exit", (/** @type {number|null} */ code) => {
    child = null;
    // 0 = lost the election (normal); null = killed by a signal (the next call respawns)
    if (code) coolDown(`storage service exited with code ${code}; see ${storage.log}`);
  });
  child.on("error", (/** @type {any} */ e) => {
    child = null;
    coolDown(`cannot spawn storage service: ${e?.message ?? e}`);
  });
}

/**
 * Sends one op to the host-wide service, spawning it when none listens. Only ENOENT/ECONNREFUSED
 * (nothing was sent) are retried, so a write is never applied twice.
 * @param {string} op
 * @param {Record<string, unknown>} args
 * @returns {Promise<any>}
 */
async function callService(op, args) {
  if (!ENABLED) throw new Error("storage is disabled (userConfig storage_enabled is not true)");
  // The transport is a path-based Unix socket; native-Windows listen() would need a \\.\pipe\ name instead.
  if (process.platform === "win32") throw new Error("storage is unsupported on native Windows (it needs a Unix domain socket); use WSL2");
  if (Date.now() < coolDownUntil) throw new Error(coolDownReason);
  const storage = resolveStorage(process.env.CLAUDE_PLUGIN_DATA);
  const deadline = Date.now() + START_TIMEOUT_MS;
  const startTimeout = () => new Error(`storage service did not start within ${START_TIMEOUT_MS} ms; see ${storage.log}`);
  for (;;) {
    /** @type {any} */
    let res;
    try {
      res = await roundTrip(storage.sock, { protocol: PROTOCOL, op, args });
    } catch (e) {
      const code = /** @type {any} */ (e)?.code;
      if (code !== "ENOENT" && code !== "ECONNREFUSED") throw e; // the request may have been applied: never retry
      if (Date.now() > deadline) throw startTimeout();
      if (!child && Date.now() >= nextSpawnAt) {
        spawnService(storage);
        nextSpawnAt = Date.now() + SPAWN_RETRY_MS;
      }
      if (Date.now() < coolDownUntil) throw new Error(coolDownReason, { cause: e });
      await sleep(POLL_MS);
      continue;
    }
    if (res.protocol > PROTOCOL) {
      throw new Error(`a newer inline-headroom storage service is running (protocol ${res.protocol} > ${PROTOCOL}); restart this session to load the updated plugin`);
    }
    if (res.protocol < PROTOCOL) {
      // An older service answered "protocol mismatch" without executing the request: replace it.
      if (Date.now() > deadline) throw startTimeout();
      try {
        if (Number.isInteger(res.pid) && res.pid > 0) process.kill(res.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
      await sleep(POLL_MS);
      continue;
    }
    if ("error" in res) throw new Error(res.error);
    return res.result;
  }
}

/** @returns {void} */
function startServer() {
  /** @param {any} msg */
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
  /** @param {any} id @param {any} result */
  const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
  /** @param {any} id @param {number} code @param {string} message */
  const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

  /** @param {any} msg @returns {Promise<void>} */
  const handle = async (msg) => {
    const { id, method, params } = msg ?? {};
    switch (method) {
      case "initialize":
        return ok(id, { protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: ENABLED ? TOOLS : [] });
      case "tools/call": {
        const name = params?.name;
        if (!TOOLS.some((tool) => tool.name === name)) return fail(id, -32602, `unknown tool: ${name}`);
        const args = params?.arguments ?? {};
        if (process.env.MCP_HOOK_DEBUG) process.stderr.write(`[${SERVER_NAME}] tools/call ${name} args=${JSON.stringify(args)}\n`);
        try {
          const result = await callService(name, args);
          return ok(id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
        } catch (e) {
          return ok(id, { content: [{ type: "text", text: `inline-headroom storage: ${/** @type {any} */ (e)?.message ?? e}` }], isError: true });
        }
      }
      default:
        if (id === undefined) return; // notifications/*
        return fail(id, -32601, `method not found: ${method}`);
    }
  };

  /** @param {string} line */
  const onLine = (line) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    /** @type {any} */
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      process.stderr.write(`[${SERVER_NAME}] non-JSON line ignored\n`);
      return;
    }
    handle(msg).catch((e) => {
      process.stderr.write(`[${SERVER_NAME}] handler crash: ${e?.stack ?? e}\n`);
      if (msg?.id !== undefined) fail(msg.id, -32603, `internal error: ${e?.message ?? e}`);
    });
  };

  // Frame on "\n" only: readline also splits on U+2028/U+2029 (Node >= 24), which JSON.stringify
  // leaves raw inside strings, so a request carrying one would be cut into unparseable fragments.
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (/** @type {string} */ chunk) => {
    buf += chunk;
    for (let nl = buf.indexOf("\n"); nl !== -1; nl = buf.indexOf("\n")) {
      onLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

// ------------------------------------------------------------------ service

/**
 * The detached singleton: wins the storage.db exclusive lock or exits 0, migrates, then serves one
 * JSON line per connection on storage.sock until 10 idle minutes pass or SIGTERM/SIGINT arrives.
 * @param {string|undefined} dataDirValue
 * @returns {Promise<void>}
 */
async function runService(dataDirValue) {
  process.umask(0o077);
  const storage = resolveStorage(dataDirValue);
  mkdirSync(storage.dataDir, { recursive: true, mode: 0o700 });
  /** @type {any} */
  let sqlite;
  try {
    sqlite = await import("node:sqlite");
  } catch (e) {
    throw new Error(`node:sqlite unavailable in Node ${process.version}; Node >= 22.13 required`, { cause: e });
  }
  const db = new sqlite.DatabaseSync(storage.db);
  try {
    db.exec("PRAGMA locking_mode=EXCLUSIVE; PRAGMA journal_mode=WAL; BEGIN EXCLUSIVE; COMMIT");
  } catch (e) {
    if (/** @type {any} */ (e)?.errcode === SQLITE_BUSY) process.exit(0); // lost the election (or a foreign process holds a lock)
    throw e;
  }
  const schemaVersion = migrate(db);
  try {
    unlinkSync(storage.sock); // only the lock holder gets here, so any socket file is stale
  } catch (e) {
    if (/** @type {any} */ (e)?.code !== "ENOENT") throw e;
  }

  /** @type {any} */
  let idle = null;
  // Never waits for server.close(): a stuck client must not keep the DB lock alive. The socket is
  // unlinked before the lock is released, so it can only be this service's own socket.
  const shutdown = () => {
    clearTimeout(idle);
    try {
      unlinkSync(storage.sock);
    } catch {
      /* already gone */
    }
    db.close();
    process.exit(0);
  };

  /** @param {string} line @returns {Record<string, unknown>} */
  const respond = (line) => {
    /** @type {any} */
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return { error: "malformed request" };
    }
    if (req?.protocol !== PROTOCOL) return { error: "protocol mismatch" }; // never executed
    if (req.op === "storage_status") return { result: { pid: process.pid, protocol: PROTOCOL, schemaVersion, dataDir: storage.dataDir } };
    try {
      return { result: execOp(db, req.op, req.args ?? {}) };
    } catch (e) {
      return { error: /** @type {any} */ (e)?.message ?? String(e) };
    }
  };

  /** @param {any} sock */
  const onConnection = (sock) => {
    let buf = "";
    let bytes = 0;
    let answered = false;
    /** @param {Record<string, unknown>} body */
    const reply = (body) => sock.end(JSON.stringify({ protocol: PROTOCOL, pid: process.pid, ...body }) + "\n");
    sock.setEncoding("utf8");
    sock.setTimeout(REQUEST_TIMEOUT_MS, () => sock.destroy());
    sock.on("error", () => {});
    sock.on("data", (/** @type {string} */ chunk) => {
      if (answered) return;
      buf += chunk;
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_REQUEST_BYTES) {
        answered = true;
        reply({ error: "request too large" });
        return;
      }
      if (!chunk.includes("\n")) return;
      answered = true;
      clearTimeout(idle);
      idle = setTimeout(shutdown, IDLE_MS);
      reply(respond(buf.slice(0, buf.indexOf("\n"))));
    });
  };

  const server = net.createServer(onConnection);
  await new Promise((resolve, reject) => server.once("error", reject).listen(storage.sock, resolve));
  idle = setTimeout(shutdown, IDLE_MS);
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

/** @returns {boolean} */
function isMainModule() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(SELF);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  if (process.argv[2] === "--service") {
    runService(process.argv[3]).catch((e) => {
      process.stderr.write(`[storage] ${e?.stack ?? e}\n`);
      process.exit(1);
    });
  } else {
    startServer();
  }
}
