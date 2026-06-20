// context-mode-env.mjs — build the spawn env for the upstream context-mode process
// and the hook-delegate CLI, pointing context-mode's storage root at the PERSISTENT
// plugin data dir so its data survives plugin updates (no versioned-cache churn).
import { join } from "node:path";

// Returns a shallow copy of `base` with CONTEXT_MODE_DIR set to
// <CLAUDE_PLUGIN_DATA>/context-mode when CLAUDE_PLUGIN_DATA is a non-empty string and
// CONTEXT_MODE_DIR is not already set (an explicit value wins — enables test isolation).
// context-mode requires CONTEXT_MODE_DIR to be ABSOLUTE and treats empty as unset, so a
// missing/blank CLAUDE_PLUGIN_DATA leaves the var unset (context-mode falls back to its
// own default) rather than producing a broken "undefined/context-mode" / relative path.
export function contextModeEnv(base = process.env) {
  const env = { ...base };
  const data = (base.CLAUDE_PLUGIN_DATA ?? "").trim();
  if (!env.CONTEXT_MODE_DIR && data) env.CONTEXT_MODE_DIR = join(data, "context-mode");
  return env;
}
