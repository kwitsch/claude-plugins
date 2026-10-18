import type { EngineInterface, Register } from "claude-code";
import { FULL_READ_MAX, GIT_TIMEOUT_MS, SAMPLE_BYTES, collectOffenders, decodeBase64, denyReason, isWorktreeRefreshEnabled, refreshWorktree } from "./policy.mjs";

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
};
