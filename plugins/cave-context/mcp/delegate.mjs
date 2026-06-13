// delegate.mjs — run the context-mode hook CLI for one event, return parsed output or null.
import { spawn } from "node:child_process";

// Event-name token passed to the CLI. Default = capitalised event (e.g. "PreToolUse").
function hookCmd() {
  if (process.env.CAVE_CONTEXT_NO_UPSTREAM === "1") return null;
  if (process.env.CAVE_CONTEXT_HOOK_CMD) {
    try { const a = JSON.parse(process.env.CAVE_CONTEXT_HOOK_CMD); if (Array.isArray(a) && a.length) return a; } catch { /* fall through */ }
  }
  // UNVERIFIED: both the context-mode hook CLI client token ("claude-code") and the
  // event-name casing passed below (capitalised, e.g. "PreToolUse") are assumptions —
  // NOT yet confirmed against the installed context-mode CLI. Confirm both during a
  // real-install smoke test. delegateHook() already fails open (returns null) if either
  // is wrong, so a bad guess degrades gracefully rather than breaking the hook.
  return ["npx", "-y", "context-mode", "hook", "claude-code"];
}

export function delegateHook(event, stdinObj, timeoutMs = 8000) {
  const base = hookCmd();
  if (!base) return Promise.resolve(null);
  const [bin, ...args] = base;
  return new Promise((resolve) => {
    let child;
    try { child = spawn(bin, [...args, event], { stdio: ["pipe", "pipe", "ignore"] }); }
    catch { return resolve(null); }
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
