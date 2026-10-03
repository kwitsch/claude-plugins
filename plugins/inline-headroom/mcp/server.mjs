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
import path from "node:path";

/** Front-end <-> service wire protocol. Bump on any op or schema change. */
export const PROTOCOL = 1;
/** Append-only schema migrations; entry i takes PRAGMA user_version from i to i+1. */
export const MIGRATIONS = ["CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT, WITHOUT ROWID"];
const MAX_VALUE_BYTES = 1048576;
const MAX_KEY_LENGTH = 512;
const MAX_SOCKET_PATH_BYTES = 103; // macOS sun_path limit; Linux allows 107

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
  if (typeof key !== "string" || key.length < 1 || key.length > MAX_KEY_LENGTH) throw new Error("key must be a non-empty string of at most 512 characters");
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
      if (text === "" || Buffer.byteLength(text) > MAX_VALUE_BYTES) throw new Error("value must be JSON-serializable and at most 1048576 bytes");
      db.prepare("INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, text);
      return { ok: true };
    }
    case "kv_delete":
      return { deleted: Number(db.prepare("DELETE FROM kv WHERE key = ?").run(key).changes) > 0 };
    default:
      throw new Error(`unknown op: ${op}`);
  }
}
