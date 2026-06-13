#!/usr/bin/env node
// sessionstart.mjs — command hook: emit the caveman ruleset as SessionStart additionalContext.
// SessionStart must be a command hook (not mcp_tool): the MCP server is not reliably
// connected this early in the lifecycle, so an mcp_tool hook would fail open (silent no-op).
import { sessionStartPrompt } from "../mcp/sessionprompt.mjs";
import { stateDir, writeLevel, configuredDefaultLevel } from "../mcp/caveman.mjs";

// Seed runtime state at the configured level so per-turn reminders fire from turn 1
// (matches the level the SessionStart ruleset announces). "stop caveman" later clears
// the state file → no reminder until the next session.
writeLevel(stateDir(), configuredDefaultLevel());

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: sessionStartPrompt() },
}));
