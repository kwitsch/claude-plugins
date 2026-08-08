#!/usr/bin/env node
// hooks/npm-install-on-package-change.mjs -- npm-automations plugin: PostToolUse
// Write|Edit hook. Command hook, invoked directly per event (no MCP server). stdin =
// hook JSON (PostToolUseHookInput). Toggle read from
// CLAUDE_PLUGIN_OPTION_NPM_INSTALL_ON_PACKAGE_CHANGE (same fail-open env-var route as
// the sibling npm-ci-on-worktree.mjs hook in this plugin).
//
// Runs an install scoped to ONLY the dependency entries that actually changed
// between the pre-edit and post-edit package.json -- a version-only (or scripts/
// description/etc.) edit triggers no install call at all. Old content is
// reconstructed from the Edit tool's own old_string/new_string (no git dependency);
// Write and any ambiguous reconstruction fall back to a plain bare install. Verified
// experimentally: `npm install <name>@<range>` (npm 11.16.0) and `pnpm add
// <name>@<range>` (pnpm 11.20.0) both update an entry already declared anywhere in
// package.json in place, neither moves it into `dependencies` -- every spec here is
// read back from the file's own current, already-correct-section state, so a single
// flat `<manager> <verb> <spec>...` call is safe (no per-field grouping needed).
//
// Concurrent edits to the same package.json are serialized with a filesystem lock so
// two async installs in one directory never race on node_modules/the lockfile -- this
// hook (unlike the sibling, which fires at most once per EnterWorktree) can fire
// repeatedly in quick succession.
//
// async:true in hooks.json -- the agent loop never waits for the install to finish.
// Every branch below exits 0; only a real install failure, a missing-binary PATH
// gap, or giving up on a contended lock prints anything.
//
// Which package manager runs is decided by the lockfile found next to package.json
// (see detectPackageManager below), not hardcoded to npm. A directory with no
// lockfile yet (first-ever install right after `package.json` is created) defaults
// to npm, matching this hook's original behavior.
import process from "node:process";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, openSync, closeSync, unlinkSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir, homedir } from "node:os";
import { createHash } from "node:crypto";

const NPM_INSTALL_TIMEOUT_MS = 280000; // leaves margin under hooks.json's own timeout: 300
const MAX_CONTEXT_CHARS = 4000; // same cap as the sibling npm-ci-on-worktree.mjs hook
const DEP_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"];
const LOCK_STALE_MS = 10 * 60 * 1000; // abandoned-lock threshold (crashed prior process)
const LOCK_POLL_MS = 250;

// Same package-manager detection as the sibling npm-ci-on-worktree.mjs hook
// (duplicated, not shared -- each command hook here is a fully self-contained
// process, same as this file's own pre-existing truncate/ctx duplication). Checked
// in this priority order so a project mid-migration prefers the newer lockfile over
// npm's. DEFAULT_MANAGER (npm) is used only when no lockfile exists at all.
const PACKAGE_MANAGERS = [
  { name: "pnpm", lockfile: "pnpm-lock.yaml" },
  { name: "yarn", lockfile: "yarn.lock" },
  { name: "npm", lockfile: "package-lock.json" },
];
const DEFAULT_MANAGER = PACKAGE_MANAGERS[2];

/** @param {string} dir @returns {{name: string, lockfile: string} | null} */
export function detectPackageManager(dir) {
  for (const pm of PACKAGE_MANAGERS) {
    if (existsSync(path.join(dir, pm.lockfile))) return pm;
  }
  return null;
}

// Same PATH gap and fix as the sibling npm-ci-on-worktree.mjs hook -- see its
// comment and .claude/rules/hooks-mcp-server.md's bun-preferred wrapper precedent.
/** @returns {string} */
export function pathWithLocalBin() {
  const localBin = path.join(homedir(), ".local", "bin");
  const current = process.env.PATH ?? "";
  return current ? `${localBin}${path.delimiter}${current}` : localBin;
}

