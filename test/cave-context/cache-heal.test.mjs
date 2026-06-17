import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gcOldVersions, resolveCacheLayout } from "../../plugins/cave-context/mcp/cache-heal.mjs";

function setupCache() {
  const root = mkdtempSync(join(tmpdir(), "cc-cache-"));
  const parent = join(root, "plugins", "cache", "kwitsch-plugins", "cave-context");
  for (const v of ["0.5.0", "0.4.1", "0.3.1"]) mkdirSync(join(parent, v), { recursive: true });
  return { root, parent, current: join(parent, "0.5.0") };
}

test("resolveCacheLayout matches only a cave-context cache path", () => {
  assert.equal(resolveCacheLayout("/x/plugins/cache/mp/cave-context/0.5.0").current, "0.5.0");
  assert.equal(resolveCacheLayout("/x/some/other/0.5.0"), null);
  assert.equal(resolveCacheLayout(""), null);
});

test("gc removes old siblings (>1h) but keeps current and fresh siblings", () => {
  const { root, parent, current } = setupCache();
  try {
    const now = 10 * 3600000;            // 10h, in ms
    const oldSec = (now - 2 * 3600000) / 1000;   // 2h ago → removed
    const freshSec = (now - 600000) / 1000;      // 10min ago → kept
    utimesSync(join(parent, "0.3.1"), oldSec, oldSec);
    utimesSync(join(parent, "0.4.1"), freshSec, freshSec);
    const removed = gcOldVersions(current, now);
    assert.deepEqual(removed, ["0.3.1"]);
    assert.ok(!existsSync(join(parent, "0.3.1")));
    assert.ok(existsSync(join(parent, "0.4.1")));
    assert.ok(existsSync(current));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gc is a no-op for a non-cave-context path", () => {
  assert.deepEqual(gcOldVersions("/x/some/other/0.5.0", 10 * 3600000), []);
});
