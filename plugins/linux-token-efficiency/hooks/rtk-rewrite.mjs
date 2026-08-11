#!/usr/bin/env node
// hooks/rtk-rewrite.mjs — linux-token-efficiency plugin: PreToolUse Bash auto-rewrite.
// Pipes the verbatim hook payload into the bundled binary's own `rtk hook claude`
// protocol (spawned by ABSOLUTE path) and forwards rtk's rewritten command back to the
// harness as hookSpecificOutput.updatedInput. The emitted command keeps rtk's bare
// `rtk …` word: an enabled plugin's bin/ is on the Bash PATH, so it resolves to this
// very binary — no path rewriting, no PATH prefix.
//
// Fail-open everywhere: every failure path is a bare `return` inside main()'s single
// try/catch (no process.exit), so the process exits 0 having printed nothing and the
// Bash command runs unmodified. Ordered guards: stdin size/parse -> platform -> toggle
// -> Bash + non-empty command -> bundled binary executable -> `rtk` resolves on PATH
// and resolves to THIS binary (a global rtk install owns the rewrite instead) -> spawn.
// Not async in hooks.json: a PreToolUse hook returning updatedInput must be synchronous.
import process from "node:process";
import { spawnSync } from "node:child_process";
import { accessSync, readFileSync, realpathSync, constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STDIN_CAP = 1024 * 1024; // same cap as coding-toolbox/hooks/encoding-guard.mjs
const RTK_SPAWN_TIMEOUT_MS = 5000; // stays well under hooks.json's timeout: 10
const RTK_MAX_OUTPUT_BYTES = 1024 * 1024; // spawnSync default is 1 MiB; pinned explicitly

/**
 * userConfig toggle read (CLAUDE_PLUGIN_OPTION_AUTO_REWRITE), fail-open per
 * .claude/rules/plugin-userconfig.md: unset, empty, "true" and an uninterpolated
 * `${user_config.auto_rewrite}` placeholder all count as enabled; only the literal
 * string "false" disables.
 * @param {string|undefined} value
 * @returns {boolean}
 */
export function isAutoRewriteEnabled(value) {
  return String(value ?? "").trim() !== "false";
}

/**
 * First executable `rtk` on the given PATH string, as an absolute path, or null.
 * Patterned after universal-lint's onPath(), but returns the resolved path.
 * @param {string|undefined} pathEnv
 * @returns {string|null}
 */
export function resolveRtkOnPath(pathEnv) {
  for (const dir of (pathEnv || "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, "rtk");
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * Do two paths name the same file on disk? False on any resolution error.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function sameFile(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

/**
 * The PreToolUse result: the ENTIRE original tool_input, with only `command` replaced.
 * updatedInput replaces the whole input object, so a freshly built {command,description}
 * would silently drop timeout / run_in_background and any future harness field.
 * Never emits permissionDecision — `allow` makes the harness drop updatedInput.
 * @param {Record<string, unknown>} toolInput
 * @param {string} command
 * @returns {HookResult}
 */
export function buildUpdatedInput(toolInput, command) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecisionReason: "rtk auto-rewrite (bundled)",
      updatedInput: { ...toolInput, command },
    },
  };
}

// True only when this file is the process entry point, false when imported by a unit
// test -- so importing never reads stdin.
function isMainModule() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

/** @returns {void} */
function main() {
  try {
    const raw = readFileSync(0, "utf8");
    if (raw.length > STDIN_CAP) return;
    /** @type {ToolHookInput} */
    const input = JSON.parse(raw);
    if (process.platform !== "linux") return;
    if (!isAutoRewriteEnabled(process.env.CLAUDE_PLUGIN_OPTION_AUTO_REWRITE)) return;
    if (input.tool_name !== "Bash") return;
    const toolInput = input.tool_input;
    if (!toolInput || typeof toolInput !== "object") return;
    const original = toolInput.command;
    if (typeof original !== "string" || original === "") return;

    const binDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin");
    const bundled = path.join(binDir, "rtk");
    try {
      accessSync(bundled, fsConstants.X_OK);
    } catch {
      return; // no bundled binary to delegate to
    }
    const resolved = resolveRtkOnPath(process.env.PATH);
    if (resolved === null) return; // never emit an `rtk …` we have no evidence resolves
    if (!sameFile(resolved, bundled)) return; // a global rtk install owns the rewrite

    const result = spawnSync(bundled, ["hook", "claude"], {
      input: raw,
      encoding: "utf8",
      timeout: RTK_SPAWN_TIMEOUT_MS,
      maxBuffer: RTK_MAX_OUTPUT_BYTES,
    });
    if (result.error || result.signal) return; // checked before .status/.stdout
    if (result.status !== 0) return;
    const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
    if (stdout === "") return; // rtk had no rewrite for this command
    /** @type {any} */
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return;
    }
    const rewritten = parsed?.hookSpecificOutput?.updatedInput?.command;
    if (typeof rewritten !== "string") {
      process.stdout.write(stdout + "\n"); // some other decision shape: pass through
      return;
    }
    if (rewritten === original) return; // nothing changed
    process.stdout.write(JSON.stringify(buildUpdatedInput(toolInput, rewritten)) + "\n");
  } catch {
    // fail open — no output, exit 0
  }
}

if (isMainModule()) main();
