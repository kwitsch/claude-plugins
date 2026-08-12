#!/usr/bin/env node
// subagent-nudge.mjs -- SubagentStart command hook: static additionalContext, no input read and
// no server dependency. Deliberately NOT folded into the codebase-memory proxy's own
// SubagentStart tool (hook_subagent_context) -- this nudge is generic subagent-behavior guidance
// plus context-mode awareness, unrelated to the cbm graph, so it stays a separate, dependency-free
// second top-level SubagentStart entry (same pattern as the SessionStart `cat` addition).
import process from "node:process";

const ADDITIONAL_CONTEXT =
  "1. No narrative between tool calls: do not print running commentary or status updates while " +
  "working -- only your final report.\n" +
  "2. If the context-mode MCP server is connected (mcp__context-mode__* tools), prefer its ctx_* " +
  "tools -- e.g. ctx_execute/ctx_batch_execute for command output you intend to process, " +
  "ctx_search for previously indexed content -- over raw Bash/Read/Grep for large or processed " +
  "output.";

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SubagentStart",
      additionalContext: ADDITIONAL_CONTEXT,
    },
  }) + "\n",
);
