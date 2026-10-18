import { expect, mock, test, type TestBody } from "claude-code/testing";
import { GATE_REASON } from "../hooks/policy.mjs";

type On = Parameters<TestBody>[1];
type Run = { exitCode: number; stdout: string; stderr: string };

// "Täglich grüßt der Bär" in Windows-1252, and the same text in UTF-8, as base64.
const LEGACY = btoa("T\xe4glich gr\xfc\xdft der B\xe4r\n");
const UTF8 = btoa("T\xc3\xa4glich gr\xc3\xbc\xc3\x9ft\n");

// Stands for the engine's file system: `files` maps an absolute path to its base64 content.
function stubFiles(on: On, files: Record<string, string>): void {
  on("session.cwd", async () => ({ value: "/w" }));
  mock.env(on, { HOME: "/home/u" });
  on("fs.stat", async (_$, e) => {
    // A resolving stat (the worktree refresh's git dirs) lands where it points: no links here.
    if (e.resolve) return { value: { kind: "dir" as const, size: 0, mtimeMs: 0, isLink: false, realPath: e.path } };
    const b64 = files[e.path];
    if (b64 === undefined) return { deny: `ENOENT ${e.path}` };
    return { value: { kind: "file" as const, size: atob(b64).length, mtimeMs: 0, isLink: false } };
  });
  on("fs.read", async (_$, e) => {
    const b64 = files[e.path];
    return b64 === undefined ? { deny: `ENOENT ${e.path}` } : { value: { base64: b64 } };
  });
}

// The tool itself, beneath the plugin: records that it ran.
function stubTool(on: On, result: unknown = "ran"): { ran: number } {
  const st = { ran: 0 };
  on("tool.call", async () => {
    st.ran += 1;
    return { result };
  });
  return st;
}

test("Read of a Windows-1252 file is denied with the iconv hint; the tool never runs", async ($, on) => {
  stubFiles(on, { "/w/legacy.txt": LEGACY });
  const tool = stubTool(on);
  const r = await $.tool.call({ tool: "Read", file_path: "/w/legacy.txt" });
  expect(r.deny).toContain("encoding-guard: /w/legacy.txt (ISO-8859-1/Windows-1252 (legacy single-byte)) is not UTF-8.");
  expect(r.deny).toContain("iconv -f WINDOWS-1252 -t UTF-8 '/w/legacy.txt'");
  expect(tool.ran).toBe(0);
});

test("Read of a UTF-8 file and of a missing file pass to the tool", async ($, on) => {
  stubFiles(on, { "/w/utf8.txt": UTF8 });
  const tool = stubTool(on);
  expect((await $.tool.call({ tool: "Read", file_path: "/w/utf8.txt" })).result).toBe("ran");
  expect((await $.tool.call({ tool: "Write", file_path: "/w/new.txt", content: "x" })).result).toBe("ran");
  expect(tool.ran).toBe(2);
});

test("Bash resolves a relative content-tool argument against the session cwd", async ($, on) => {
  stubFiles(on, { "/w/legacy.txt": LEGACY });
  const tool = stubTool(on);
  expect((await $.tool.call({ tool: "Bash", command: "cat legacy.txt | grep x" })).deny).toContain("/w/legacy.txt");
  expect((await $.tool.call({ tool: "Bash", command: "iconv -f WINDOWS-1252 -t UTF-8 legacy.txt" })).result).toBe("ran");
  expect(tool.ran).toBe(1);
});

// Stands for git: answers by the argv after `git`, recording every call.
function stubGit(on: On, answer: (args: readonly string[]) => Run): string[][] {
  const calls: string[][] = [];
  on("process.run", async (_$, e) => {
    const args = e.argv.slice(1);
    calls.push([...args]);
    return { value: { ...answer(args), isStdoutTruncated: false, isStderrTruncated: false } };
  });
  return calls;
}

const OK = (stdout = ""): Run => ({ exitCode: 0, stdout, stderr: "" });
// A linked worktree at /r/wt of the repo /r whose origin's default branch is main.
const worktreeGit =
  (rebase: Run) =>
  (args: readonly string[]): Run => {
    const a = args.join(" ");
    if (a === "rev-parse --git-dir") return OK("/r/.git/worktrees/wt\n");
    if (a === "rev-parse --git-common-dir") return OK("/r/.git\n");
    if (a === "symbolic-ref --short refs/remotes/origin/HEAD") return OK("origin/main\n");
    if (a === "rebase origin/main") return rebase;
    return OK();
  };

