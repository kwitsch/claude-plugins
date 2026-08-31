#!/usr/bin/env node
// hooks/rtk-rewrite.mjs — linux-token-efficiency plugin: PreToolUse Bash router.
// One synchronous hook, two exits (two separate hooks on the same matcher would race
// deny against updatedInput):
//
// 1. STEER (context-mode): a conservatively classified read-only gather command —
//    a bare curl GET, a >=3-segment chain of text tools, or a >=3-stage text
//    pipeline — is denied with a copy-ready replacement call on context-mode's
//    ctx_fetch_and_index / ctx_batch_execute / ctx_execute. This is the ONLY path
//    that ever emits permissionDecision. Gated by the steer_enabled toggle.
// 2. REWRITE (rtk): everything else is piped verbatim into the bundled binary's own
//    `rtk hook claude` protocol (spawned by ABSOLUTE path) and rtk's rewritten command
//    is forwarded back as hookSpecificOutput.updatedInput. The emitted command keeps
//    rtk's bare `rtk …` word: when ~/.local/bin is on the Bash PATH, so it resolves to
//    the managed binary — no path rewriting, no PATH prefix. Gated by the auto_rewrite
//    toggle.
//
// The split is the deliberate rtk/context-mode balance: git/gh and other side-effect
// or single commands STAY in Bash under rtk compression (the measured winner for that
// class); only the read-only gather class rtk does not rewrite is steered into the
// context-mode sandbox, where output is indexed instead of entering context.
//
// Fail-open everywhere: every failure path is a bare `return` inside main()'s single
// try/catch (no process.exit), so the process exits 0 having printed nothing and the
// Bash command runs unmodified. Ordered guards: platform -> stdin size/parse
// -> Bash + non-empty command -> steer classification -> rewrite toggle -> managed
// ~/.local/bin/rtk executable + a regular file -> `rtk` resolves on PATH and resolves to
// THIS binary (a global rtk install owns the rewrite instead) -> spawn.
// Platform is checked before touching stdin: on any non-Linux host every Bash call
// would otherwise pay for a readFileSync(0) + JSON.parse it can never use.
// Not async in hooks.json: a PreToolUse hook returning updatedInput must be synchronous.
import process from "node:process";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { accessSync, lstatSync, readFileSync, realpathSync, constants as fsConstants } from "node:fs";
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
 * steer_enabled toggle (CLAUDE_PLUGIN_OPTION_STEER_ENABLED), same fail-open semantics
 * as auto_rewrite: only the literal string "false" disables the context-mode steering.
 * @param {string|undefined} value
 * @returns {boolean}
 */
export function isSteerEnabled(value) {
  return String(value ?? "").trim() !== "false";
}

// Full MCP tool-name prefix for the plugin-bundled context-mode server. Deny reasons
// spell it out once so the model can call the tool without guessing the namespace.
const CTX_TOOL_PREFIX = "mcp__plugin_linux-token-efficiency_context-mode__";

// Heads that make a pipe stage / chain segment steerable: read-only text/gather tools
// whose raw output floods context and that rtk has no rewrite for. Anything not listed
// (git, gh, rm, sed, xargs, echo, unknown binaries, …) keeps the command in Bash —
// conservative by construction: an unknown head means "do not steer".
const READ_ONLY_HEADS = new Set([
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "find",
  "cat",
  "head",
  "tail",
  "awk",
  "sort",
  "uniq",
  "wc",
  "cut",
  "tr",
  "jq",
  "ls",
  "stat",
  "du",
  "df",
  "diff",
  "comm",
  "column",
  "nl",
  "file",
  "basename",
  "dirname",
  "realpath",
]);