// pnpm/yarn use `add <spec>...` to install/update specific specs (both verified to
// update an existing dependencies/devDependencies/optionalDependencies entry in
// place, same as npm -- see CLAUDE.md) and bare `install` (no args) to reconcile
// from the current package.json, same as npm's bare `install`.
/** @param {string} managerName @param {string[] | null} specs @returns {string[]} */
export function installArgsFor(managerName, specs) {
  if (specs === null) return ["install"];
  return managerName === "npm" ? ["install", ...specs] : ["add", ...specs];
}

// Lock lives in the OS temp dir, keyed by a hash of the target directory -- never
// inside the project tree itself (would otherwise be visible to `git status`/
// `git add -A`, and could linger there for up to LOCK_STALE_MS after a hard kill).
/** @param {string} cwd @returns {string} */
export function lockPathFor(cwd) {
  const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
  return path.join(tmpdir(), `npm-automations-install-${hash}.lock`);
}

/** @param {string | undefined} value @returns {boolean} */
export function isNpmInstallEnabled(value) {
  return value !== "false";
}

/** @param {string} text @returns {string} */
export function truncate(text) {
  const t = text.trim();
  return t.length > MAX_CONTEXT_CHARS ? `${t.slice(0, MAX_CONTEXT_CHARS)}\n... (truncated)` : t;
}

/** @param {string} message @returns {HookResult} */
function ctx(message) {
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: message,
    },
  };
}

/** @param {string} haystack @param {string} needle @returns {number} */
export function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

// Reconstructs the pre-edit file content from the tool's own old_string/new_string.
// Returns null when reconstruction isn't safely possible: Write carries no prior
// content in tool_input; an ambiguous Edit (new_string not unique post-edit, e.g. a
// replace_all:true edit) can't be trusted to identify the right occurrence.
/** @param {string} toolName @param {Record<string, unknown>} toolInput @param {string} newContent @returns {string | null} */
export function reconstructOld(toolName, toolInput, newContent) {
  if (toolName !== "Edit") return null;
  const oldString = toolInput?.old_string;
  const newString = toolInput?.new_string;
  if (typeof oldString !== "string" || typeof newString !== "string") return null;
  if (countOccurrences(newContent, newString) !== 1) return null;
  return newContent.replace(newString, oldString);
}

// Diffs DEP_FIELDS between the old and new parsed package.json. Returns the list of
// `name@range` specs that are new or changed; removed entries are ignored (no
// `npm uninstall` -- out of scope).
/** @param {Record<string, any>} oldPkg @param {Record<string, any>} newPkg @returns {string[]} */
export function collectChangedSpecs(oldPkg, newPkg) {
  const specs = [];
  for (const field of DEP_FIELDS) {
    const newDeps = newPkg?.[field] ?? {};
    const oldDeps = oldPkg?.[field] ?? {};
    for (const [name, range] of Object.entries(newDeps)) {
      if (oldDeps[name] !== range) specs.push(`${name}@${range}`);
    }
  }
  return specs;
}

// Acquires an exclusive per-directory install lock, waiting (bounded) if another
// instance already holds it; reclaims a lock older than staleMs (an abandoned lock
// from a crashed prior process). Returns false if the wait budget expires first.
/** @param {string} lockPath @param {number} staleMs @param {number} waitBudgetMs @returns {boolean} */
export function acquireLock(lockPath, staleMs, waitBudgetMs) {
  const deadline = Date.now() + waitBudgetMs;
  for (;;) {
    try {
      closeSync(openSync(lockPath, "wx"));
      return true;
    } catch (err) {
      if (/** @type {any} */ (err)?.code !== "EEXIST") return false;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > staleMs) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue; // lock disappeared between the failed open and this stat -- retry
      }
      if (Date.now() >= deadline) return false;
      const slept = spawnSync("sleep", [String(LOCK_POLL_MS / 1000)]);
      // `sleep` missing from PATH (ENOENT) would otherwise turn this into a hot
      // spin for the whole wait budget -- give up immediately instead.
      if (slept.error) return false;
    }
  }
}

