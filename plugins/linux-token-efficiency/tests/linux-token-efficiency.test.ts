import { expect, test, type TestBody } from "claude-code/testing";
import type { FsStat, ProcessRunResult } from "claude-code";
import { buildSteerDeny, buildWebFetchDeny, classifyBashCommand } from "../hooks/rtk-rewrite.mjs";

type On = Parameters<TestBody>[1];
type Run = { argv: readonly string[]; stdin?: string; cwd?: string };

const HOME = "/home/u";
const MANAGED = `${HOME}/.local/bin/rtk`;
const CWD = "/work/repo";
const GATHER = "grep -rn foo src && wc -l file && cat README.md";
const rtkSays = (command: string): string => JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecisionReason: "RTK auto-rewrite", updatedInput: { command } } });
const ran = (stdout: string, exitCode = 0): ProcessRunResult => ({ exitCode, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false });
const file = (realPath: string): FsStat => ({ kind: "file", size: 1, mtimeMs: 0, isLink: false, realPath });

type World = {
  linux?: boolean;
  path?: string;
  home?: string;
  // path → where it lands; a path not listed is missing. The managed binary and the plugin's bridge are added.
  files?: Record<string, string>;
  rtk?: (stdin: string) => ProcessRunResult; // `rtk hook claude`
  gitDirs?: string; // `git rev-parse --git-dir --git-common-dir` stdout; absent = not a repo
  managed?: false; // false: ~/.local/bin/rtk not installed
};

// The engine beneath the plugin: file system, environment, processes, cwd, and the tool itself (records what reached it).
function world(on: On, w: World = {}): { runs: Run[]; seen: Record<string, unknown>[] } {
  const runs: Run[] = [];
  const seen: Record<string, unknown>[] = [];
  const files: Record<string, string> = { ...(w.managed === false ? {} : { [MANAGED]: MANAGED }), ...w.files };
  on("fs.exists", (_$, e) => ({ value: e.path === "/proc/version" && w.linux !== false }));
  on("fs.stat", (_$, e) => {
    // This plugin's own bin/rtk: the one `/bin/rtk` candidate outside the system dirs and HOME.
    const bridge = e.path.endsWith("/bin/rtk") && !/^\/(usr|opt)\//.test(e.path) && !e.path.startsWith(HOME);
    const real = files[e.path] ?? (bridge ? e.path : undefined);
    return real === undefined ? { deny: `ENOENT: ${e.path}` } : { value: file(real) };
  });
  on("env.get", (_$, e) => ({ value: e.name === "HOME" ? (w.home ?? HOME) : e.name === "PATH" ? (w.path ?? `${HOME}/.local/bin:/usr/bin`) : undefined }));
  on("session.cwd", () => ({ value: CWD }));
  on("process.run", (_$, e) => {
    runs.push({ argv: e.argv, stdin: e.init?.stdin, cwd: e.init?.cwd });
    if (e.argv[0] === MANAGED) return { value: (w.rtk ?? (() => ran("")))(e.init?.stdin ?? "") };
    if (e.argv[0] === "git") return { value: w.gitDirs === undefined ? ran("", 128) : ran(w.gitDirs) };
    return { deny: `unexpected process ${e.argv.join(" ")}` };
  });
  on("tool.call", (_$, e) => {
    seen.push({ ...e });
    return { result: "ran" };
  });
  return { runs, seen };
}

test("steer: a read-only 3-segment gather is denied with the command hook's exact text; the tool never runs", async ($, on) => {
  const { seen, runs } = world(on);
  const r = await $.tool.call({ tool: "Bash", command: GATHER });
  expect(r.deny).toBe(buildSteerDeny(classifyBashCommand(GATHER))?.hookSpecificOutput?.permissionDecisionReason);
  expect(r.deny).toContain("ctx_batch_execute");
  expect(seen).toEqual([]);
  expect(runs).toEqual([]);
});

