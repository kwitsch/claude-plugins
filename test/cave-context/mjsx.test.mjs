import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const MJSX = new URL("../../plugins/cave-context/bin/mjsx.sh", import.meta.url).pathname;

// Build an isolated environment for mjsx.sh:
//   - HOME points at a fresh temp dir → no ~/.bun/bin, so mjsx's PATH prepend of
//     ${HOME}/.bun/bin adds nothing and the machine's REAL bun cannot leak in.
//   - PATH is our fake bin first, then /usr/bin:/bin. The fake bin wins for any name
//     it provides (bun/npx); /usr/bin:/bin is needed so `bash` and the node-fallback
//     interpreter resolve. Real bun is NOT on /usr/bin (it lives in ~/.bun/bin), so it
//     never leaks; a fake `npx` on the fake bin shadows the real /usr/bin/npx.
//   - realNode: append the directory of the node running this test to PATH so the
//     node-fallback branch (`exec node`) resolves even when node is NOT in /usr/bin
//     (e.g. on CI runners node lives in a toolcache dir). The fakebin still has no
//     `bun` stub, so `command -v bun` fails and mjsx takes the node fallback.
function isolatedRun(args, { fakeBun = false, fakeNpx = false, realNode = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "cc-mjsx-home-"));
  const fakebin = mkdtempSync(join(tmpdir(), "cc-mjsx-bin-"));
  try {
    if (fakeBun) writeFake(join(fakebin, "bun"));
    if (fakeNpx) writeFake(join(fakebin, "npx"));
    const nodeDir = realNode ? `${dirname(process.execPath)}:` : "";
    const env = { HOME: home, PATH: `${fakebin}:${nodeDir}/usr/bin:/bin` };
    const res = spawnSync("bash", [MJSX, ...args], { env, encoding: "utf8" });
    return res;
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(fakebin, { recursive: true, force: true });
  }
}

// A fake executable that echoes its own basename followed by its args, then exits 0.
function writeFake(path) {
  writeFileSync(path, '#!/usr/bin/env bash\necho "$(basename "$0") $*"\n');
  chmodSync(path, 0o755);
}

test("mjsx.sh: npm package runs `bun x <pkg>` when bun is present", () => {
  const res = isolatedRun(["context-mode"], { fakeBun: true });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), "bun x context-mode");
});

test("mjsx.sh: npm package runs `npx -y <pkg>` when only npx is present", () => {
  const res = isolatedRun(["context-mode"], { fakeNpx: true });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), "npx -y context-mode");
});

test("mjsx.sh: .mjs script runs `bun <script>` when bun is present", () => {
  const res = isolatedRun(["whatever.mjs", "extra"], { fakeBun: true });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), "bun whatever.mjs extra");
});

test("mjsx.sh: .mjs script runs via real node when no bun (node fallback)", () => {
  // No fake bun on PATH and no real bun reachable (temp HOME, no /usr/bin/bun), so mjsx
  // falls back to node. realNode puts the running node's own directory on PATH, so the
  // `exec node` branch resolves regardless of where node is installed (toolcache on CI,
  // /usr/bin locally); the script then prints which runtime executed it.
  const scriptDir = mkdtempSync(join(tmpdir(), "cc-mjsx-script-"));
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

test("mjsx.sh: no argument → stderr message + exit 64", () => {
  const res = isolatedRun([], {});
  assert.equal(res.status, 64);
  assert.match(res.stderr, /missing argument/);
});
