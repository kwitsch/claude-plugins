import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const BNX = new URL("../../plugins/cave-context/bin/bnx.sh", import.meta.url).pathname;

// Build an isolated environment for bnx.sh:
//   - HOME points at a fresh temp dir → no side-effects from the real home.
//   - PATH is set to just /usr/bin:/bin plus (when realNode) the running node's dir,
//     so `exec node` resolves even when node lives in a toolcache dir on CI.
//   - No bun or npx stub is ever added — bnx.sh is node-only and must not need them.
function isolatedRun(args, { realNode = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "cc-bnx-home-"));
  try {
    const nodeDir = realNode ? `${dirname(process.execPath)}:` : "";
    const env = { HOME: home, PATH: `${nodeDir}/usr/bin:/bin` };
    const res = spawnSync("bash", [BNX, ...args], { env, encoding: "utf8" });
    return res;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("bnx.sh: script body contains no 'bun' or 'npx' references", () => {
  const body = readFileSync(BNX, "utf8");
  assert.doesNotMatch(body, /\bbun\b/, "script body must not reference 'bun'");
  assert.doesNotMatch(body, /\bnpx\b/, "script body must not reference 'npx'");
});

test("bnx.sh: .mjs script runs via real node (node-only launcher)", () => {
  // realNode puts the running node's own directory on PATH, so the `exec node`
  // branch resolves regardless of where node is installed (toolcache on CI,
  // /usr/bin locally); the script then prints which runtime executed it.
  const scriptDir = mkdtempSync(join(tmpdir(), "cc-bnx-script-"));
  const script = join(scriptDir, "ok.mjs");
  writeFileSync(script, 'process.stdout.write((process.versions.bun ? "bun" : "node") + "\\n");\n');
  try {
    const res = isolatedRun([script], { realNode: true });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout.trim(), "node");
  } finally {
    rmSync(scriptDir, { recursive: true, force: true });
  }
});

test("bnx.sh: no argument → stderr message + exit 64", () => {
  const res = isolatedRun([], {});
  assert.equal(res.status, 64);
  assert.match(res.stderr, /missing argument/);
});

test("bnx.sh: node absent → stderr message + exit 1", () => {
  // Build a minimal PATH that has bash but no node, to exercise the error branch.
  const bash = ["/usr/bin/bash", "/bin/bash"].find(existsSync);
  const home = mkdtempSync(join(tmpdir(), "cc-bnx-home-"));
  const emptybin = mkdtempSync(join(tmpdir(), "cc-bnx-empty-"));
  try {
    symlinkSync(bash, join(emptybin, "bash")); // only bash on PATH — no node
    const res = spawnSync(bash, [BNX, "some.mjs"], { env: { HOME: home, PATH: emptybin }, encoding: "utf8" });
    assert.equal(res.status, 1, res.stdout);
    assert.match(res.stderr, /node is not available/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(emptybin, { recursive: true, force: true });
  }
});
