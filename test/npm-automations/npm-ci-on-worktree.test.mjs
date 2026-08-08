import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { isNpmCiEnabled, truncate, detectPackageManager, pathWithLocalBin, npmCiOnWorktreeHandler } from "../../plugins/npm-automations/hooks/npm-ci-on-worktree.mjs";

test('isNpmCiEnabled: fail-open, only literal "false" disables', () => {
  assert.equal(isNpmCiEnabled("true"), true);
  assert.equal(isNpmCiEnabled("false"), false);
  assert.equal(isNpmCiEnabled(""), true);
  assert.equal(isNpmCiEnabled(undefined), true);
  assert.equal(isNpmCiEnabled("${user_config.npm_ci_on_worktree}"), true);
});

test("truncate: passes short text through unchanged", () => {
  assert.equal(truncate("short output"), "short output");
});

test("truncate: caps long text at 4000 chars with a truncation marker", () => {
  const long = "x".repeat(5000);
  const out = truncate(long);
  assert.ok(out.length < long.length);
  assert.match(out, /\(truncated\)$/);
});

test("detectPackageManager: no lockfile -> null", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pm-none-"));
  assert.equal(detectPackageManager(dir), null);
});

test("detectPackageManager: package-lock.json -> npm", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pm-npm-"));
  writeFileSync(path.join(dir, "package-lock.json"), "");
  assert.equal(detectPackageManager(dir)?.name, "npm");
});

test("detectPackageManager: pnpm-lock.yaml -> pnpm", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pm-pnpm-"));
  writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
  assert.equal(detectPackageManager(dir)?.name, "pnpm");
});

test("detectPackageManager: yarn.lock -> yarn", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pm-yarn-"));
  writeFileSync(path.join(dir, "yarn.lock"), "");
  assert.equal(detectPackageManager(dir)?.name, "yarn");
});

test("detectPackageManager: pnpm-lock.yaml and package-lock.json both present -> pnpm wins", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pm-both-"));
  writeFileSync(path.join(dir, "package-lock.json"), "");
  writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
  assert.equal(detectPackageManager(dir)?.name, "pnpm");
});

test("pathWithLocalBin: prepends ~/.local/bin ahead of the inherited PATH", () => {
  const origPath = process.env.PATH;
  process.env.PATH = "/usr/bin";
  try {
    const result = pathWithLocalBin();
    assert.ok(result.startsWith(path.join(homedir(), ".local", "bin")));
    assert.ok(result.endsWith("/usr/bin"));
  } finally {
    process.env.PATH = origPath;
  }
});

/** @param {string} cwd @returns {PostToolUseHookInput} */
function mockInput(cwd) {
  return {
    session_id: "test-session",
    transcript_path: "/dev/null",
    cwd,
    permission_mode: "default",
    hook_event_name: "PostToolUse",
    tool_name: "EnterWorktree",
    tool_input: {},
  };
}

test("npmCiOnWorktreeHandler: npm killed by its own timeout is silent, not misreported as missing", () => {
  const projDir = mkdtempSync(path.join(tmpdir(), "npm-ci-timeout-"));
  writeFileSync(path.join(projDir, "package-lock.json"), "");

  const binDir = mkdtempSync(path.join(tmpdir(), "npm-ci-stubbin-"));
  const npmStub = path.join(binDir, "npm");
  writeFileSync(npmStub, "#!/usr/bin/env bash\nsleep 5\n");
  chmodSync(npmStub, 0o755);

  const origPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${origPath}`;
  try {
    // 100ms timeout, stub sleeps 5s -- spawnSync sets BOTH result.error and
    // result.signal on this kill; the handler must check signal first.
    const result = npmCiOnWorktreeHandler(mockInput(projDir), 100);
    assert.deepEqual(result, {});
  } finally {
    process.env.PATH = origPath;
  }
});

test("npmCiOnWorktreeHandler: a non-ENOENT spawn error (EACCES) is not misreported as npm missing", () => {
  const projDir = mkdtempSync(path.join(tmpdir(), "npm-ci-eacces-"));
  writeFileSync(path.join(projDir, "package-lock.json"), "");

  const binDir = mkdtempSync(path.join(tmpdir(), "npm-ci-noexec-"));
  const npmStub = path.join(binDir, "npm");
  writeFileSync(npmStub, "#!/usr/bin/env bash\necho should never run\n");
  chmodSync(npmStub, 0o644); // present on PATH but not executable -- EACCES, not ENOENT

  const origPath = process.env.PATH;
  // Replace PATH entirely (not prepend) -- with the real npm still reachable
  // further down PATH, the OS's PATH search silently skips a non-executable
  // match and falls through to it, defeating the point of this test.
  process.env.PATH = binDir;
  try {
    const result = npmCiOnWorktreeHandler(mockInput(projDir));
    const message = result?.hookSpecificOutput?.additionalContext ?? "";
    assert.doesNotMatch(message, /npm not found on PATH/);
    assert.match(message, /npm ci` failed/);
    assert.match(message, /EACCES/);
  } finally {
    process.env.PATH = origPath;
  }
});

test("npmCiOnWorktreeHandler: pnpm-lock.yaml runs `pnpm install --frozen-lockfile`, not npm", () => {
  const projDir = mkdtempSync(path.join(tmpdir(), "npm-ci-pnpm-"));
  writeFileSync(path.join(projDir, "pnpm-lock.yaml"), "");

  const binDir = mkdtempSync(path.join(tmpdir(), "npm-ci-pnpmstub-"));
  const callLog = path.join(binDir, "calls.log");
  const pnpmStub = path.join(binDir, "pnpm");
  writeFileSync(pnpmStub, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> '${callLog}'\nexit 0\n`);
  chmodSync(pnpmStub, 0o755);

  const origPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${origPath}`;
  try {
    const result = npmCiOnWorktreeHandler(mockInput(projDir));
    assert.deepEqual(result, {});
    assert.match(readFileSync(callLog, "utf8"), /^install --frozen-lockfile$/m);
  } finally {
    process.env.PATH = origPath;
  }
});

test("npmCiOnWorktreeHandler: finds pnpm at ~/.local/bin even when it's absent from the inherited PATH", () => {
  const projDir = mkdtempSync(path.join(tmpdir(), "npm-ci-localbin-proj-"));
  writeFileSync(path.join(projDir, "pnpm-lock.yaml"), "");

  const fakeHome = mkdtempSync(path.join(tmpdir(), "npm-ci-localbin-home-"));
  const localBin = path.join(fakeHome, ".local", "bin");
  mkdirSync(localBin, { recursive: true });
  const callLog = path.join(fakeHome, "calls.log");
  const pnpmStub = path.join(localBin, "pnpm");
  writeFileSync(pnpmStub, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> '${callLog}'\nexit 0\n`);
  chmodSync(pnpmStub, 0o755);

  const origHome = process.env.HOME;
  const origPath = process.env.PATH;
  process.env.HOME = fakeHome;
  // A PATH deliberately without $HOME/.local/bin -- the handler's own
  // pathWithLocalBin() must add it back for the stub to be found at all.
  process.env.PATH = "/usr/bin:/bin";
  try {
    const result = npmCiOnWorktreeHandler(mockInput(projDir));
    assert.deepEqual(result, {});
    assert.match(readFileSync(callLog, "utf8"), /^install --frozen-lockfile$/m);
  } finally {
    process.env.HOME = origHome;
    process.env.PATH = origPath;
  }
});
