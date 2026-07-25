#!/usr/bin/env node
// Self-contained, zero-dependency MCP stdio server (Node built-ins only).
// Backs the coding-toolbox Stop-hook mechanical gate for the Interaction axis
// (interaction_gate). Invoked directly as the .mcp.json command.
// Transport: newline-delimited JSON-RPC 2.0. stdout = JSON-RPC only; logs → stderr.
import process from "node:process";
import readline from "node:readline";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SERVER_NAME = "coding-toolbox-hooks"; // keep aligned with the .mcp.json key
const SERVER_INFO = { name: SERVER_NAME, version: "0.1.0" };
const DEFAULT_PROTOCOL = "2025-11-25"; // only used if client omits protocolVersion

// Matches a final non-empty line ending in "?" outside fenced code blocks —
// the Interaction axis's "never a bare question to the user" anti-pattern.
const BARE_QUESTION_RE = /\?\s*$/;

startServer();

// Stop mechanical gate for the Interaction axis: `last_assistant_message` is
// the documented Stop-hook field carrying Claude's final response text, so no
// transcript parsing is needed. If the last non-empty line outside fenced
// code blocks ends in "?", block the stop and tell Claude to redo it via
// AskUserQuestion. Loop safety is the platform's (stop_hook_active input +
// 8-consecutive-block cap) — no extra guard needed here.
/** @param {StopHookInput} args @returns {HookResult} */
function interactionGateHandler(args) {
  const withoutFences = String(args?.last_assistant_message ?? "").replace(
    /```[\s\S]*?```/g,
    "",
  );
  const lines = withoutFences
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const lastLine = lines[lines.length - 1] ?? "";
  if (!BARE_QUESTION_RE.test(lastLine)) return {}; // no opinion → allow stop
  return {
    decision: "block",
    reason:
      "Interaction rule violation: the final response ends with a plain-text question to the user. Route it through the AskUserQuestion tool instead — no exceptions, not even a casual yes/no offer.",
  };
}

// Per-call wall-clock bound. This server handles stdin messages synchronously on
// a single thread, so an unbounded git against a slow/unreachable remote would
// block every later tool call too, not just this hook.
const GIT_TIMEOUT_MS = 30_000;

/** @param {string} cwd @param {string[]} args @returns {string} */
function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: GIT_TIMEOUT_MS,
  }).trim();
}

// Same inode-safe comparison as fresh-branch's SKILL.md script (-ef, not string
// equality — from inside a worktree --git-dir is absolute, --git-common-dir can be
// relative, so a naive string compare false-negatives on the very case this exists
// to detect). A relative value is relative to the git process's cwd — i.e. `cwd`
// here, NOT this server's own cwd, which is what realpathSync would resolve it
// against — so resolve it explicitly first (a no-op on an absolute value).
/** @param {string} cwd @returns {boolean} */
function isLinkedWorktree(cwd) {
  const resolve = (/** @type {string[]} */ args) =>
    fs.realpathSync(path.resolve(cwd, git(cwd, args)));
  try {
    const gitDir = resolve(["rev-parse", "--git-dir"]);
    const commonDir = resolve(["rev-parse", "--git-common-dir"]);
    return gitDir !== commonDir;
  } catch {
    return false;
  }
}

