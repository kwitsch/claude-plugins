// hooks/rtk-rewrite.mjs — linux-token-efficiency plugin: the pure policy behind the
// mods hooks module's PreToolUse-equivalent `tool.call` hooks (hooks/register.ts).
// Zero-dep, no `node:` import and never the mods `$`: the engine refuses passing `$`
// into an imported function, and a mods module is not known to load node built-ins.
// Every file system, environment and process access lives in register.ts.
//
// The Bash hook is a router with two exits, in this order:
//
// 1. STEER (context-mode): a conservatively classified read-only gather command —
//    a bare curl GET, a >=3-segment chain of text tools, or a >=3-stage text
//    pipeline — is denied with a copy-ready replacement call on context-mode's
//    ctx_fetch_and_index / ctx_batch_execute / ctx_execute. Gated by steer_enabled.
// 2. REWRITE (rtk): everything else is piped into the managed binary's own
//    `rtk hook claude` protocol (spawned by ABSOLUTE path) and rtk's rewritten command
//    replaces `command`. The command keeps rtk's bare `rtk …` word — no path
//    rewriting, no PATH prefix. Gated by auto_rewrite.
//
// The split is the deliberate rtk/context-mode balance: git/gh and other side-effect
// or single commands STAY in Bash under rtk compression (the measured winner for that
// class); only the read-only gather class rtk does not rewrite is steered into the
// context-mode sandbox, where output is indexed instead of entering context.

/** Same cap the command hook applied to its stdin: a larger command is left alone. */
export const INPUT_CAP = 1024 * 1024;
/** `rtk hook claude` round-trip bound; a slower rtk means no rewrite. */
export const RTK_SPAWN_TIMEOUT_MS = 5000;
/** One `git rev-parse --git-dir --git-common-dir` call. */
export const GIT_WORKTREE_CHECK_TIMEOUT_MS = 2000;

/**
 * auto_rewrite toggle, fail-open per .claude/rules/plugin-userconfig.md: unset, empty,
 * true/"true" and an uninterpolated `${user_config.auto_rewrite}` placeholder all count
 * as enabled; only false / the literal string "false" disables.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isAutoRewriteEnabled(value) {
  return String(value ?? "").trim() !== "false";
}

/**
 * steer_enabled toggle, same fail-open semantics as auto_rewrite: only false / the
 * literal string "false" disables the context-mode steering.
 * @param {unknown} value
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
 * True when a rtk-rewritten command still carries a bare `git` token among its
 * operands (e.g. `rtk git status`) -- the exact shape the harness's own
 * worktree-isolation guard refuses outright in a linked worktree, because it cannot
 * verify cwd/root through the opaque rtk wrapper the way it can for a direct
 * `git ...` invocation. Whitespace-token match only, matching this file's other
 * simple lexing (commandHead) rather than a full shell parse.
 * @param {string} command
 * @returns {boolean}
 */
export function hasGitOperand(command) {
  return command.split(/\s+/).includes("git");
}

/**
 * The git dir and the common dir from one `git rev-parse --git-dir --git-common-dir`
 * run in `cwd`, each made absolute against `cwd` (git prints a relative `.git` from
 * a worktree root). Null unless git exited 0 with exactly those two lines. register.ts
 * resolves both through the file system: a linked worktree is a checkout whose
 * resolved git dir differs from its resolved common dir — the same `-ef` comparison
 * coding-toolbox's fresh-pr/finish-pr git-context blocks use in shell form.
 * @param {number} exitCode
 * @param {string} stdout
 * @param {string} cwd absolute
 * @returns {[string, string]|null}
 */
export function gitDirs(exitCode, stdout, cwd) {
  if (exitCode !== 0) return null;
  const lines = stdout.trim().split("\n");
  if (lines.length !== 2 || lines.some((l) => l.trim() === "")) return null;
  const abs = (/** @type {string} */ p) => (p.startsWith("/") ? p : `${cwd.replace(/\/+$/, "")}/${p}`);
  return [abs(lines[0].trim()), abs(lines[1].trim())];
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
 * The plugin-managed rtk install path (${HOME}/.local/bin/rtk), or null when HOME is
 * unusable (unset, blank, or a `${`-bearing placeholder). Never returns a `${`-bearing
 * path. shortcut: no os.homedir() passwd fallback (a mods module has no such API), so
 * an unset HOME means no rewrite; upgrade if a host without HOME ever matters.
 * @param {{HOME?: string}} env
 * @returns {string|null}
 */
export function resolveManagedRtk(env) {
  if (!usableHome(env.HOME)) return null;
  return `${String(env.HOME).trim()}/.local/bin/rtk`;
}

/**
 * Where a bare `rtk` can resolve in the Bash tool, in lookup order: `<dir>/rtk` for
 * every non-empty PATH entry, then this plugin's own `bin/rtk` PATH bridge — Claude
 * Code appends each enabled plugin's `bin/` to the Bash PATH, not to its own.
 * @param {string|undefined} pathEnv
 * @param {string} pluginBin absolute `<plugin root>/bin`
 * @returns {string[]}
 */
export function rtkCandidates(pathEnv, pluginBin) {
  return [...(pathEnv || "").split(":").filter((d) => d !== ""), pluginBin].map((d) => `${d.replace(/\/+$/, "")}/rtk`);
}

/**
 * rtk's rewritten command from `rtk hook claude` stdout, or null when there is none to
 * apply: empty output (no rewrite for this command), unparseable output, any shape
 * other than a plain `hookSpecificOutput.updatedInput.command` string (e.g. rtk's own
 * permissionDecision — never forwarded), or a command identical to the original.
 * @param {string} stdout
 * @param {string} original
 * @returns {string|null}
 */
export function parseRtkRewrite(stdout, original) {
  const out = stdout.trim();
  if (out === "") return null;
  /** @type {any} */
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    return null;
  }
  const rewritten = parsed?.hookSpecificOutput?.updatedInput?.command;
  if (typeof rewritten !== "string" || rewritten === original) return null;
  return rewritten;
}

/**
 * The deny steering one WebFetch URL to ctx_fetch_and_index. The reason is a complete
 * replacement call plus an explicit "do not retry WebFetch" so the model cannot loop on
 * the denial. Every URL steers: WebFetch has no comparable non-context-mode equivalent.
 * @param {string} url
 * @returns {HookResult}
 */
export function buildWebFetchDeny(url) {
  let source = "web";
  try {
    source = new URL(url).hostname || "web";
  } catch {
    /* keep the fallback label */
  }
  const reason =
    `context-mode steer: WebFetch is routed through the context-mode MCP server. ` +
    `Do not retry WebFetch for this URL. Call ctx_fetch_and_index (${CTX_TOOL_PREFIX}ctx_fetch_and_index) with ` +
    `{"url": ${JSON.stringify(url)}, "source": ${JSON.stringify(source)}}, then ctx_search(queries: [...]) ` +
    `to read the indexed content — the raw page never enters the context window. ` +
    `(Set the linux-token-efficiency plugin option steer_enabled to false to disable this routing.)`;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}
