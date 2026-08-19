#!/usr/bin/env node
// hooks/webfetch-steer.mjs — linux-token-efficiency plugin: PreToolUse WebFetch steer.
// Denies every WebFetch call with a copy-ready replacement on context-mode's
// ctx_fetch_and_index + ctx_search — the only fetch path here whose raw response never
// enters the context window (WebFetch has no comparable non-context-mode equivalent,
// so unlike Bash there is no classifier: every URL steers). Gated by the same
// steer_enabled toggle as the Bash steer branch; only the literal "false" disables.
//
// A command hook, knowingly: the deny reason must embed ${tool_input.url} dynamically,
// the cbm proxy server is the wrong category for a context-mode steer, and a third MCP
// server for one static-ish gate is more machinery than it justifies. Fail-open
// everywhere — any failure path is a bare `return` inside main()'s single try/catch,
// so WebFetch runs normally (degraded, never stranded) when anything is off.
import process from "node:process";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isSteerEnabled } from "./rtk-rewrite.mjs";

const STDIN_CAP = 1024 * 1024; // same cap as rtk-rewrite.mjs

const CTX_TOOL_PREFIX = "mcp__plugin_linux-token-efficiency_context-mode__";

/**
 * The PreToolUse deny result steering one WebFetch URL to ctx_fetch_and_index. The
 * reason is a complete replacement call plus an explicit "do not retry WebFetch" so
 * the model cannot loop on the denial.
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

// True only when this file is the process entry point, false when imported by a unit
// test -- so importing never reads stdin. Same pattern as rtk-rewrite.mjs.
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
    if (!isSteerEnabled(process.env.CLAUDE_PLUGIN_OPTION_STEER_ENABLED)) return;
    if (input.tool_name !== "WebFetch") return;
    const toolInput = input.tool_input;
    if (!toolInput || typeof toolInput !== "object") return;
    const url = toolInput.url;
    if (typeof url !== "string" || url === "") return;
    process.stdout.write(JSON.stringify(buildWebFetchDeny(url)) + "\n");
  } catch {
    // fail open — no output, exit 0
  }
}

if (isMainModule()) main();
