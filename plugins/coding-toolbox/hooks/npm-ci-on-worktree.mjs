#!/usr/bin/env node
// hooks/npm-ci-on-worktree.mjs -- coding-toolbox plugin: PostToolUse EnterWorktree
// hook. Command hook, invoked directly per event (no MCP server). stdin = hook JSON
// (PostToolUseHookInput); argv[2] = interpolated ${user_config.npm_ci_on_worktree}.
// async:true in hooks.json -- the agent loop never waits for `npm ci` to finish.
//
// Every branch below exits 0; only a real `npm ci` failure or a missing-npm PATH
// gap prints anything -- everything else (toggle off, no cwd, no lockfile, killed/
// timed out, clean exit) is a silent no-op, fail open.
import process from "node:process";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NPM_CI_TIMEOUT_MS = 280000; // leaves margin under hooks.json's own timeout: 300
const MAX_CONTEXT_CHARS = 4000; // same cap as universal-lint's lint-file.mjs

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
  return t.length > MAX_CONTEXT_CHARS
    ? `${t.slice(0, MAX_CONTEXT_CHARS)}\n... (truncated)`
    : t;
}

// The npm-ci-on-worktree handler. Returns {} on every guard failure / no
// lockfile / clean run / our own timeout (fail open); every other outcome
// (npm missing, npm ci failed for any reason including maxBuffer overflow or
// an unexpected signal) returns additionalContext. timeoutMs defaults to
// NPM_CI_TIMEOUT_MS; only overridden by tests, to exercise the killed-by-
// timeout branch deterministically without a real 280s wait.
/** @param {PostToolUseHookInput} args @param {number} [timeoutMs] @returns {HookResult} */
export function npmCiOnWorktreeHandler(args, timeoutMs = NPM_CI_TIMEOUT_MS) {
  try {
    const cwd = typeof args?.cwd === "string" ? args.cwd : "";
    if (!cwd) return {};
    if (!existsSync(path.join(cwd, "package-lock.json"))) return {};

    const result = spawnSync("npm", ["ci"], {
      cwd,
      timeout: timeoutMs,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });

    // spawnSync sets BOTH result.error and result.signal on a kill (timeout OR
    // maxBuffer overflow) -- only our own intentional 280s timeout (ETIMEDOUT)
    // stays silent. Every other spawn error (ENOENT, EACCES, ENOBUFS from a
    // pathologically verbose failure, ...) and every other signal are real,
    // reportable outcomes -- narrower than a blanket "any signal is silent",
    // which previously also swallowed genuine npm-ci failures.
    if (result.error?.code === "ETIMEDOUT") return {}; // our own timeout kill -- accepted silent per design
    if (result.error?.code === "ENOENT") {
      return {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: `npm-ci-on-worktree: npm not found on PATH, skipped in ${cwd}`,
        },
      };
    }
    if (result.status === 0 && !result.error && !result.signal) return {}; // silent on success

    // Everything else: a real, reportable npm-ci failure -- nonzero exit, an
    // unexpected spawn error (EACCES, ENOBUFS, ...), or an unexpected signal.
    const reason = result.error
      ? `spawn error ${result.error.code ?? result.error.message}`
      : result.signal
        ? `killed by signal ${result.signal}`
        : `exit code ${result.status}`;
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `npm-ci-on-worktree: \`npm ci\` failed in ${cwd} (${reason}):\n${truncate(
          `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
        )}`,
      },
    };
  } catch {
    return {};
  }
}

// True only when this file is the process entry point (direct command-hook
// invocation), false when imported by a unit test -- so importing never starts
// the stdin loop.
function isMainModule() {
  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

/** Read argv[2] (userConfig toggle) + the hook's stdin JSON, run the handler,
 * print the result JSON (or nothing) to stdout. Fails open on any error. */
function main() {
  try {
    if (!isNpmCiEnabled(process.argv[2])) return;
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
