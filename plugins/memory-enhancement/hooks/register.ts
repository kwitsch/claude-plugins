import type { EngineInterface, Register } from "claude-code";
import { NUDGE, dueKey, isAutoDreamEnabled } from "./dream.mjs";

// The session-start root (CLAUDE_PROJECT_DIR's semantics): $.session.root() follows /cd and worktree moves,
// which would flag a throwaway worktree instead of the project. A reload re-captures it from root().
let startRoot: string | undefined;

// This project's dream-due key in the plugin's own $.store.
async function projectKey($: EngineInterface): Promise<string> {
  const root = startRoot ?? (await $.session.root());
  // realpath, so symlink variants of one project dir share a key; the dir as given when it does not resolve
  const real = (await $.fs.stat(root, { resolve: true }).catch(() => undefined))?.realPath ?? root;
  return dueKey(real);
}

export const register: Register = (on, options) => {
  // Stop equivalent: every main-loop turn that ended normally flags the next session as dream-due.
  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (e.agentId !== undefined || e.reason === "aborted" || e.reason === "error") return result;
    try {
      const key = await projectKey($);
      if ((await $.store.get(key)) === undefined) await $.store.set(key, true);
    } catch {
      // fail open: a flag hiccup never touches the turn
    }
    return result;
  });

  // SessionStart(startup) equivalent: session.start also fires on --resume/--continue and on a mid-session
  // plugin reload; a transcript that already holds user turns is not a fresh startup, so it keeps the flag.
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    try {
      startRoot = await $.session.root();
      if (!isAutoDreamEnabled(options.auto_dream)) return result;
      if ((await $.session.turns()) > 0) return result;
      const key = await projectKey($);
      if ((await $.store.get(key)) === undefined) return result;
      await $.store.delete(key); // consumed once; a failed delete throws before the nudge
      await $.session.append({ message: { type: "user", content: [{ type: "text", text: NUDGE }] } });
    } catch {
      // fail open: never block session start
    }
    return result;
  });
};
