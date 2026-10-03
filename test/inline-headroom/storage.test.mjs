import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, execOp, isStorageEnabled, migrate, resolveStorage } from "../../plugins/inline-headroom/mcp/server.mjs";

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
  assert.throws(() => execOp(db, "kv_set", { key: "k", value: undefined }), /value must be/);
  assert.throws(() => execOp(db, "kv_set", { key: "k", value: "x".repeat(1048576) }), /value must be/);
  assert.throws(() => execOp(db, "kv_list", { key: "k" }), /unknown op: kv_list/);
  db.close();
});
