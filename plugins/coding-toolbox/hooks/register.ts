import type { EngineInterface, Register } from "claude-code";
import {
  FULL_READ_MAX,
  GATE_REASON,
  GIT_TIMEOUT_MS,
  SAMPLE_BYTES,
  collectOffenders,
  decodeBase64,
  denyReason,
  isBareQuestion,
  isGateTurn,
  isWorktreeRefreshEnabled,
  refreshWorktree,
} from "./policy.mjs";

// The main-loop turn the gate's own re-prompt started: never gated again, so at most one re-prompt per user turn.
// Module state: a hot reload forgets it, which at worst lets one more re-prompt through.
let gateTurnId: string | undefined;

// The engine refuses $.<noun> as a bare value, so same-file helpers take the whole $.
// The first min(size, SAMPLE_BYTES) bytes of a file: whole-file read up to FULL_READ_MAX, `head -c` beyond.
const sample = async ($: EngineInterface, path: string, size: number): Promise<Uint8Array> => {
  if (size <= FULL_READ_MAX) {
    const read = await $.fs.read(path, { as: "bytes" });
    if (typeof read === "string") throw new Error("fs.read answered text");
    return decodeBase64(read.base64).subarray(0, SAMPLE_BYTES);
  }
  const r = await $.process.run(["sh", "-c", `head -c ${SAMPLE_BYTES} "$1" | base64`, "sh", path]);
  if (r.exitCode !== 0) throw new Error(r.stderr);
  return decodeBase64(r.stdout);
};

export const register: Register = (on, options) => {
  // Encoding guard. Fail open: a throwing hook is skipped and the tool runs, so no .catch.
  on("tool.call", { tool: ["Read", "Edit", "Write", "Bash"] }, async ($, e, next) => {
    const cwd = await $.session.cwd();
    const home = await $.env.get("HOME");
    const offenders = await collectOffenders(e, cwd, home, {
      stat: (path) => $.fs.stat(path),
      sample: (path, size) => sample($, path, size),
    });
    return offenders.length > 0 ? { deny: denyReason(offenders) } : next(e);
  });

  // Worktree refresh, after EnterWorktree created a new worktree (a `path` call switches into an existing one).
  if (isWorktreeRefreshEnabled(options.worktree_refresh)) {
    on("tool.call", { tool: "EnterWorktree" }, async ($, e, next) => {
      const r = await next(e);
      if (r.deny !== undefined || r.isError || ("path" in e && e.path)) return r;
      const reported = (r.result as { worktreePath?: unknown } | undefined)?.worktreePath;
      const cwd = typeof reported === "string" && reported !== "" ? reported : await $.session.cwd();
      const note = await refreshWorktree(cwd, {
        git: (dir, args) => $.process.run(["git", ...args], { cwd: dir, timeoutMs: GIT_TIMEOUT_MS }),
        realPath: async (path) => {
          const st = await $.fs.stat(path, { resolve: true });
          if (st.realPath === undefined) throw new Error(`cannot resolve ${path}`);
          return st.realPath;
        },
      });
      return note === undefined ? r : { ...r, context: [...(r.context ?? []), note] };
    });
  }

  // Interaction gate: Stop has no native block for a user-tier mod, so a main-loop answer ending in a bare
  // question gets one framed plugin prompt that starts a new turn telling Claude to redo it via AskUserQuestion.
  on("turn.start", ($, e, next) => {
    if (e.agentId === undefined) gateTurnId = isGateTurn(e.text) ? e.turnId : undefined;
    return next(e);
  });
  on("turn.complete", ($, e, next) => {
    if (e.agentId === undefined && e.reason === "answer" && e.turnId !== gateTurnId && isBareQuestion(e.answer)) {
      // Not awaited: it resolves only once the new turn starts, which waits for this turn to end.
      $.prompt.submit({ text: GATE_REASON }).catch(() => undefined);
    }
    return next(e);
  });
};