/**
 * Split a command into top-level segments (on `&&`, `||`, `;`) and each segment into
 * pipe stages, honoring single/double quotes and backslash escapes. Returns null —
 * meaning "too complex, do not steer" — on anything beyond that flat shape: command
 * substitution, subshells/brace groups, redirects/heredocs, background `&`, comments,
 * or newlines. Null is always safe: the command simply stays in Bash.
 * @param {string} command
 * @returns {{text: string, stages: string[]}[]|null}
 */
export function splitTopLevel(command) {
  /** @type {{text: string, stages: string[]}[]} */
  const segments = [];
  /** @type {string[]} */
  let stages = [];
  let stage = "";
  let text = "";
  let inSingle = false;
  let inDouble = false;
  const endStage = () => {
    const t = stage.trim();
    if (t === "") return false;
    stages.push(t);
    stage = "";
    return true;
  };
  const endSegment = () => {
    if (!endStage()) return false;
    const t = text.trim();
    if (t === "") return false;
    segments.push({ text: t, stages });
    stages = [];
    text = "";
    return true;
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      stage += ch;
      text += ch;
      continue;
    }
    if (ch === "\\") {
      const next = command[i + 1] ?? "";
      stage += ch + next;
      text += ch + next;
      i++;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      else if (ch === "`" || (ch === "$" && command[i + 1] === "(")) return null;
      stage += ch;
      text += ch;
      continue;
    }
    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    else if (ch === "`" || ch === ">" || ch === "<" || ch === "(" || ch === ")" || ch === "#" || ch === "\n") return null;
    else if (ch === "$" && command[i + 1] === "(") return null;
    else if ((ch === "{" || ch === "}") && command[i - 1] !== "$" && !/[{,]/.test(command[i - 1] ?? "")) return null;
    else if (ch === "&") {
      if (command[i + 1] !== "&") return null; // background job / fd duplication
      if (!endSegment()) return null;
      i++;
      continue;
    } else if (ch === ";") {
      if (!endSegment()) return null;
      continue;
    } else if (ch === "|") {
      if (command[i + 1] === "|") {
        if (!endSegment()) return null;
        i++;
      } else if (!endStage()) {
        return null;
      } else {
        text += ch;
      }
      continue;
    }
    stage += ch;
    text += ch;
  }
  if (inSingle || inDouble) return null;
  if (stage.trim() !== "" || stages.length > 0) {
    if (!endSegment()) return null;
  }
  return segments.length > 0 ? segments : null;
}

/**
 * The executable word of one pipe stage, skipping leading VAR=VALUE assignments and a
 * leading `command`. Empty string when none is found.
 * @param {string} stage
 * @returns {string}
 */
export function commandHead(stage) {
  for (const token of stage.trim().split(/\s+/)) {
    if (token === "command") continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    return token;
  }
  return "";
}

/**
 * True when a curl token indicates an upload, an explicit method, or a file
 * write — those fetches legitimately stay in Bash. Combined short flags (-sSo) are
 * caught by the character test.
 * @param {string} token
 * @returns {boolean}
 */
function isFetchWriteFlag(token) {
  if (/^--(data|form|upload-file|output|remote-name|method|post-data|post-file|json|request)/.test(token)) return true;
  return /^-[A-Za-z]+$/.test(token) && /[odOFTXD]/.test(token);
}

/**
 * Conservative steer classifier. Steers ONLY three shapes, everything else stays:
 * - fetch: a single bare curl GET of an http(s) URL -> ctx_fetch_and_index (wget
 *   stays: its default is a file download, a side effect the steer cannot replicate)
 * - batch: >=3 chained segments whose every stage head is a read-only text tool -> ctx_batch_execute
 * - pipeline: a >=3-stage all-read-only pipe (<=2 segments) -> ctx_execute
 * @param {string} command
 * @returns {{kind: "stay"}|{kind: "fetch", url: string}|{kind: "batch", commands: string[]}|{kind: "pipeline", command: string}}
 */
