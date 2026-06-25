// delegate.mjs — route a Claude Code hook event to the in-process vendored work
// (mid-session) or, for SessionStart, to the spawned vendored hook script (Task 6).
// Returns the same shape as before (null or the JSON the context-mode hook would have
// printed); fail-open to null on any error.
//
// Routing:
//   posttooluse / userpromptsubmit → in-process (inproc-hooks.mjs, this task)
//   pretooluse / precompact        → in-process stubs (→ null until Task 4)
//   sessionstart                   → CLI spawn (honors CAVE_CONTEXT_HOOK_CMD for tests;
//                                    Task 6 will replace with sessionstart-spawn.mjs)
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { contextModeEnv } from "./context-mode-env.mjs";

// Return the CLI command array for SessionStart spawns, or null when disabled.
// Honors CAVE_CONTEXT_HOOK_CMD (test override) or the production bnx.sh launcher.
function sessionStartCmd() {
  if (process.env.CAVE_CONTEXT_NO_UPSTREAM === "1") return null;
  if (process.env.CAVE_CONTEXT_HOOK_CMD) {
    try {
      const a = JSON.parse(process.env.CAVE_CONTEXT_HOOK_CMD);
      if (Array.isArray(a) && a.length) return a;
    } catch { /* fall through */ }
  }
  // Production: launch via bin/bnx.sh. Task 6 replaces this with sessionstart-spawn.mjs.
  const bnx = fileURLToPath(new URL("../bin/bnx.sh", import.meta.url));
  return [bnx, "context-mode", "hook", "claude-code"];
}

// Spawn a CLI process for one event (used only for SessionStart until Task 6).
function spawnHook(event, stdinObj, timeoutMs) {
  const base = sessionStartCmd();
  if (!base) return Promise.resolve(null);
  const [bin, ...args] = base;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, [...args, event.toLowerCase()], {
        stdio: ["pipe", "pipe", "ignore"],
        env: contextModeEnv(),
      });
    } catch { return resolve(null); }
    let out = ""; let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } finish(null); }, timeoutMs);
    child.on("error", () => { clearTimeout(timer); finish(null); });
    child.stdout.on("data", (d) => { out += d; });
    child.on("close", () => {
      clearTimeout(timer);
      try { finish(out.trim() ? JSON.parse(out) : null); } catch { finish(null); }
    });
    try { child.stdin.write(JSON.stringify(stdinObj)); child.stdin.end(); } catch { /* ignore */ }
  });
}

export async function delegateHook(event, input, timeoutMs = 8000) {
  if (process.env.CAVE_CONTEXT_NO_UPSTREAM === "1") return null;
  const ev = String(event).toLowerCase();
  try {
    if (ev === "sessionstart") return await spawnHook(ev, input, timeoutMs); // Task 6: replace with in-process
    const m = await import("./inproc-hooks.mjs");
    if (ev === "posttooluse") return await m.postToolUse(input);
    if (ev === "userpromptsubmit") return await m.userPromptSubmit(input);
    if (ev === "pretooluse") return await m.preToolUse(input);   // Task 4
    if (ev === "precompact") return await m.preCompact(input);   // Task 4
    return null;
  } catch (e) {
    if (process.env.MCP_HOOK_DEBUG) {
      process.stderr.write(`[cave-context] delegateHook ${ev} failed: ${e?.message ?? e}\n`);
    }
    return null; // fail-open
  }
}
