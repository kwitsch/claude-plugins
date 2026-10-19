import type { EngineInterface, Register } from "claude-code";
import {
  GIT_WORKTREE_CHECK_TIMEOUT_MS,
  INPUT_CAP,
  RTK_SPAWN_TIMEOUT_MS,
  buildSteerDeny,
  buildWebFetchDeny,
  classifyBashCommand,
  gitDirs,
  hasGitOperand,
  isAutoRewriteEnabled,
  isSteerEnabled,
  parseRtkRewrite,
  resolveManagedRtk,
  rtkCandidates,
} from "./rtk-rewrite.mjs";

// The two per-call PreToolUse command hooks (Bash router, WebFetch steer) as in-process tool.call hooks.
// Fail-open everywhere: every helper turns a failure into "no rewrite", and each hook calls next once, outside any try.
// Chain composition: another plugin's tool.call rewrite above this one hands its command in as e.command; this hook
// classifies and rewrites that command, and whatever sits beneath receives this hook's result. rtk answers nothing for
// a command it already rewrote (`rtk git status`), so an rtk prefix added above is left as it is.

let linux: Promise<boolean> | undefined; // the platform never changes within a process: probed once
const isLinux = ($: EngineInterface): Promise<boolean> => (linux ??= $.fs.exists("/proc/version").catch(() => false));

// Where a path lands (every link followed), or undefined when it leads nowhere.
const realPath = async ($: EngineInterface, path: string): Promise<string | undefined> => (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath;

// Whether cwd is inside a LINKED git worktree; false (rewrite applies) on any failure or outside a repo.
const isLinkedWorktree = async ($: EngineInterface, cwd: string): Promise<boolean> => {
  try {
    const r = await $.process.run(["git", "rev-parse", "--git-dir", "--git-common-dir"], { cwd, timeoutMs: GIT_WORKTREE_CHECK_TIMEOUT_MS });
    const dirs = gitDirs(r.exitCode, r.stdout, cwd);
    if (dirs === null) return false;
    const [gitDir, commonDir] = await Promise.all([realPath($, dirs[0]), realPath($, dirs[1])]);
    return gitDir !== undefined && commonDir !== undefined && gitDir !== commonDir;
  } catch {
    return false;
  }
};

// rtk's rewrite of `command`, or null. Preflight: ~/.local/bin/rtk is a regular file (links followed), the first `rtk`
// a bare word resolves to in the Bash tool is that binary or this plugin's own bin/rtk bridge (a global rtk install owns
// the rewrite otherwise: never double-wire), then `rtk hook claude` by absolute path with the PreToolUse JSON on stdin.
const rtkRewrite = async ($: EngineInterface, command: string, toolInput: Record<string, unknown>): Promise<string | null> => {
  try {
    const managed = resolveManagedRtk({ HOME: await $.env.get("HOME") });
    if (managed === null) return null;
    const own = await $.fs.stat(managed, { resolve: true }).catch(() => undefined);
    if (own?.kind !== "file" || own.realPath === undefined) return null; // not installed yet, dangling, or no regular file
    let hit: string | undefined;
    // shortcut: a candidate counts when it is a regular file; the fs API has no execute bit, so a non-executable `rtk`
    // ahead on PATH ends the walk where bash would skip it (a no-op, or a failed spawn: fail-open either way).
    for (const candidate of rtkCandidates(await $.env.get("PATH"), `${$.plugin.root}/bin`)) {
      const st = await $.fs.stat(candidate, { resolve: true }).catch(() => undefined);
      if (st?.kind === "file") {
        hit = st.realPath;
        break;
      }
    }
    if (hit === undefined) return null;
    if (hit !== own.realPath && hit !== (await realPath($, `${$.plugin.root}/bin/rtk`))) return null;
    const cwd = await $.session.cwd(); // read inside the hook: a subagent's own directory
    const stdin = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", cwd, tool_input: toolInput });
    const r = await $.process.run([managed, "hook", "claude"], { cwd, stdin, timeoutMs: RTK_SPAWN_TIMEOUT_MS });
    if (r.exitCode !== 0 || r.isStdoutTruncated) return null; // a signal reads as exit 1
    const rewritten = parseRtkRewrite(r.stdout, command);
    if (rewritten === null) return null;
    // In a linked worktree the harness's isolation guard refuses `rtk git …` (it cannot see through the wrapper):
    // withhold a rewrite that names git there so the original `git …` runs under the guard's own git-aware check.
    if (hasGitOperand(rewritten) && (await isLinkedWorktree($, cwd))) return null;
    return rewritten;
  } catch {
    return null;
  }
};

export const register: Register = (on, options) => {
  const steerOn = isSteerEnabled(options.steer_enabled);
  const rewriteOn = isAutoRewriteEnabled(options.auto_rewrite);

  if (steerOn || rewriteOn) {
    on("tool.call", { tool: "Bash" }, async ($, e, next) => {
      const { tool: _tool, tool_use_id: _id, consent: _consent, agentId: _agent, requestMeta: _meta, ...toolInput } = e;
      const command = e.command;
      if (typeof command !== "string" || command === "" || command.length > INPUT_CAP || !(await isLinux($))) return next(e);
      // Never steer a backgrounded call: the ctx_* tools cannot background, so a deny would strand the model.
      if (steerOn && String(e.run_in_background) !== "true") {
        const deny = buildSteerDeny(classifyBashCommand(command))?.hookSpecificOutput?.permissionDecisionReason;
        if (deny !== undefined) return { deny };
      }
      const rewritten = rewriteOn ? await rtkRewrite($, command, toolInput) : null;
      return next(rewritten === null ? e : { ...e, command: rewritten });
    });
  }

  if (steerOn) {
    on("tool.call", { tool: "WebFetch" }, async ($, e, next) => {
      const url = e.url;
      if (typeof url !== "string" || url === "" || !(await isLinux($))) return next(e);
      const deny = buildWebFetchDeny(url).hookSpecificOutput?.permissionDecisionReason;
      return deny === undefined ? next(e) : { deny };
    });
  }
};
