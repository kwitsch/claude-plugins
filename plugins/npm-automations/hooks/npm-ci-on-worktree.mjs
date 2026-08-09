#!/usr/bin/env node
// hooks/npm-ci-on-worktree.mjs -- npm-automations plugin: PostToolUse EnterWorktree
// hook. Command hook, invoked directly per event (no MCP server). stdin = hook JSON
// (PostToolUseHookInput). The userConfig toggle is read from
// CLAUDE_PLUGIN_OPTION_NPM_CI_ON_WORKTREE -- cc-reference's plugins doc claims Claude
// Code exports every userConfig key to "plugin subprocesses" this way, but that is
// UNVERIFIED for this specific command-hook subprocess type (live-checked on this
// machine only for the plugin's own long-lived MCP server process, where NO
// CLAUDE_PLUGIN_OPTION_* var was present at all -- so treat the claim as unconfirmed,
// not fact). What IS confirmed live: pluginConfigs["coding-toolbox"] is null (never
// explicitly configured via /plugin manage) on this machine, matching the observed
// crash; and a ${user_config.npm_ci_on_worktree} placeholder in hooks.json's args
// hard-errors ("Plugin option ... isn't set") in exactly that unconfigured state, even
// though the schema declares a default -- so that placeholder had to go regardless.
// Net effect if the env var never gets populated for this hook: isNpmCiEnabled(undefined)
// resolves to the documented "unset = enabled" default (plugin-userconfig.md), which is
// strictly no worse than today's fully-broken (crashing) state -- but an explicit
// `false` configured by a user would then silently fail to reach this hook. That gap
// is accepted and documented, not silently assumed away; verify AND fix properly
// (e.g. by having this hook query the plugin's own MCP server, which reliably receives
// ${user_config.*} via .mcp.json's `env` field per worktree_refresh's confirmed-working
// precedent) if this toggle is ever observed not disabling the feature.
// async:true in hooks.json -- the agent loop never waits for the install to finish.
//
// Every branch below exits 0; only a real install failure or a missing-binary PATH
// gap prints anything -- everything else (toggle off, no cwd, no lockfile, killed/
// timed out, clean exit) is a silent no-op, fail open.
//
// Which package manager runs is decided by the lockfile found in `cwd` (see
// detectPackageManager below), not hardcoded to npm -- pnpm-lock.yaml/yarn.lock/
// package-lock.json each select their own binary and lockfile-frozen install
// command. A worktree with no lockfile at all stays a silent no-op, same as before.
import process from "node:process";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NPM_CI_TIMEOUT_MS = 280000; // leaves margin under hooks.json's own timeout: 300
const MAX_CONTEXT_CHARS = 4000; // same cap as universal-lint's lint-file.mjs

// Lockfile presence selects the package manager -- checked in this order so a
// project mid-migration (multiple lockfiles briefly coexisting, e.g. this very repo
// during its own npm->pnpm move) prefers the newer lockfile over npm's. `ciArgs` is
// each manager's lockfile-frozen equivalent of `npm ci` (clean install, never edits
// the lockfile): pnpm's `--frozen-lockfile` and yarn's classic `--frozen-lockfile`
// both still work as of 2026 (yarn berry only deprecated it in favor of `--immutable`,
// not removed it).
const PACKAGE_MANAGERS = [
  { name: "pnpm", lockfile: "pnpm-lock.yaml", ciArgs: ["install", "--frozen-lockfile"] },
  { name: "yarn", lockfile: "yarn.lock", ciArgs: ["install", "--frozen-lockfile"] },
  { name: "npm", lockfile: "package-lock.json", ciArgs: ["ci"] },
];

/** @param {string} dir @returns {{name: string, lockfile: string, ciArgs: string[]} | null} */
export function detectPackageManager(dir) {
  for (const pm of PACKAGE_MANAGERS) {
    if (existsSync(path.join(dir, pm.lockfile))) return pm;
  }
  return null;
}

// Standalone/corepack installs of pnpm and yarn commonly place their binary at
// ~/.local/bin (pnpm's official install script; corepack-shimmed yarn), which a
// non-login/non-interactive PATH inherited by this hook's subprocess may not include
// -- the same PATH gap the bun-preferred mjs-launch.sh wrapper works around for bun
// (see .claude/rules/hooks-mcp-server.md). APPENDED, not prepended: the inherited
// PATH wins, so a stale ~/.local/bin binary can never shadow a canonical one earlier
// on PATH -- same rtk/PATH-review finding already applied to coding-toolbox's and
// universal-format's bin/mjs-launch.sh wrappers.
/** @returns {string} */
export function pathWithLocalBin() {
  const localBin = path.join(homedir(), ".local", "bin");
  const current = process.env.PATH ?? "";
  return current ? `${current}${path.delimiter}${localBin}` : localBin;
}