// Mirrors fresh-branch's detect_default(): prefer the cached origin/HEAD symlink,
// refreshed once; fall back to parsing `git remote show origin`.
/** @param {string} cwd @returns {string | null} */
function detectDefaultBranch(cwd) {
  try {
    git(cwd, ["remote", "set-head", "origin", "--auto"]);
  } catch {
    /* best effort */
  }
  try {
    const ref = git(cwd, [
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ]);
    if (ref) return ref.replace(/^origin\//, "");
  } catch {
    /* fall through */
  }
  try {
    const shown = git(cwd, ["remote", "show", "origin"]);
    const m = shown.match(/HEAD branch:\s*(\S+)/);
    if (m) return m[1];
  } catch {
    /* no remote / offline */
  }
  return null;
}

// git's real diagnostic lands on the piped stderr; execFileSync's own e.message is
// just the "Command failed: <cmd>" wrapper, so prefer stderr and keep the message
// as the fallback (a timeout kill, for one, leaves stderr empty). Progress output
// separates fields with a bare CR — collapse those so the result stays one line.
/** @param {unknown} e @returns {string} */
function firstLine(e) {
  const err = /** @type {any} */ (e);
  const stderr = String(err?.stderr ?? err?.stdio?.[2] ?? "");
  const text = stderr.trim() ? stderr : String(err?.message ?? err);
  return (text.split("\n").find((l) => l.trim()) ?? "")
    .replace(/\r+/g, " ")
    .trim();
}

// Fail-open: only the literal string "false" disables — same convention as
// npm-ci-on-worktree.mjs's isNpmCiEnabled, applied here to an env var instead
// of argv. This hook is a long-lived MCP server process, not a per-event
// command-hook spawn, so the userConfig value arrives once at server start via
// .mcp.json's own `env` field (${user_config.*} substitution is documented to
// work in "MCP ... server configs", not just hook commands/args — verified
// NOT to work inside an mcp_tool hook's own `input` field in hooks.json, which
// only substitutes hook-event data like ${tool_input.file_path}).
/** @param {string | undefined} value @returns {boolean} */
export function isWorktreeRefreshEnabled(value) {
  return value !== "false";
}

const WORKTREE_REFRESH_ENABLED = isWorktreeRefreshEnabled(
  process.env.CODING_TOOLBOX_WORKTREE_REFRESH,
);

// Normalize a subagent_type: lowercase, collapse non-alphanumeric runs to
// `-`, trim -- ported verbatim from claude-code-knowledge's own reroute
// hook (mcp/server.mjs's reroute_guide), same normalization contract.
/** @param {any} value @returns {string} */
function normalize(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const REROUTE_EXPLORE_TARGET = "coding-toolbox:explore";

// Fail-open: only the literal string "false" disables -- same convention
// as isWorktreeRefreshEnabled just above, applied to its own env var.
/** @param {string | undefined} value @returns {boolean} */
export function isExploreRerouteEnabled(value) {
  return value !== "false";
}

const EXPLORE_REROUTE_ENABLED = isExploreRerouteEnabled(
  process.env.CODING_TOOLBOX_EXPLORE_REROUTE,
);

// PreToolUse(Agent|Task) reroute: when subagent_type normalizes to
// "explore", rewrite it to coding-toolbox:explore via permissionDecision
// allow + updatedInput. No-op otherwise (including when disabled).
/** @param {ToolHookInput} args @returns {HookResult} */
function rerouteExploreHandler(args) {
  if (!EXPLORE_REROUTE_ENABLED) return {};
  const toolInput = args?.tool_input ?? {};
  if (normalize(toolInput.subagent_type) !== "explore") return {};
  return {
    hookSpecificOutput: {
      hookEventName: args?.hook_event_name ?? "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason:
        "coding-toolbox: route Explore dispatches to this plugin's haiku-pinned, codebase-memory-mcp/rtk-prioritizing explore agent",
      updatedInput: { ...toolInput, subagent_type: REROUTE_EXPLORE_TARGET },
    },
  };
}

/** @param {PostToolUseHookInput} args @returns {HookResult} */
function worktreeRefreshHandler(args) {
  if (!WORKTREE_REFRESH_ENABLED) return {};

  const toolInput = args?.tool_input ?? {};
  if (toolInput.path) return {}; // switch-into-existing, not a creation

  // tool_response.worktreePath is EnterWorktree's own reported path (verified
  // live against a real EnterWorktree call — see the design doc) — prefer it
  // over cwd, which is present for every tool but not guaranteed to name the
  // worktree in every future call shape.
  const cwd =
    /** @type {any} */ (args?.tool_response)?.worktreePath ?? args?.cwd;
  if (!cwd) return {};

  if (!isLinkedWorktree(cwd)) return {}; // defensive: not (yet) inside a linked worktree

  const base = detectDefaultBranch(cwd);
  if (!base) return {}; // no remote / offline — nothing to refresh against

  try {
    git(cwd, ["fetch", "origin", base]);
  } catch (e) {
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `worktree-refresh: fetch of origin/${base} failed — this worktree may not have the latest upstream changes (${firstLine(e)})`,
      },
    };
  }

  try {
    git(cwd, ["rebase", `origin/${base}`]);
  } catch (e) {
    try {
      git(cwd, ["rebase", "--abort"]);
    } catch {
      /* best effort */
    }
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `worktree-refresh: rebase onto origin/${base} conflicted and was aborted — the worktree was left as created (not refreshed). Run 'git rebase origin/${base}' manually in this worktree if you need the latest upstream changes. (${firstLine(e)})`,
      },
    };
  }

  return {}; // success — silent, no need to report the common case
}

