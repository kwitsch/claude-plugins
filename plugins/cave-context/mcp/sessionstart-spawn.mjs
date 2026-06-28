// sessionstart-spawn.mjs — run the VENDORED context-mode SessionStart hook script
// (D1). SessionStart is rare (once per session) and the heaviest hook (433-line
// orchestration: CLAUDE.md capture, old-session GC, the session_start lifecycle anchor,
// continuity restore). Rather than re-implement it in-process, we spawn the vendored
// `bin/context-mode/hooks/sessionstart.mjs` directly with `node` — behaviorally
// equivalent to the old `context-mode hook claude-code sessionstart` CLI (which just
// resolved to that same script), but with zero external fetch (it runs the in-bin copy).
//
// Returns the JSON the script writes to stdout (or null on disable/timeout/error).
// Fail-open: a slow/absent/erroring script yields null → the SessionStart command hooks
// emit {} (no continuity), never a present additionalContext: null.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { contextModeEnv } from "./context-mode-env.mjs";

// Resolve the SessionStart script: a test override (CAVE_CONTEXT_SESSIONSTART_SCRIPT)
// or the vendored hooks/sessionstart.mjs.
/** @returns {string} */
function scriptPath() {
  if (process.env.CAVE_CONTEXT_SESSIONSTART_SCRIPT) return process.env.CAVE_CONTEXT_SESSIONSTART_SCRIPT;
  return fileURLToPath(new URL("../bin/context-mode/hooks/sessionstart.mjs", import.meta.url));
}

// Spawn `node <sessionstart.mjs>`, write `input` as JSON to its stdin, resolve with the
// parsed stdout response or null on any error/timeout. Honors CAVE_CONTEXT_NO_UPSTREAM.
/**
 * @param {HookCommonInput} input
 * @param {number} [timeoutMs]
 * @returns {Promise<HookResult|null>}
 */
export function runSessionStart(input, timeoutMs = 5000) {
  if (process.env.CAVE_CONTEXT_NO_UPSTREAM === "1") return Promise.resolve(null);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, [scriptPath()], {
        stdio: ["pipe", "pipe", "ignore"],
        env: contextModeEnv(),
      });
    } catch { return resolve(null); }
    let out = ""; let done = false;
    /** @param {HookResult|null} v */
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } finish(null); }, timeoutMs);
    child.on("error", () => { clearTimeout(timer); finish(null); });
    child.stdout.on("data", /** @param {Buffer} d */ (d) => { out += d; });
    child.on("close", () => {
      clearTimeout(timer);
      try { finish(out.trim() ? JSON.parse(out) : null); } catch { finish(null); }
    });
    try { child.stdin.write(JSON.stringify(input)); child.stdin.end(); } catch { /* ignore */ }
  });
}