export function classifyBashCommand(command) {
  /** @type {{kind: "stay"}} */
  const stay = { kind: "stay" };
  const segments = splitTopLevel(command);
  if (!segments) return stay;
  const heads = segments.map((seg) => seg.stages.map(commandHead));
  if (heads.some((seg) => seg.some((h) => h === ""))) return stay;
  if (segments.length === 1 && segments[0].stages.length === 1) {
    // curl only: a bare curl prints the response to stdout (pure context flood), while
    // wget's default is a file download — a side effect ctx_fetch_and_index cannot
    // replicate, so wget always stays in Bash.
    const head = heads[0][0];
    if (head === "curl") {
      const tokens = segments[0].stages[0].split(/\s+/).map((t) => t.replace(/^["']|["']$/g, ""));
      const url = tokens.find((t) => /^https?:\/\//.test(t));
      if (url !== undefined && !tokens.some(isFetchWriteFlag)) return { kind: "fetch", url };
      return stay;
    }
  }
  if (!heads.every((seg) => seg.every((h) => READ_ONLY_HEADS.has(h)))) return stay;
  if (segments.length >= 3) return { kind: "batch", commands: segments.map((s) => s.text) };
  if (segments.some((s) => s.stages.length >= 3)) return { kind: "pipeline", command: command.trim() };
  return stay;
}

/**
 * The PreToolUse deny result steering a classified command to context-mode, or null
 * for kind "stay". The reason is a complete, copy-ready replacement call plus an
 * explicit "do not retry via Bash" so the model cannot loop on the denial.
 * @param {ReturnType<typeof classifyBashCommand>} classification
 * @returns {HookResult|null}
 */
export function buildSteerDeny(classification) {
  let reason;
  if (classification.kind === "fetch") {
    let source = "web";
    try {
      source = new URL(classification.url).hostname || "web";
    } catch {
      /* keep the fallback label */
    }
    reason =
      `context-mode steer: do not fetch URLs through Bash and do not retry this command. ` +
      `Call ctx_fetch_and_index (${CTX_TOOL_PREFIX}ctx_fetch_and_index) with ` +
      `{"url": ${JSON.stringify(classification.url)}, "source": ${JSON.stringify(source)}}, ` +
      `then ctx_search(queries: [...]) to read the indexed content — the raw response never enters the context window.`;
  } else if (classification.kind === "batch") {
    const commands = classification.commands.map((c, i) => ({ label: `${i + 1}: ${commandHead(c) || "cmd"}`, command: c }));
    reason =
      `context-mode steer: this read-only multi-command gather floods the context window via Bash. ` +
      `Do not retry it as a Bash call. Call ctx_batch_execute (${CTX_TOOL_PREFIX}ctx_batch_execute) with ` +
      `commands: ${JSON.stringify(commands)} and queries for what you actually need — ` +
      `output is indexed and only search results enter context.`;
  } else if (classification.kind === "pipeline") {
    reason =
      `context-mode steer: this read-only pipeline floods the context window via Bash. ` +
      `Do not retry it as a Bash call. Call ctx_execute (${CTX_TOOL_PREFIX}ctx_execute) with ` +
      `{"language": "shell", "code": ${JSON.stringify(classification.command)}} — only stdout you print enters context.`;
  } else {
    return null;
  }
  reason += " (Set the linux-token-efficiency plugin option steer_enabled to false to disable this routing.)";
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

/**
 * A string is usable as a home directory only when non-empty and free of an
 * uninterpolated `${` placeholder.
 * @param {string|undefined} value
 * @returns {boolean}
 */
function usableHome(value) {
  return typeof value === "string" && value.trim() !== "" && !value.includes("${");
}

/**
 * The plugin-managed rtk install path (${HOME}/.local/bin/rtk). Resolves the home
 * directory the same way rtk-install.mjs's resolveHome() does — env.HOME when usable,
 * else os.homedir() — so the two stay in agreement about where rtk was installed.
 * Returns null only when neither source yields a usable home. Never returns a
 * ${-bearing path.
 * @param {Record<string, string|undefined>} env
 * @returns {string|null}
 */
export function resolveManagedRtk(env) {
  let home = null;
  if (usableHome(env.HOME)) {
    home = String(env.HOME).trim();
  } else {
    try {
      const h = os.homedir();
      if (usableHome(h)) home = h;
    } catch {
      home = null;
    }
  }
  if (home === null) return null;
  return path.join(home, ".local", "bin", "rtk");
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
 * Never emits permissionDecision — `allow` makes the harness drop updatedInput. The only
 * permissionDecision this hook ever emits is the steer branch's own deny (buildSteerDeny);
 * rtk's raw JSON is never forwarded (see the passthrough-rejection path below).
 * @param {Record<string, unknown>} toolInput
 * @param {string} command
 * @returns {HookResult}
 */
export function buildUpdatedInput(toolInput, command) {
  /** @type {HookSpecificOutput} */
  const hookSpecificOutput = {
    hookEventName: "PreToolUse",
    permissionDecisionReason: "rtk auto-rewrite (bundled)",
    updatedInput: { ...toolInput, command },
  };
  return { hookSpecificOutput };
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
    if (process.platform !== "linux") return;
    const raw = readFileSync(0, "utf8");
    if (raw.length > STDIN_CAP) return;
    /** @type {ToolHookInput} */
    const input = JSON.parse(raw);
    if (input.tool_name !== "Bash") return;
    const toolInput = input.tool_input;
    if (!toolInput || typeof toolInput !== "object") return;
    const original = toolInput.command;
    if (typeof original !== "string" || original === "") return;

    // STEER branch. Never for backgrounded commands: ctx_* tools cannot background,
    // so denying one would strand the model without a replacement.
    if (isSteerEnabled(process.env.CLAUDE_PLUGIN_OPTION_STEER_ENABLED) && toolInput.run_in_background !== true && toolInput.run_in_background !== "true") {
      const steer = buildSteerDeny(classifyBashCommand(original));
      if (steer !== null) {
        process.stdout.write(JSON.stringify(steer) + "\n");
        return;
      }
    }

    // REWRITE branch.
    if (!isAutoRewriteEnabled(process.env.CLAUDE_PLUGIN_OPTION_AUTO_REWRITE)) return;
    const managed = resolveManagedRtk(process.env);
    if (managed === null) return; // HOME unusable
    try {
      accessSync(managed, fsConstants.X_OK);
    } catch {
      return; // ~/.local/bin/rtk not installed yet (SessionStart install pending) — fail-open
    }
    try {
      if (!lstatSync(managed).isFile()) return; // reject a symlink / non-regular file
    } catch {
      return;
    }
    const resolved = resolveRtkOnPath(process.env.PATH);
    if (resolved === null) return; // never emit an `rtk …` we have no evidence resolves (~/.local/bin not on PATH)
    if (!sameFile(resolved, managed)) return; // a global rtk install owns the rewrite; never double-wire

    const result = spawnSync(managed, ["hook", "claude"], {
      input: raw,
      encoding: "utf8",
      timeout: RTK_SPAWN_TIMEOUT_MS,
      maxBuffer: RTK_MAX_OUTPUT_BYTES,
      cwd: typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : undefined,
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
    const hso = parsed?.hookSpecificOutput;
    const rewritten = hso?.updatedInput?.command;
    // Anything other than a plain rewritten command (e.g. rtk's own permissionDecision)
    // is rejected, not forwarded: this wrapper must never emit permissionDecision, and
    // writing rtk's raw JSON through unchecked would do exactly that.
    if (typeof rewritten !== "string") return;
    if (rewritten === original) return; // nothing changed
    const output = buildUpdatedInput(toolInput, rewritten);
    process.stdout.write(JSON.stringify(output) + "\n");
  } catch {
    // fail open — no output, exit 0
  }
}

if (isMainModule()) main();
