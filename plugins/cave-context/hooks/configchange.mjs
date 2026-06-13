#!/usr/bin/env node
// configchange.mjs — command hook: when configuration changes, re-seed the caveman
// level state file from the (possibly updated) configured default, so a `caveman_level`
// edit in settings.json takes effect live without waiting for the next session.
// ConfigChange is a standalone async lifecycle event, so it must be a command hook
// (an mcp_tool hook would fail open here). It reacts only — it never blocks the config
// change (exit 0, no decision/output). Re-seeding mirrors SessionStart: the configured
// level becomes the active level whenever config changes.
import { stateDir, writeLevel, configuredDefaultLevel } from "../mcp/caveman.mjs";

try {
  writeLevel(stateDir(), configuredDefaultLevel());
} catch {
  /* fail open — never block a configuration change */
}