// Fail-open: only the literal string "false" disables -- deliberate exception to
// plugin-userconfig.md's state-creating-toggle recommendation (fail-closed),
// chosen by the user at this feature's design intent-confirmation gate over the
// original fail-closed draft. See plugins/coding-toolbox/CLAUDE.md.
/** @param {string | undefined} value @returns {boolean} */
export function isNpmCiEnabled(value) {
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

// The npm-ci-on-worktree handler. Returns {} on every guard failure / no
// lockfile / clean run / our own timeout (fail open); every other outcome
// (the manager's binary missing, the install failing for any reason including
// maxBuffer overflow or an unexpected signal) returns additionalContext. timeoutMs
// defaults to NPM_CI_TIMEOUT_MS; only overridden by tests, to exercise the killed-by-
// timeout branch deterministically without a real 280s wait.
/** @param {PostToolUseHookInput} args @param {number} [timeoutMs] @returns {HookResult} */
export function npmCiOnWorktreeHandler(args, timeoutMs = NPM_CI_TIMEOUT_MS) {
  try {
    const cwd = typeof args?.cwd === "string" ? args.cwd : "";
    if (!cwd) return {};
    const manager = detectPackageManager(cwd);
    if (!manager) return {};
    const command = `${manager.name} ${manager.ciArgs.join(" ")}`;

    const result = spawnSync(manager.name, manager.ciArgs, {
      cwd,
      timeout: timeoutMs,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PATH: pathWithLocalBin() },
    });

    // spawnSync sets BOTH result.error and result.signal on a kill (timeout OR
    // maxBuffer overflow) -- only our own intentional 280s timeout (ETIMEDOUT)
    // stays silent. Every other spawn error (ENOENT, EACCES, ENOBUFS from a
    // pathologically verbose failure, ...) and every other signal are real,
    // reportable outcomes -- narrower than a blanket "any signal is silent",
    // which previously also swallowed genuine install failures.
    if (result.error?.code === "ETIMEDOUT") return {}; // our own timeout kill -- accepted silent per design
    if (result.error?.code === "ENOENT") {
      return ctx(`npm-ci-on-worktree: ${manager.name} not found on PATH, skipped in ${cwd}`);
    }
    if (result.status === 0 && !result.error && !result.signal) return {}; // silent on success

    // Everything else: a real, reportable install failure -- nonzero exit, an
    // unexpected spawn error (EACCES, ENOBUFS, ...), or an unexpected signal.
    // Truncate each stream independently before joining -- avoids building a
    // ~20MB intermediate string (up to 10MB maxBuffer on each of stdout and
    // stderr) just to keep the first 4000 chars.
    const reason = result.error ? `spawn error ${result.error.code ?? result.error.message}` : result.signal ? `killed by signal ${result.signal}` : `exit code ${result.status}`;
    const output = `${truncate(result.stdout ?? "")}\n${truncate(result.stderr ?? "")}`;
    return ctx(`npm-ci-on-worktree: \`${command}\` failed in ${cwd} (${reason}):\n${truncate(output)}`);
  } catch {
    return {};
  }
}

// True only when this file is the process entry point (direct command-hook
// invocation), false when imported by a unit test -- so importing never starts
// the stdin loop.
function isMainModule() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

/** Read the userConfig toggle (CLAUDE_PLUGIN_OPTION_NPM_CI_ON_WORKTREE) + the hook's
 * stdin JSON, run the handler, print the result JSON (or nothing) to stdout. Fails
 * open on any error. */
function main() {
  try {
    if (!isNpmCiEnabled(process.env.CLAUDE_PLUGIN_OPTION_NPM_CI_ON_WORKTREE)) return;
    const raw = readFileSync(0, "utf8");
    const input = JSON.parse(raw);
    const result = npmCiOnWorktreeHandler(input);
    if (result && Object.keys(result).length > 0) {
      process.stdout.write(JSON.stringify(result) + "\n");
    }
  } catch {
    // fail open -- no output, exit 0
  }
}

if (isMainModule()) main();