// Initialize the MCP stdio server: register tools, start the JSON-RPC readline loop.
function startServer() {
  const TOOLS = [
    {
      name: "interaction_gate",
      description:
        "Stop mechanical gate for the Interaction axis: blocks (decision:block+reason) when last_assistant_message ends in a bare '?' outside code fences, telling Claude to redo it via AskUserQuestion. {} otherwise.",
      inputSchema: { type: "object", additionalProperties: true },
      handler: interactionGateHandler,
    },
    {
      name: "worktree_refresh",
      description:
        "PostToolUse hook for EnterWorktree: after a NEW worktree is created (no tool_input.path), " +
        "fetches and rebases onto the repo's default branch on origin so the worktree starts from the " +
        "latest upstream. Silent no-op on switch-into-existing / non-worktree-cwd / no-remote; reports " +
        "via additionalContext (never blocks) on fetch failure or an aborted rebase conflict.",
      inputSchema: { type: "object", additionalProperties: true },
      handler: worktreeRefreshHandler,
    },
    {
      name: "reroute_explore",
      description:
        "PreToolUse(Agent|Task) reroute: when subagent_type normalizes to 'explore', rewrite it to " +
        "coding-toolbox:explore via permissionDecision allow + updatedInput. No-op otherwise " +
        "(including when disabled via CODING_TOOLBOX_EXPLORE_REROUTE=false).",
      inputSchema: { type: "object", additionalProperties: true },
      handler: rerouteExploreHandler,
    },
  ];
  const findTool = (/** @type {any} */ name) =>
    TOOLS.find((t) => t.name === name);
  const send = (/** @type {any} */ msg) =>
    process.stdout.write(JSON.stringify(msg) + "\n");
  const ok = (/** @type {any} */ id, /** @type {any} */ result) =>
    send({ jsonrpc: "2.0", id, result });
  const fail = (
    /** @type {any} */ id,
    /** @type {any} */ code,
    /** @type {any} */ message,
  ) => send({ jsonrpc: "2.0", id, error: { code, message } });

  const handle = (/** @type {any} */ msg) => {
    const { id, method, params } = msg;
    switch (method) {
      case "initialize":
        return ok(id, {
          protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
      case "notifications/initialized":
      case "notifications/cancelled":
        return;
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, {
          tools: TOOLS.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        });
      case "tools/call": {
        const tool = findTool(params?.name);
        if (!tool) return fail(id, -32602, `unknown tool: ${params?.name}`);
        if (process.env.MCP_HOOK_DEBUG) {
          process.stderr.write(
            `[${SERVER_NAME}] tools/call ${params?.name} args=${JSON.stringify(params?.arguments)}\n`,
          );
        }
        let result;
        try {
          result = tool.handler(params?.arguments ?? {});
        } catch (e) {
          const err = /** @type {any} */ (e);
          return fail(id, -32603, `tool error: ${err?.message ?? err}`);
        }
        return ok(id, {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        });
      }
      default:
        if (id === undefined) return;
        return fail(id, -32601, `method not found: ${method}`);
    }
  };

  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (/** @type {any} */ line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      process.stderr.write(`[${SERVER_NAME}] non-JSON line ignored\n`);
      return;
    }
    try {
      handle(msg);
    } catch (e) {
      const err = /** @type {any} */ (e);
      process.stderr.write(
        `[${SERVER_NAME}] handler crash: ${err?.stack ?? err}\n`,
      );
    }
  });
  rl.on("close", () => process.exit(0));
}
