import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, utimesSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import {
  isNpmInstallEnabled,
  truncate,
  countOccurrences,
  reconstructOld,
  collectChangedSpecs,
  detectPackageManager,
  pathWithLocalBin,
  installArgsFor,
  lockPathFor,
  acquireLock,
  releaseLock,
  npmInstallOnPackageChangeHandler,
} from "../../plugins/npm-automations/hooks/npm-install-on-package-change.mjs";

test('isNpmInstallEnabled: fail-open, only literal "false" disables', () => {
  assert.equal(isNpmInstallEnabled("true"), true);
  assert.equal(isNpmInstallEnabled("false"), false);
  assert.equal(isNpmInstallEnabled(undefined), true);
});

test("truncate: caps long text with a truncation marker", () => {
  const long = "x".repeat(5000);
  assert.match(truncate(long), /\(truncated\)$/);
});

test("countOccurrences: counts non-overlapping matches", () => {
  assert.equal(countOccurrences("ababab", "ab"), 3);
  assert.equal(countOccurrences("abc", "z"), 0);
  assert.equal(countOccurrences("abc", ""), 0);
});

test("reconstructOld: Edit with a unique new_string reconstructs the old content", () => {
  const newContent = '{"version": "1.0.1"}';
  const old = reconstructOld("Edit", { old_string: '"version": "1.0.0"', new_string: '"version": "1.0.1"' }, newContent);
  assert.equal(old, '{"version": "1.0.0"}');
});

test("reconstructOld: Edit with a non-unique new_string returns null (ambiguous)", () => {
  const newContent = '{"a": "1", "b": "1"}';
  const old = reconstructOld("Edit", { old_string: "whatever", new_string: '"1"' }, newContent);
  assert.equal(old, null);
});

test("reconstructOld: Write returns null (no prior content available)", () => {
  assert.equal(reconstructOld("Write", { content: "{}" }, "{}"), null);
});

test("collectChangedSpecs: version-only difference yields no specs", () => {
  const oldPkg = { version: "1.0.0", dependencies: { a: "^1.0.0" } };
  const newPkg = { version: "1.0.1", dependencies: { a: "^1.0.0" } };
  assert.deepEqual(collectChangedSpecs(oldPkg, newPkg), []);
});

test("collectChangedSpecs: a changed dependency value is included", () => {
  const oldPkg = { dependencies: { a: "^1.0.0" } };
  const newPkg = { dependencies: { a: "^2.0.0" } };
  assert.deepEqual(collectChangedSpecs(oldPkg, newPkg), ["a@^2.0.0"]);
});

test("collectChangedSpecs: a newly-added devDependency is included", () => {
  const oldPkg = {};
  const newPkg = { devDependencies: { debug: "^4.4.3" } };
  assert.deepEqual(collectChangedSpecs(oldPkg, newPkg), ["debug@^4.4.3"]);
});

test("collectChangedSpecs: covers dependencies/devDependencies/optionalDependencies, not peerDependencies", () => {
  const oldPkg = {};
  const newPkg = {
    dependencies: { a: "^1.0.0" },
    devDependencies: { b: "^1.0.0" },
    optionalDependencies: { c: "^1.0.0" },
    peerDependencies: { d: "^1.0.0" },
  };
  const specs = collectChangedSpecs(oldPkg, newPkg).sort();
  assert.deepEqual(specs, ["a@^1.0.0", "b@^1.0.0", "c@^1.0.0"]);
});

test("detectPackageManager: no lockfile -> null", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pm-none-"));
  assert.equal(detectPackageManager(dir), null);
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

test("installArgsFor: bare install (no specs) is the same verb for every manager", () => {
  assert.deepEqual(installArgsFor("npm", null), ["install"]);
  assert.deepEqual(installArgsFor("pnpm", null), ["install"]);
  assert.deepEqual(installArgsFor("yarn", null), ["install"]);
});

test("installArgsFor: npm keeps `install <specs>`, pnpm/yarn use `add <specs>`", () => {
  assert.deepEqual(installArgsFor("npm", ["a@^1.0.0"]), ["install", "a@^1.0.0"]);
  assert.deepEqual(installArgsFor("pnpm", ["a@^1.0.0"]), ["add", "a@^1.0.0"]);
  assert.deepEqual(installArgsFor("yarn", ["a@^1.0.0"]), ["add", "a@^1.0.0"]);
});

test("acquireLock: acquires immediately when free, releaseLock removes it", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lock-free-"));
  const lockPath = path.join(dir, ".lock");
  assert.equal(acquireLock(lockPath, 10 * 60 * 1000, 1000), true);
  assert.ok(existsSync(lockPath));
  releaseLock(lockPath);
  assert.ok(!existsSync(lockPath));
});

test("acquireLock: reclaims a stale lock without waiting the full budget", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lock-stale-"));
  const lockPath = path.join(dir, ".lock");
  writeFileSync(lockPath, "");
  const old = new Date(Date.now() - 20 * 60 * 1000);
  utimesSync(lockPath, old, old);
  const start = Date.now();
  assert.equal(acquireLock(lockPath, 10 * 60 * 1000, 5000), true);
  assert.ok(Date.now() - start < 2000);
  releaseLock(lockPath);
});

test("acquireLock: waits for a fresh lock to be released, then acquires", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lock-wait-"));
  const lockPath = path.join(dir, ".lock");
  writeFileSync(lockPath, "");
  // Release from a genuinely separate OS process -- acquireLock blocks the event
  // loop with its own synchronous spawnSync poll, so a setTimeout in this same
  // process could never fire while it's running (that bug shipped once already).
  spawn("bash", ["-c", `sleep 0.2 && rm -f '${lockPath}'`], {
    detached: true,
    stdio: "ignore",
  }).unref();
  const start = Date.now();
  assert.equal(acquireLock(lockPath, 10 * 60 * 1000, 3000), true);
  assert.ok(Date.now() - start >= 150);
});

