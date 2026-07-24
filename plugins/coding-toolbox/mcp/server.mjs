#!/usr/bin/env node
// Self-contained, zero-dependency MCP stdio server (Node built-ins only).
// Backs the coding-toolbox Stop-hook mechanical gate for the Interaction axis
// (interaction_gate). Invoked directly as the .mcp.json command.
// Transport: newline-delimited JSON-RPC 2.0. stdout = JSON-RPC only; logs → stderr.
import process from "node:process";
import readline from "node:readline";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

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

/** @param {string} cwd @param {string[]} args @returns {string} */
function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

// Same inode-safe comparison as fresh-branch's SKILL.md script (-ef, not string
// equality — from inside a worktree --git-dir is absolute, --git-common-dir can be
// relative, so a naive string compare false-negatives on the very case this exists
// to detect).
/** @param {string} cwd @returns {boolean} */
function isLinkedWorktree(cwd) {
  try {
    const gitDir = fs.realpathSync(git(cwd, ["rev-parse", "--git-dir"]));
    const commonDir = fs.realpathSync(
      git(cwd, ["rev-parse", "--git-common-dir"]),
    );
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

/** @param {unknown} e @returns {string} */
function firstLine(e) {
  const err = /** @type {any} */ (e);
  return String(err?.message ?? err).split("\n")[0];
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
