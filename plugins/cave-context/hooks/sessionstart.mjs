#!/usr/bin/env node
// sessionstart.mjs — command hook: emit the caveman ruleset as SessionStart additionalContext.
// SessionStart must be a command hook (not mcp_tool): the MCP server is not reliably
// connected this early in the lifecycle, so an mcp_tool hook would fail open (silent no-op).
import { sessionStartPrompt } from "../mcp/sessionprompt.mjs";
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: sessionStartPrompt() },
}));
