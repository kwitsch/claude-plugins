import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MANAGER,
  INSTALL_TIMEOUT_MS,
  isEnabled,
  truncate,
  detectPackageManager,
  pathWithLocalBin,
  isPackageJson,
  dirname,
  installArgsFor,
  countOccurrences,
  reconstructOld,
  collectChangedSpecs,
  planInstall,
  outcomeMessage,
} from "../../plugins/npm-automations/hooks/policy.mjs";

test('isEnabled: fail-open, only a literal false (boolean or "false") disables', () => {
  assert.equal(isEnabled(true), true);
  assert.equal(isEnabled("true"), true);
  assert.equal(isEnabled(""), true);
  assert.equal(isEnabled(undefined), true);
  assert.equal(isEnabled("${user_config.npm_ci_on_worktree}"), true);
  assert.equal(isEnabled(false), false);
  assert.equal(isEnabled("false"), false);
});

test("INSTALL_TIMEOUT_MS keeps the old hooks' 300 s budget", () => {
  assert.equal(INSTALL_TIMEOUT_MS, 300000);
});

test("truncate: passes short text through, caps long text at 4000 chars with a marker", () => {
  assert.equal(truncate("  short output \n"), "short output");
  const out = truncate("x".repeat(5000));
  assert.equal(out, `${"x".repeat(4000)}\n... (truncated)`);
});

test("detectPackageManager: lockfile selects the manager, pnpm then yarn then npm", () => {
  assert.equal(detectPackageManager([]), null);
  assert.equal(detectPackageManager(["package.json", "README.md"]), null);
  assert.equal(detectPackageManager(["package-lock.json"])?.name, "npm");
  assert.equal(detectPackageManager(["pnpm-lock.yaml"])?.name, "pnpm");
  assert.equal(detectPackageManager(["yarn.lock"])?.name, "yarn");
  assert.equal(detectPackageManager(["package-lock.json", "pnpm-lock.yaml"])?.name, "pnpm");
  assert.equal(detectPackageManager(["package-lock.json", "yarn.lock"])?.name, "yarn");
});

test("detectPackageManager: each manager's lockfile-frozen ci args", () => {
  assert.deepEqual(detectPackageManager(["package-lock.json"])?.ciArgs, ["ci"]);
  assert.deepEqual(detectPackageManager(["pnpm-lock.yaml"])?.ciArgs, ["install", "--frozen-lockfile"]);
  assert.deepEqual(detectPackageManager(["yarn.lock"])?.ciArgs, ["install", "--frozen-lockfile"]);
});

test("DEFAULT_MANAGER (no lockfile yet) is npm", () => {
  assert.equal(DEFAULT_MANAGER.name, "npm");
});

test("pathWithLocalBin: appends ~/.local/bin after the inherited PATH, never before", () => {
  assert.equal(pathWithLocalBin("/usr/bin:/bin", "/home/u"), "/usr/bin:/bin:/home/u/.local/bin");
  assert.equal(pathWithLocalBin(undefined, "/home/u"), "/home/u/.local/bin");
  assert.equal(pathWithLocalBin("/usr/bin", undefined), "/usr/bin");
  assert.equal(pathWithLocalBin(undefined, undefined), "");
});

test("isPackageJson: any package.json, except under node_modules", () => {
  assert.equal(isPackageJson("/p/package.json"), true);
  assert.equal(isPackageJson("package.json"), true);
  assert.equal(isPackageJson("/p/sub/package.json"), true);
  assert.equal(isPackageJson("/p/node_modules/a/package.json"), false);
  assert.equal(isPackageJson("/p/index.js"), false);
  assert.equal(isPackageJson("/p/my-package.json"), false);
  assert.equal(isPackageJson("/p/package.json.bak"), false);
});

test("dirname: the directory of a file path", () => {
  assert.equal(dirname("/p/sub/package.json"), "/p/sub");
  assert.equal(dirname("/package.json"), "/");
  assert.equal(dirname("package.json"), ".");
});

test("installArgsFor: bare install is the same verb for every manager", () => {
  assert.deepEqual(installArgsFor("npm", null), ["install"]);
  assert.deepEqual(installArgsFor("pnpm", null), ["install"]);
  assert.deepEqual(installArgsFor("yarn", null), ["install"]);
});

test("installArgsFor: npm keeps `install <specs>`, pnpm/yarn use `add <specs>`", () => {
  assert.deepEqual(installArgsFor("npm", ["a@^1.0.0"]), ["install", "a@^1.0.0"]);
  assert.deepEqual(installArgsFor("pnpm", ["a@^1.0.0"]), ["add", "a@^1.0.0"]);
  assert.deepEqual(installArgsFor("yarn", ["a@^1.0.0"]), ["add", "a@^1.0.0"]);
});

test("countOccurrences: counts non-overlapping matches", () => {
  assert.equal(countOccurrences("ababab", "ab"), 3);
  assert.equal(countOccurrences("abc", "z"), 0);
  assert.equal(countOccurrences("abc", ""), 0);
});

test("reconstructOld: Edit with a unique new_string reconstructs the old content", () => {
  const old = reconstructOld("Edit", { old_string: '"version": "1.0.0"', new_string: '"version": "1.0.1"' }, '{"version": "1.0.1"}');
  assert.equal(old, '{"version": "1.0.0"}');
});

test("reconstructOld: a `$&` in old_string is inserted literally, not as a replace pattern", () => {
  assert.equal(reconstructOld("Edit", { old_string: '"a": "$&"', new_string: '"a": "b"' }, '{"a": "b"}'), '{"a": "$&"}');
});