test("lockPathFor: deterministic per cwd, distinct across different cwds", () => {
  const a1 = lockPathFor("/some/project/a");
  const a2 = lockPathFor("/some/project/a");
  const b = lockPathFor("/some/project/b");
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.ok(a1.startsWith(tmpdir()));
});

test("acquireLock: gives up and returns false once the wait budget expires", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lock-give-up-"));
  const lockPath = path.join(dir, ".lock");
  writeFileSync(lockPath, "");
  assert.equal(acquireLock(lockPath, 10 * 60 * 1000, 300), false);
  releaseLock(lockPath);
});

test("releaseLock: no-op, does not throw, if the lock is already gone", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lock-gone-"));
  assert.doesNotThrow(() => releaseLock(path.join(dir, "never-existed.lock")));
});

/** @param {string} filePath @param {string} toolName @param {any} toolInput @returns {PostToolUseHookInput} */
function mockInput(filePath, toolName, toolInput) {
  return {
    session_id: "test-session",
    transcript_path: "/dev/null",
    cwd: path.dirname(filePath),
    permission_mode: "default",
    hook_event_name: "PostToolUse",
    tool_name: toolName,
    tool_input: { file_path: filePath, ...toolInput },
  };
}

test("npmInstallOnPackageChangeHandler: version-only edit is a silent no-op", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "handler-version-"));
  const pkgPath = path.join(dir, "package.json");
  writeFileSync(pkgPath, '{"name":"x","version":"1.0.1"}');
  const result = npmInstallOnPackageChangeHandler(
    mockInput(pkgPath, "Edit", {
      old_string: '"version":"1.0.0"',
      new_string: '"version":"1.0.1"',
    }),
    1000,
  );
  assert.deepEqual(result, {});
});

test("npmInstallOnPackageChangeHandler: an exhausted budget still bounds npm", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "handler-deadline-"));
  const pkgPath = path.join(dir, "package.json");
  writeFileSync(pkgPath, '{"name":"x","dependencies":{"left-pad":"^2.0.0"}}');
  // npm stub that sleeps, then fails. With the shared deadline already spent by the
  // time the lock is held, npm must still get a positive timeout (1 ms -> killed ->
  // ETIMEDOUT -> silent {}); passing the leftover 0 straight through would mean "no
  // timeout at all" to spawnSync, letting the stub run to completion and report its
  // failure as additionalContext.
  const binDir = mkdtempSync(path.join(tmpdir(), "handler-npmstub-"));
  writeFileSync(path.join(binDir, "npm"), "#!/usr/bin/env bash\nsleep 0.3\nexit 1\n", { mode: 0o755 });
  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
  try {
    const result = npmInstallOnPackageChangeHandler(mockInput(pkgPath, "Write", { content: "{}" }), 0);
    assert.deepEqual(result, {});
  } finally {
    process.env.PATH = originalPath;
  }
});

test("npmInstallOnPackageChangeHandler: a pnpm-lock.yaml directory runs `pnpm add <spec>`, not npm", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "handler-pnpm-"));
  writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
  const pkgPath = path.join(dir, "package.json");
  writeFileSync(pkgPath, '{"name":"x","dependencies":{"left-pad":"^2.0.0"}}');

  const binDir = mkdtempSync(path.join(tmpdir(), "handler-pnpmstub-"));
  const callLog = path.join(binDir, "calls.log");
  writeFileSync(path.join(binDir, "pnpm"), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> '${callLog}'\nexit 0\n`, { mode: 0o755 });
  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
  try {
    const result = npmInstallOnPackageChangeHandler(mockInput(pkgPath, "Edit", { old_string: '"left-pad":"^1.0.0"', new_string: '"left-pad":"^2.0.0"' }), 1000);
    assert.deepEqual(result, {});
    assert.match(readFileSync(callLog, "utf8"), /^add left-pad@\^2\.0\.0$/m);
  } finally {
    process.env.PATH = originalPath;
  }
});

test("npmInstallOnPackageChangeHandler: finds pnpm at ~/.local/bin even when it's absent from the inherited PATH", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "handler-localbin-proj-"));
  writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
  const pkgPath = path.join(dir, "package.json");
  writeFileSync(pkgPath, '{"name":"x","dependencies":{"left-pad":"^2.0.0"}}');

  const fakeHome = mkdtempSync(path.join(tmpdir(), "handler-localbin-home-"));
  const localBin = path.join(fakeHome, ".local", "bin");
  mkdirSync(localBin, { recursive: true });
  const callLog = path.join(fakeHome, "calls.log");
  writeFileSync(path.join(localBin, "pnpm"), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> '${callLog}'\nexit 0\n`);
  chmodSync(path.join(localBin, "pnpm"), 0o755);

  const origHome = process.env.HOME;
  const originalPath = process.env.PATH;
  process.env.HOME = fakeHome;
  // Deliberately without $HOME/.local/bin -- the handler's own pathWithLocalBin()
  // must add it back for the stub to be found at all.
  process.env.PATH = "/usr/bin:/bin";
  try {
    const result = npmInstallOnPackageChangeHandler(mockInput(pkgPath, "Edit", { old_string: '"left-pad":"^1.0.0"', new_string: '"left-pad":"^2.0.0"' }), 1000);
    assert.deepEqual(result, {});
    assert.match(readFileSync(callLog, "utf8"), /^add left-pad@\^2\.0\.0$/m);
  } finally {
    process.env.HOME = origHome;
    process.env.PATH = originalPath;
  }
});
