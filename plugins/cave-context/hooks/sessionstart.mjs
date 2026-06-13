#!/usr/bin/env node
// sessionstart.mjs — command hook: emit the always-full caveman ruleset as
// SessionStart additionalContext.
// COMMAND (not mcp_tool) because SessionStart is pre-connect: the MCP server is not
// up on first run, so an mcp_tool hook would fail open (silent no-op).
// No runtime state to seed — the level is a fixed constant (full).
import { sessionStartPrompt } from "../mcp/sessionprompt.mjs";

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: sessionStartPrompt() },
}));