test("steer: a backgrounded gather is never steered (the ctx tools cannot background)", async ($, on) => {
  const { seen } = world(on);
  await $.tool.call({ tool: "Bash", command: GATHER, run_in_background: true });
  expect(seen.length).toBe(1);
});

test("rewrite: rtk's command reaches the tool; every other field survives; rtk got the PreToolUse JSON", async ($, on) => {
  const { seen, runs } = world(on, { rtk: () => ran(rtkSays("rtk git status")) });
  await $.tool.call({ tool: "Bash", command: "git status", description: "status", timeout: 600000 });
  expect(seen).toEqual([expect.objectContaining({ tool: "Bash", command: "rtk git status", description: "status", timeout: 600000 })]);
  const spawn = runs.find((r) => r.argv[0] === MANAGED);
  expect(spawn?.argv).toEqual([MANAGED, "hook", "claude"]);
  expect(spawn?.cwd).toBe(CWD);
  expect(JSON.parse(spawn?.stdin ?? "{}")).toEqual({ hook_event_name: "PreToolUse", tool_name: "Bash", cwd: CWD, tool_input: { command: "git status", description: "status", timeout: 600000 } });
});

test("rewrite: an rtk answer that is empty, unchanged, garbage, a decision or a failure leaves the command as it was", async ($, on) => {
  const answers = [ran(""), ran(rtkSays("ls -la")), ran("not json"), ran('{"hookSpecificOutput":{"permissionDecision":"deny"}}'), ran(rtkSays("rtk ls -la"), 1)];
  let i = 0;
  const { seen } = world(on, { rtk: () => answers[i++] });
  for (let n = 0; n < answers.length; n++) await $.tool.call({ tool: "Bash", command: "ls -la" });
  expect(seen.map((e) => e.command)).toEqual(["ls -la", "ls -la", "ls -la", "ls -la", "ls -la"]);
});

test("rewrite: a throwing rtk spawn fails open", async ($, on) => {
  const { seen } = world(on, {
    rtk: () => {
      throw new Error("timed out");
    },
  });
  await $.tool.call({ tool: "Bash", command: "ls -la" });
  expect(seen.map((e) => e.command)).toEqual(["ls -la"]);
});

test("rewrite: an already rtk-prefixed command (rewritten above) is passed on as it came", async ($, on) => {
  const { seen } = world(on); // rtk answers nothing for its own output
  await $.tool.call({ tool: "Bash", command: "rtk git status" });
  expect(seen.map((e) => e.command)).toEqual(["rtk git status"]);
});

test("preflight: a global rtk earlier on PATH owns the rewrite (never double-wire)", async ($, on) => {
  const rtk = (): ProcessRunResult => ran(rtkSays("rtk ls"));
  const { seen } = world(on, { rtk, path: "/opt/global/bin:/home/u/.local/bin", files: { "/opt/global/bin/rtk": "/opt/global/bin/rtk" } });
  await $.tool.call({ tool: "Bash", command: "ls" });
  expect(seen.map((e) => e.command)).toEqual(["ls"]);
});

test("preflight: managed rtk not installed yet means no rewrite and no spawn, even with a global rtk on PATH", async ($, on) => {
  const { seen, runs } = world(on, { managed: false, rtk: () => ran(rtkSays("rtk ls")), path: "/opt/global/bin", files: { "/opt/global/bin/rtk": "/opt/global/bin/rtk" } });
  await $.tool.call({ tool: "Bash", command: "ls" });
  expect(seen.map((e) => e.command)).toEqual(["ls"]);
  expect(runs).toEqual([]);
});

test("preflight: rtk not on PATH falls back to this plugin's own bin/rtk bridge, which counts as ours", async ($, on) => {
  const { seen } = world(on, { rtk: () => ran(rtkSays("rtk ls")), path: "/usr/bin" });
  await $.tool.call({ tool: "Bash", command: "ls" });
  expect(seen.map((e) => e.command)).toEqual(["rtk ls"]);
});