test("EnterWorktree: a rebase conflict is aborted and reported as context after the tool's result", async ($, on) => {
  stubFiles(on, {});
  stubTool(on, { worktreePath: "/r/wt", message: "Created worktree" });
  const calls = stubGit(on, worktreeGit({ exitCode: 1, stdout: "", stderr: "error: could not apply 1234abc... edit\n" }));
  const r = await $.tool.call({ tool: "EnterWorktree", name: "wt" });
  expect(r.result).toEqual({ worktreePath: "/r/wt", message: "Created worktree" });
  expect(r.context?.length).toBe(1);
  expect(r.context?.[0]).toContain("worktree-refresh: rebase onto origin/main conflicted and was aborted");
  expect(r.context?.[0]).toContain("could not apply");
  expect(calls).toContainEqual(["fetch", "origin", "main"]);
  expect(calls).toContainEqual(["rebase", "--abort"]);
});

test("EnterWorktree: a clean refresh adds no context, and switching into an existing worktree runs no git", async ($, on) => {
  stubFiles(on, {});
  stubTool(on, { worktreePath: "/r/wt", message: "Created worktree" });
  const calls = stubGit(on, worktreeGit(OK()));
  expect((await $.tool.call({ tool: "EnterWorktree", name: "wt" })).context).toBeUndefined();
  expect(calls).toContainEqual(["rebase", "origin/main"]);
  calls.length = 0;
  expect((await $.tool.call({ tool: "EnterWorktree", path: "/r/wt" })).context).toBeUndefined();
  expect(calls).toEqual([]);
});

test("EnterWorktree: worktree_refresh false runs no git", { options: { worktree_refresh: false } }, async ($, on) => {
  stubFiles(on, {});
  stubTool(on, { worktreePath: "/r/wt", message: "Created worktree" });
  const calls = stubGit(on, worktreeGit(OK()));
  expect((await $.tool.call({ tool: "EnterWorktree", name: "wt" })).context).toBeUndefined();
  expect(calls).toEqual([]);
});

// Stands for the engine's turn and prompt chains; records every prompt a plugin submitted.
function stubTurns(on: On): string[] {
  const prompts: string[] = [];
  on("turn.start", async (_$, e) => ({ turnId: e.turnId }));
  on("turn.complete", async () => ({ text: "" }));
  on("prompt.submit", async (_$, e) => {
    prompts.push(e.text);
    return { text: e.text };
  });
  return prompts;
}

const done = (turnId: string, answer: string, agentId?: string) => ({
  answer,
  durationMs: 1,
  isAborted: false,
  turnId,
  reason: "answer" as const,
  ...(agentId === undefined ? {} : { agentId }),
});

test("a main-loop answer ending in a bare question gets exactly one gate prompt; the gate's own turn is never gated", async ($, on) => {
  const clock = mock.clock(on);
  const prompts = stubTurns(on);
  await $.turn.start({ text: "do it", turnId: "t1" });
  await $.turn.complete(done("t1", "Done.\n```\nwhy?\n```\nWant me to X or Y?"));
  await clock.settle();
  expect(prompts).toEqual([GATE_REASON]);
  await $.turn.start({ text: `The coding-toolbox plugin sent a message: ${GATE_REASON}`, turnId: "t2" });
  await $.turn.complete(done("t2", "Still asking?"));
  await clock.settle();
  expect(prompts.length).toBe(1);
});

test("no gate prompt for a plain answer, a code-fenced question, or a subagent's question", async ($, on) => {
  const clock = mock.clock(on);
  const prompts = stubTurns(on);
  await $.turn.start({ text: "do it", turnId: "t1" });
  await $.turn.complete(done("t1", "All done. Summary above."));
  await $.turn.complete(done("t1", "Here:\n```\nok?\n```"));
  await $.turn.complete(done("a-t1", "Which file?", "a1"));
  await clock.settle();
  expect(prompts).toEqual([]);
});
