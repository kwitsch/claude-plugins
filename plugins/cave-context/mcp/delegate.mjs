// delegate.mjs — run the context-mode hook CLI for one event, return parsed output or null.
// The spawn sets CONTEXT_MODE_DIR (context-mode's persistent storage root) via the shared
// context-mode-env helper, so the delegate CLI shares the same context-mode data as the
// upstream MCP server (no split-brain between hook-captured data and the server's store).
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { contextModeEnv } from "./context-mode-env.mjs";

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
  // delegated by hooks/sessionresume.mjs (since v0.5.0) to run
  // context-mode's session-init side-effects and return the continuity payload; the
  // SessionStart hook strips context-mode's routing block (the caveman ruleset is emitted
  // separately by the static `cat hooks/SessionStart.md` hook). The four mid-loop events
  // (pretooluse/posttooluse/precompact/userpromptsubmit) are delegated as before.
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
    try { child = spawn(bin, [...args, event.toLowerCase()], { stdio: ["pipe", "pipe", "ignore"], env: contextModeEnv() }); }
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