test("reconstructOld: Edit with a non-unique new_string returns null (ambiguous)", () => {
  assert.equal(reconstructOld("Edit", { old_string: "whatever", new_string: '"1"' }, '{"a": "1", "b": "1"}'), null);
});

test("reconstructOld: Write returns null (no prior content available)", () => {
  assert.equal(reconstructOld("Write", { content: "{}" }, "{}"), null);
});

test("collectChangedSpecs: version-only difference yields no specs", () => {
  assert.deepEqual(collectChangedSpecs({ version: "1.0.0", dependencies: { a: "^1.0.0" } }, { version: "1.0.1", dependencies: { a: "^1.0.0" } }), []);
});

test("collectChangedSpecs: changed and added entries are included, removed ones are not", () => {
  assert.deepEqual(collectChangedSpecs({ dependencies: { a: "^1.0.0", gone: "1" } }, { dependencies: { a: "^2.0.0" } }), ["a@^2.0.0"]);
  assert.deepEqual(collectChangedSpecs({}, { devDependencies: { debug: "^4.4.3" } }), ["debug@^4.4.3"]);
});

test("collectChangedSpecs: covers dependencies/devDependencies/optionalDependencies, not peerDependencies", () => {
  const newPkg = {
    dependencies: { a: "^1.0.0" },
    devDependencies: { b: "^1.0.0" },
    optionalDependencies: { c: "^1.0.0" },
    peerDependencies: { d: "^1.0.0" },
  };
  assert.deepEqual(collectChangedSpecs({}, newPkg).sort(), ["a@^1.0.0", "b@^1.0.0", "c@^1.0.0"]);
});

test("planInstall: a version-only Edit asks for nothing", () => {
  assert.equal(planInstall("Edit", { old_string: '"version":"1.0.0"', new_string: '"version":"1.0.1"' }, '{"name":"x","version":"1.0.1"}'), null);
});

test("planInstall: an Edit changing a dependency asks for exactly that spec", () => {
  const plan = planInstall("Edit", { old_string: '"left-pad":"^1.0.0"', new_string: '"left-pad":"^2.0.0"' }, '{"dependencies":{"left-pad":"^2.0.0"}}');
  assert.deepEqual(plan, { specs: ["left-pad@^2.0.0"] });
});

test("planInstall: a Write, or an ambiguous Edit, falls back to a bare install", () => {
  assert.deepEqual(planInstall("Write", { content: "{}" }, '{"name":"x"}'), { specs: null });
  assert.deepEqual(planInstall("Edit", { old_string: '"2"', new_string: '"1"' }, '{"a":"1","b":"1"}'), { specs: null });
});

test("planInstall: malformed post-edit JSON fails open (nothing)", () => {
  assert.equal(planInstall("Write", { content: "{" }, "{"), null);
});

test("planInstall: an unparsable reconstructed old version falls back to a bare install", () => {
  assert.deepEqual(planInstall("Edit", { old_string: "{{", new_string: '{"a":1}' }, '{"a":1}'), { specs: null });
});

const HOOK = "npm-install-on-package-change";

test("outcomeMessage: a clean exit is silent", () => {
  assert.equal(outcomeMessage(HOOK, "npm", "npm install", "/p", { exitCode: 0, stdout: "added 1", stderr: "" }), null);
});

test("outcomeMessage: a failed install reports the command, the exit code and both streams", () => {
  const msg = outcomeMessage(HOOK, "npm", "npm install", "/p", { exitCode: 1, stdout: "out", stderr: "E404" });
  assert.equal(msg, `${HOOK}: \`npm install\` failed in /p (exit code 1):\nout\nE404`);
});

test("outcomeMessage: a failed install's output is truncated", () => {
  const msg = outcomeMessage("npm-ci-on-worktree", "npm", "npm ci", "/p", { exitCode: 1, stdout: "", stderr: "x".repeat(9000) }) ?? "";
  assert.match(msg, /^npm-ci-on-worktree: `npm ci` failed in \/p \(exit code 1\):\n/);
  assert.match(msg, /\(truncated\)$/);
  assert.ok(msg.length < 4200);
});

test("outcomeMessage: our own timeout kill is silent", () => {
  assert.equal(outcomeMessage(HOOK, "npm", "npm install", "/p", { error: "HooksError: npm-automations: $.process.run(npm) aborted: still running after 300000ms" }), null);
});

test("outcomeMessage: a binary missing from PATH is a one-line diagnostic", () => {
  const error = "HooksError: npm-automations: $.process.run(pnpm) failed to start: ENOENT: Executable not found in $PATH: pnpm";
  assert.equal(outcomeMessage("npm-ci-on-worktree", "pnpm", "pnpm install --frozen-lockfile", "/p", { error }), "npm-ci-on-worktree: pnpm not found on PATH, skipped in /p");
});

test("outcomeMessage: a non-ENOENT spawn error (EACCES) is not misreported as missing", () => {
  const error = "HooksError: npm-automations: $.process.run(npm) failed to start: EACCES: EACCES: permission denied, posix_spawn 'npm'";
  const msg = outcomeMessage("npm-ci-on-worktree", "npm", "npm ci", "/p", { error }) ?? "";
  assert.doesNotMatch(msg, /not found on PATH/);
  assert.equal(msg, "npm-ci-on-worktree: `npm ci` failed in /p (spawn error EACCES):\n");
});

test("outcomeMessage: an unrecognized rejection is reported with its whole text", () => {
  assert.equal(outcomeMessage(HOOK, "npm", "npm install", "/p", { error: "boom" }), `${HOOK}: \`npm install\` failed in /p (spawn error boom):\n`);
});
