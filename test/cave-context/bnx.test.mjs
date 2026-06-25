import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const BNX = new URL("../../plugins/cave-context/bin/bnx.sh", import.meta.url).pathname;

// Build an isolated environment for bnx.sh:
//   - HOME points at a fresh temp dir → no ~/.bun/bin, so bnx's PATH prepend of
//     ${HOME}/.bun/bin adds nothing and the machine's REAL bun cannot leak in.
//   - PATH is our fake bin first, then /usr/bin:/bin. The fake bin wins for any name
//     it provides (bun/npx); /usr/bin:/bin is needed so `bash` and the node-fallback
//     interpreter resolve. Real bun is NOT on /usr/bin (it lives in ~/.bun/bin), so it
//     never leaks; a fake `npx` on the fake bin shadows the real /usr/bin/npx.
//   - realNode: append the directory of the node running this test to PATH so the
//     node-fallback branch (`exec node`) resolves even when node is NOT in /usr/bin
//     (e.g. on CI runners node lives in a toolcache dir). The fakebin still has no
//     `bun` stub, so `command -v bun` fails and bnx takes the node fallback.
function isolatedRun(args, { fakeBun = false, fakeNpx = false, realNode = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "cc-bnx-home-"));
  const fakebin = mkdtempSync(join(tmpdir(), "cc-bnx-bin-"));
  try {
    if (fakeBun) writeFake(join(fakebin, "bun"));
    if (fakeNpx) writeFake(join(fakebin, "npx"));
    const nodeDir = realNode ? `${dirname(process.execPath)}:` : "";
    const env = { HOME: home, PATH: `${fakebin}:${nodeDir}/usr/bin:/bin` };
    const res = spawnSync("bash", [BNX, ...args], { env, encoding: "utf8" });
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

// Fake bun honoring the new bnx.sh package flow. Reads GBIN (global bin dir) and
// ADDLOG (sentinel path) from the environment:
//   `bun pm bin -g`    → prints $GBIN
//   `bun add -g <pkg>` → records the call in $ADDLOG and installs a fake context-mode into $GBIN
//   anything else      → echoes "bun <args>"
function writeFakeBun(path) {
  writeFileSync(path, [
    '#!/usr/bin/env bash',
    'if [ "$1 $2 $3" = "pm bin -g" ]; then echo "$GBIN"; exit 0; fi',
    'if [ "$1" = "add" ] && [ "$2" = "-g" ]; then',
    '  echo ran > "$ADDLOG"',
    '  cat > "$GBIN/$3" <<\'PKG\'',
    '#!/usr/bin/env bash',
    'echo "context-mode $*"',
    'PKG',
    '  chmod +x "$GBIN/$3"',
    '  exit 0',
    'fi',
    'echo "bun $*"',
    '',
  ].join("\n"));
  chmodSync(path, 0o755);
}

test("bnx.sh: npm package not yet installed → `bun add -g` installs it, then execs from the bun bin dir (cold path)", () => {
  const home = mkdtempSync(join(tmpdir(), "cc-bnx-home-"));
  const fakebin = mkdtempSync(join(tmpdir(), "cc-bnx-bin-"));
  const gbin = mkdtempSync(join(tmpdir(), "cc-bnx-gbin-")); // starts EMPTY → cold path forces `bun add -g`
  const addlog = join(home, "addlog");
  try {
    writeFakeBun(join(fakebin, "bun"));
    const env = { HOME: home, PATH: `${fakebin}:/usr/bin:/bin`, GBIN: gbin, ADDLOG: addlog };
    const res = spawnSync("bash", [BNX, "context-mode", "hook", "claude-code"], { env, encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout.trim(), "context-mode hook claude-code");
    assert.ok(existsSync(addlog), "expected `bun add -g` to run on the cold path");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(fakebin, { recursive: true, force: true });
    rmSync(gbin, { recursive: true, force: true });
  }
});

test("bnx.sh: npm package already installed → execs from the bun bin dir WITHOUT `bun add -g` (warm path)", () => {
  const home = mkdtempSync(join(tmpdir(), "cc-bnx-home-"));
  const fakebin = mkdtempSync(join(tmpdir(), "cc-bnx-bin-"));
  const gbin = mkdtempSync(join(tmpdir(), "cc-bnx-gbin-"));
  const addlog = join(home, "addlog");
  try {
    writeFakeBun(join(fakebin, "bun"));
    // pre-install context-mode → the warm-path guard must short-circuit before `bun add -g`
    writeFileSync(join(gbin, "context-mode"), '#!/usr/bin/env bash\necho "context-mode $*"\n');
    chmodSync(join(gbin, "context-mode"), 0o755);
    const env = { HOME: home, PATH: `${fakebin}:/usr/bin:/bin`, GBIN: gbin, ADDLOG: addlog };
    const res = spawnSync("bash", [BNX, "context-mode", "hook", "claude-code"], { env, encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout.trim(), "context-mode hook claude-code");
    assert.ok(!existsSync(addlog), "warm path must not call `bun add -g`");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(fakebin, { recursive: true, force: true });
    rmSync(gbin, { recursive: true, force: true });
  }
});

test("bnx.sh: npm package with neither bun nor npx exits 1", () => {
  const bash = ["/usr/bin/bash", "/bin/bash"].find(existsSync);
  const home = mkdtempSync(join(tmpdir(), "cc-bnx-home-"));
  const emptybin = mkdtempSync(join(tmpdir(), "cc-bnx-empty-"));
  try {
    symlinkSync(bash, join(emptybin, "bash")); // only bash on PATH — no bun, no npx, no node
    const res = spawnSync(bash, [BNX, "context-mode"], { env: { HOME: home, PATH: emptybin }, encoding: "utf8" });
    assert.equal(res.status, 1, res.stdout);
    assert.match(res.stderr, /neither bun nor npx/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(emptybin, { recursive: true, force: true });
  }
});

test("bnx.sh: npm package runs `npx -y <pkg>` when only npx is present", () => {
  const res = isolatedRun(["context-mode"], { fakeNpx: true });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), "npx -y context-mode");
});

test("bnx.sh: .mjs script runs `bun <script>` when bun is present", () => {
  const res = isolatedRun(["whatever.mjs", "extra"], { fakeBun: true });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), "bun whatever.mjs extra");
});

test("bnx.sh: .mjs script runs via real node when no bun (node fallback)", () => {
  // No fake bun on PATH and no real bun reachable (temp HOME, no /usr/bin/bun), so bnx
  // falls back to node. realNode puts the running node's own directory on PATH, so the
  // `exec node` branch resolves regardless of where node is installed (toolcache on CI,
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
