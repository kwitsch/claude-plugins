import { expect, mock, test, type TestBody } from "claude-code/testing";

type On = Parameters<TestBody>[1];
type Run = { argv: readonly string[]; cwd?: string; env?: Record<string, string>; timeoutMs?: number };
type Answer = { exitCode: number; stdout: string; stderr: string } | Error;

const PROJ = "/work/proj";
const PKG = `${PROJ}/package.json`;
const OFF = { npm_ci_on_worktree: false, npm_install_on_package_change: false };

// Stands for the host beneath the plugin: a directory listing per path, file contents per
// path, the environment, and process.run recording each call and answering `answer`.
function host(on: On, files: Record<string, string>, dirs: Record<string, string[]>, answer: Answer = { exitCode: 0, stdout: "", stderr: "" }): Run[] {
  const runs: Run[] = [];
  mock.env(on, { PATH: "/usr/bin", HOME: "/home/u" });
  on("fs.list", async (_$, e) => ({
    value: (dirs[e.path ?? ""] ?? []).map((name) => ({ name, kind: "file" as const, size: 0, mtimeMs: 0, isLink: false })),
  }));
  on("fs.read", async (_$, e) => ({ value: files[e.path] ?? "" }));
  on("process.run", async (_$, e) => {
    runs.push({ argv: e.argv, ...e.init });
    if (answer instanceof Error) return { deny: answer.message };
    return { value: { ...answer, isStdoutTruncated: false, isStderrTruncated: false } };
  });
  return runs;
}

// The fire-and-forget install settles a few host hops after the tool call resolved.
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

test("a package.json Write runs a bare npm install in its directory, with ~/.local/bin on PATH", async ($, on) => {
  const runs = host(on, { [PKG]: '{"name":"x"}' }, { [PROJ]: ["package.json"] });
  on("tool.call", () => ({ result: { type: "create", filePath: PKG, content: "{}", structuredPatch: [], originalFile: null } }));
  const r = await $.tool.call({ tool: "Write", file_path: PKG, content: '{"name":"x"}' });
  await settle();
  expect(r.deny).toBe(undefined);
  expect(runs).toEqual([{ argv: ["npm", "install"], cwd: PROJ, env: { PATH: "/usr/bin:/home/u/.local/bin" }, timeoutMs: 300000 }]);
});

test("an Edit adding a dependency under pnpm-lock.yaml runs `pnpm add <spec>`", async ($, on) => {
  const after = '{"dependencies":{"left-pad":"^2.0.0"}}';
  const runs = host(on, { [PKG]: after }, { [PROJ]: ["package.json", "pnpm-lock.yaml"] });
  on("tool.call", () => ({ result: { filePath: PKG } }));
  await $.tool.call({ tool: "Edit", file_path: PKG, old_string: '"left-pad":"^1.0.0"', new_string: '"left-pad":"^2.0.0"' });
  await settle();
  expect(runs.map((x) => x.argv)).toEqual([["pnpm", "add", "left-pad@^2.0.0"]]);
});

test("a version-only Edit runs nothing", async ($, on) => {
  const runs = host(on, { [PKG]: '{"version":"1.0.1"}' }, { [PROJ]: ["package.json"] });
  on("tool.call", () => ({ result: { filePath: PKG } }));
  await $.tool.call({ tool: "Edit", file_path: PKG, old_string: '"version":"1.0.0"', new_string: '"version":"1.0.1"' });
  await settle();
  expect(runs).toEqual([]);
});

test("a Write to a non-package file runs nothing", async ($, on) => {
  const runs = host(on, { "/work/proj/index.js": "x" }, { [PROJ]: ["package.json"] });
  on("tool.call", () => ({ result: { filePath: "/work/proj/index.js" } }));
  await $.tool.call({ tool: "Write", file_path: "/work/proj/index.js", content: "x" });
  await settle();
  expect(runs).toEqual([]);
});

