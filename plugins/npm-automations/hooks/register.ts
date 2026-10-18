import type { EngineInterface, Register } from "claude-code";
import { DEFAULT_MANAGER, INSTALL_TIMEOUT_MS, detectPackageManager, dirname, installArgsFor, isEnabled, isPackageJson, outcomeMessage, pathWithLocalBin, planInstall } from "./policy.mjs";

type Install = { hook: string; cwd: string; bin: string; args: string[]; command: string };

// One install chain per directory: installs into one node_modules run one after another,
// never racing on it or on the lockfile. Module memory, so it spans this session only.
const chains = new Map<string, Promise<void>>();

// The directory's entry names, or none when it cannot be listed.
async function entryNames($: EngineInterface, dir: string): Promise<string[]> {
  return (await $.fs.list(dir).catch(() => [])).map((entry) => entry.name);
}

// Runs one install to its end and leaves a failure line for the model's next request.
async function runInstall($: EngineInterface, job: Install): Promise<void> {
  const path = pathWithLocalBin(await $.env.get("PATH"), await $.env.get("HOME"));
  const outcome = await $.process
    .run([job.bin, ...job.args], { cwd: job.cwd, timeoutMs: INSTALL_TIMEOUT_MS, ...(path ? { env: { PATH: path } } : {}) })
    .catch((err: unknown) => ({ error: String(err) }));
  const text = outcomeMessage(job.hook, job.bin, job.command, job.cwd, outcome);
  if (text !== null) await $.session.append({ message: { type: "user", content: [{ type: "text", text }] } });
}

// Fire and forget: queued behind the directory's running install; the hook never waits.
function enqueue($: EngineInterface, job: Install): void {
  const run = (chains.get(job.cwd) ?? Promise.resolve()).then(() => runInstall($, job)).catch(() => {});
  chains.set(job.cwd, run);
  void run.then(() => {
    if (chains.get(job.cwd) === run) chains.delete(job.cwd);
  });
}

// A Write or Edit just landed on filePath: install what its package.json change asks for.
async function onPackageWrite($: EngineInterface, tool: string, input: Record<string, unknown>, filePath: string): Promise<void> {
  if (!isPackageJson(filePath)) return;
  const plan = planInstall(tool, input, await $.fs.read(filePath));
  if (plan === null) return;
  const cwd = dirname(filePath);
  const manager = detectPackageManager(await entryNames($, cwd)) ?? DEFAULT_MANAGER;
  const args = installArgsFor(manager.name, plan.specs);
  enqueue($, { hook: "npm-install-on-package-change", cwd, bin: manager.name, args, command: `${manager.name} ${args[0]}` });
}

export const register: Register = (on, options) => {
  if (isEnabled(options.npm_ci_on_worktree)) {
    on("tool.call", { tool: "EnterWorktree" }, async ($, e, next) => {
      const r = await next(e);
      if (r.deny !== undefined || r.isError) return r;
      try {
        const cwd = r.result.worktreePath;
        const manager = detectPackageManager(await entryNames($, cwd));
        if (manager) {
          enqueue($, { hook: "npm-ci-on-worktree", cwd, bin: manager.name, args: manager.ciArgs, command: `${manager.name} ${manager.ciArgs.join(" ")}` });
        }
      } catch {
        // fail open: the tool's result goes back unchanged
      }
      return r;
    });
  }

  if (isEnabled(options.npm_install_on_package_change)) {
    on("tool.call", { tool: "Write" }, async ($, e, next) => {
      const r = await next(e);
      if (r.deny === undefined && !r.isError) await onPackageWrite($, e.tool, e, e.file_path).catch(() => {});
      return r;
    });
    on("tool.call", { tool: "Edit" }, async ($, e, next) => {
      const r = await next(e);
      if (r.deny === undefined && !r.isError) await onPackageWrite($, e.tool, e, e.file_path).catch(() => {});
      return r;
    });
  }
};
