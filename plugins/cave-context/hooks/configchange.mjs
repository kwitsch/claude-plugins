#!/usr/bin/env node
// configchange.mjs — command hook: when configuration changes, re-seed the caveman
// level state file from the (possibly updated) configured default, so a `caveman_level`
// edit in settings.json takes effect live without waiting for the next session.
// COMMAND (not mcp_tool) because this is a fail-open-sensitive state-write that the
// other command hooks (sessionstart/userpromptsubmit) read back via readLevel(): a
// command hook runs independently of the MCP server's liveness, whereas an mcp_tool
// hook would silently no-op if the server were momentarily down and the edit would
// not apply live. ConfigChange itself is `full`/mcp_tool-capable in the matrix —
// connectivity is not the reason. It reacts only — it never blocks the config change
// (exit 0, no decision/output). Re-seeding mirrors SessionStart: the configured level
// becomes the active level whenever config changes.
import { stateDir, writeLevel, configuredDefaultLevel } from "../mcp/caveman.mjs";

try {
  writeLevel(stateDir(), configuredDefaultLevel());
} catch {
  /* fail open — never block a configuration change */
}