/** @param {string} lockPath */
export function releaseLock(lockPath) {
  try {
    unlinkSync(lockPath);
  } catch {
    // already gone -- fine
  }
}

/** @param {PostToolUseHookInput} args @param {number} [timeoutMs] @returns {HookResult} */
export function npmInstallOnPackageChangeHandler(args, timeoutMs = NPM_INSTALL_TIMEOUT_MS) {
  try {
    // One shared budget for both phases below (lock wait + npm install): giving each a
    // full timeoutMs could together overrun hooks.json's own 300s timeout and get this
    // process killed mid-install, leaving a stale lock behind.
    const deadline = Date.now() + timeoutMs;
    const filePath = typeof args?.tool_input?.file_path === "string" ? args.tool_input.file_path : "";
    if (!filePath || path.basename(filePath) !== "package.json") return {};
    if (filePath.includes(`${path.sep}node_modules${path.sep}`)) return {};
    if (!existsSync(filePath)) return {};

    const newContent = readFileSync(filePath, "utf8");
    let newPkg;
    try {
      newPkg = JSON.parse(newContent);
    } catch {
      return {}; // invalid post-edit JSON -- fail open
    }

    const oldContent = reconstructOld(args.tool_name, args.tool_input, newContent);
    let specs = null; // null = full `npm install`; [] = nothing to do; [...] = targeted
    if (oldContent !== null) {
      try {
        const oldPkg = JSON.parse(oldContent);
        specs = collectChangedSpecs(oldPkg, newPkg);
      } catch {
        specs = null; // couldn't parse reconstructed old content -- fall back to full install
      }
    }
    if (specs !== null && specs.length === 0) return {}; // e.g. version-only change

    const cwd = path.dirname(filePath);
    const manager = detectPackageManager(cwd) ?? DEFAULT_MANAGER;
    const lockPath = lockPathFor(cwd);
    if (!acquireLock(lockPath, LOCK_STALE_MS, Math.max(0, deadline - Date.now()))) {
      return ctx(`npm-install-on-package-change: gave up waiting on a concurrent install lock in ${cwd}`);
    }
    try {
      const npmArgs = installArgsFor(manager.name, specs);
      // Whatever the lock wait left over. Floor of 1, never 0: spawnSync treats
      // timeout: 0 as "no timeout at all" (and rejects a negative value outright), so
      // an already-exhausted budget must still bound the install -- it gets killed at
      // once (ETIMEDOUT -> silent no-op below) rather than running unbounded.
      const result = spawnSync(manager.name, npmArgs, {
        cwd,
        timeout: Math.max(1, deadline - Date.now()),
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, PATH: pathWithLocalBin() },
      });

      if (result.error?.code === "ETIMEDOUT") return {};
      if (result.error?.code === "ENOENT") {
        return ctx(`npm-install-on-package-change: ${manager.name} not found on PATH, skipped in ${cwd}`);
      }
      if (result.status === 0 && !result.error && !result.signal) return {};

      const reason = result.error ? `spawn error ${result.error.code ?? result.error.message}` : result.signal ? `killed by signal ${result.signal}` : `exit code ${result.status}`;
      const output = `${truncate(result.stdout ?? "")}\n${truncate(result.stderr ?? "")}`;
      return ctx(`npm-install-on-package-change: \`${manager.name} ${npmArgs[0]}\` failed in ${cwd} (${reason}):\n${truncate(output)}`);
    } finally {
      releaseLock(lockPath);
    }
  } catch {
    return {};
  }
}

function isMainModule() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

function main() {
  try {
    if (!isNpmInstallEnabled(process.env.CLAUDE_PLUGIN_OPTION_NPM_INSTALL_ON_PACKAGE_CHANGE)) return;
    const raw = readFileSync(0, "utf8");
    const input = JSON.parse(raw);
    const result = npmInstallOnPackageChangeHandler(input);
    if (result && Object.keys(result).length > 0) {
      process.stdout.write(JSON.stringify(result) + "\n");
    }
  } catch {
    // fail open -- no output, exit 0
  }
}

if (isMainModule()) main();