test("a failed install leaves its failure line for the model", async ($, on) => {
  host(on, { [PKG]: "{}" }, { [PROJ]: [] }, { exitCode: 1, stdout: "", stderr: "E404 nope" });
  const session = mock.session(on);
  on("tool.call", () => ({ result: { filePath: PKG } }));
  await $.tool.call({ tool: "Write", file_path: PKG, content: "{}" });
  await settle();
  const texts = session.appended().flatMap((row) => (Array.isArray(row.message.content) ? row.message.content : []));
  expect(texts).toEqual([{ type: "text", text: `npm-install-on-package-change: \`npm install\` failed in ${PROJ} (exit code 1):\nE404 nope` }]);
});

test("a manager missing from PATH is reported as not found", async ($, on) => {
  host(on, { [PKG]: "{}" }, { [PROJ]: ["yarn.lock"] }, new Error("npm-automations: $.process.run(yarn) failed to start: ENOENT: Executable not found in $PATH: yarn"));
  const session = mock.session(on);
  on("tool.call", () => ({ result: { filePath: PKG } }));
  await $.tool.call({ tool: "Write", file_path: PKG, content: "{}" });
  await settle();
  const texts = session.appended().flatMap((row) => (Array.isArray(row.message.content) ? row.message.content : []));
  expect(texts).toEqual([{ type: "text", text: `npm-install-on-package-change: yarn not found on PATH, skipped in ${PROJ}` }]);
});

test("EnterWorktree into a project with package-lock.json runs npm ci in the worktree", async ($, on) => {
  const runs = host(on, {}, { "/work/wt": ["package-lock.json"] });
  on("tool.call", () => ({ result: { worktreePath: "/work/wt", message: "ok" } }));
  await $.tool.call({ tool: "EnterWorktree", name: "wt" });
  await settle();
  expect(runs.map((x) => [x.argv, x.cwd])).toEqual([[["npm", "ci"], "/work/wt"]]);
});

test("EnterWorktree into a project without a lockfile runs nothing", async ($, on) => {
  const runs = host(on, {}, { "/work/wt": ["package.json"] });
  on("tool.call", () => ({ result: { worktreePath: "/work/wt", message: "ok" } }));
  await $.tool.call({ tool: "EnterWorktree", name: "wt" });
  await settle();
  expect(runs).toEqual([]);
});

test("both toggles off: a package.json Write and an EnterWorktree run nothing", { options: OFF }, async ($, on) => {
  const runs = host(on, { [PKG]: "{}" }, { [PROJ]: ["package-lock.json"], "/work/wt": ["package-lock.json"] });
  on("tool.call", (_$, e) => (e.tool === "EnterWorktree" ? { result: { worktreePath: "/work/wt", message: "ok" } } : { result: { filePath: PKG } }));
  await $.tool.call({ tool: "Write", file_path: PKG, content: "{}" });
  await $.tool.call({ tool: "EnterWorktree", name: "wt" });
  await settle();
  expect(runs).toEqual([]);
});

test("two installs in one directory run one after another, never overlapping", async ($, on) => {
  mock.env(on, { PATH: "/usr/bin", HOME: "/home/u" });
  on("fs.list", async () => ({ value: [] }));
  on("fs.read", async () => ({ value: "{}" }));
  const log: string[] = [];
  let release: () => void = () => {};
  on("process.run", async () => {
    log.push(`start ${log.length}`);
    if (log.length === 1) await new Promise<void>((resolve) => (release = resolve));
    log.push("end");
    return { value: { exitCode: 0, stdout: "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false } };
  });
  on("tool.call", () => ({ result: { filePath: PKG } }));
  await $.tool.call({ tool: "Write", file_path: PKG, content: "{}" });
  await $.tool.call({ tool: "Write", file_path: PKG, content: "{}" });
  await settle();
  expect(log).toEqual(["start 0"]);
  release();
  await settle();
  expect(log).toEqual(["start 0", "end", "start 2", "end"]);
});