test("preflight: a managed rtk that is a link to elsewhere is accepted when PATH resolves to the same file", async ($, on) => {
  const { seen } = world(on, { rtk: () => ran(rtkSays("rtk ls")), files: { [MANAGED]: "/stow/rtk" } });
  await $.tool.call({ tool: "Bash", command: "ls" });
  expect(seen.map((e) => e.command)).toEqual(["rtk ls"]);
});

test("preflight: an unusable HOME means no rewrite", async ($, on) => {
  const { seen, runs } = world(on, { rtk: () => ran(rtkSays("rtk ls")), home: "${HOME}" });
  await $.tool.call({ tool: "Bash", command: "ls" });
  expect(seen.map((e) => e.command)).toEqual(["ls"]);
  expect(runs).toEqual([]);
});

test("linked worktree: a git rewrite is withheld; a non-git rewrite still applies", async ($, on) => {
  const answers = [ran(rtkSays("rtk git status")), ran(rtkSays("rtk ls"))];
  let i = 0;
  const { seen } = world(on, {
    rtk: () => answers[i++],
    gitDirs: "/work/main/.git/worktrees/repo\n/work/main/.git\n",
    files: { "/work/main/.git/worktrees/repo": "/work/main/.git/worktrees/repo", "/work/main/.git": "/work/main/.git" },
  });
  await $.tool.call({ tool: "Bash", command: "git status" });
  await $.tool.call({ tool: "Bash", command: "ls" });
  expect(seen.map((e) => e.command)).toEqual(["git status", "rtk ls"]);
});

test("main worktree and no repo at all: the git rewrite applies", async ($, on) => {
  const { seen } = world(on, { rtk: () => ran(rtkSays("rtk git status")), gitDirs: ".git\n.git\n", files: { [`${CWD}/.git`]: `${CWD}/.git` } });
  await $.tool.call({ tool: "Bash", command: "git status" });
  expect(seen.map((e) => e.command)).toEqual(["rtk git status"]);
});

test("auto_rewrite false: no rtk spawn, the steer still denies", { options: { auto_rewrite: false } }, async ($, on) => {
  const { seen, runs } = world(on, { rtk: () => ran(rtkSays("rtk ls")) });
  await $.tool.call({ tool: "Bash", command: "ls" });
  const r = await $.tool.call({ tool: "Bash", command: GATHER });
  expect(seen.map((e) => e.command)).toEqual(["ls"]);
  expect(runs).toEqual([]);
  expect(r.deny).toContain("ctx_batch_execute");
});

test("steer_enabled false: the gather is rewritten instead and WebFetch runs", { options: { steer_enabled: false } }, async ($, on) => {
  const { seen } = world(on, { rtk: () => ran(rtkSays("rtk grep")) });
  await $.tool.call({ tool: "Bash", command: GATHER });
  await $.tool.call({ tool: "WebFetch", url: "https://example.com", prompt: "title" });
  expect(seen.map((e) => e.command ?? e.tool)).toEqual(["rtk grep", "WebFetch"]);
});

test("WebFetch: denied with the command hook's exact text, the URL and its host as source", async ($, on) => {
  const { seen } = world(on);
  const r = await $.tool.call({ tool: "WebFetch", url: "https://docs.example.org/page?q=1", prompt: "summarize" });
  expect(r.deny).toBe(buildWebFetchDeny("https://docs.example.org/page?q=1").hookSpecificOutput?.permissionDecisionReason);
  expect(r.deny).toContain('"source": "docs.example.org"');
  expect(seen).toEqual([]);
});

test("not Linux: neither steer nor rewrite", async ($, on) => {
  const { seen, runs } = world(on, { linux: false, rtk: () => ran(rtkSays("rtk ls")) });
  await $.tool.call({ tool: "Bash", command: GATHER });
  await $.tool.call({ tool: "WebFetch", url: "https://example.com", prompt: "title" });
  expect(seen.length).toBe(2);
  expect(runs).toEqual([]);
});
