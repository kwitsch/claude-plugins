// delegate.mjs — run the context-mode hook CLI for one event, return parsed output or null.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// CLI invocation prefix: `context-mode hook <platform>`. The event name is appended
// (lowercased) by delegateHook below.
function hookCmd() {
  if (process.env.CAVE_CONTEXT_NO_UPSTREAM === "1") return null;
  if (process.env.CAVE_CONTEXT_HOOK_CMD) {
    try { const a = JSON.parse(process.env.CAVE_CONTEXT_HOOK_CMD); if (Array.isArray(a) && a.length) return a; } catch { /* fall through */ }
  }
  // Platform token `claude-code` and lowercase event keys (pretooluse/posttooluse/
  // precompact/userpromptsubmit) verified against context-mode 1.0.162 cli.bundle.mjs
  // `mq` routing map; cave-context delegates exactly those four. `sessionstart` is
  // ALSO a valid context-mode key but is intentionally NOT delegated — SessionStart
  // is handled wholly by cave-context's own ruleset (context-mode's routing guidance
  // is reimplemented inline in sessionprompt.mjs), so there is no SessionStart caller.
  // The CLI process.exit(1)s silently on an unknown platform/event key (no stdout/
  // stderr), and delegateHook() fails open (returns null) on any error — so the event
  // MUST be lowercased before it reaches the CLI.
  // Launch via bin/bnx.sh (bun x / npx -y by bun presence); package name "context-mode".
  const bnx = fileURLToPath(new URL("../bin/bnx.sh", import.meta.url));
  return [bnx, "context-mode", "hook", "claude-code"];
}

export function delegateHook(event, stdinObj, timeoutMs = 8000) {
  const base = hookCmd();
  if (!base) return Promise.resolve(null);
  const [bin, ...args] = base;
  return new Promise((resolve) => {
    let child;
    // The context-mode CLI keys events lowercase; capitalised event names exit(1) silently.
    try { child = spawn(bin, [...args, event.toLowerCase()], { stdio: ["pipe", "pipe", "ignore"] }); }
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
