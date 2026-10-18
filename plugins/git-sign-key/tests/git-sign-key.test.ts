import { expect, mock, test, type TestBody } from "claude-code/testing";
import { MISSING_KEY_WARNING, UNUSABLE_KEY_WARNING, rewriteNote, signFlags } from "../hooks/sign.mjs";

type Engine = Parameters<TestBody>[0];
type On = Parameters<TestBody>[1];
type Seen = { command: unknown; description: unknown; check: unknown };

const HOME = "/home/tester";
const KEY = `${HOME}/.claude/sign.key`;
const BASH_OK = { stdout: "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false };

// The world beneath the plugin: HOME, whether the key is a file, what bash -n / ssh-keygen answer.
function world(on: On, opts: { key: boolean; bashExit?: number; probeStderr?: string; probeFails?: boolean }): void {
  mock.env(on, { HOME });
  on("fs.stat", (_$, e) => {
    if (e.path === KEY && opts.key) return { value: { kind: "file" as const, size: 10, mtimeMs: 0, isLink: false } };
    return { deny: "ENOENT" };
  });
  on("process.run", (_$, e) => {
    if (e.argv[0] === "bash") return { value: { ...BASH_OK, exitCode: opts.bashExit ?? 0 } };
    if (opts.probeFails) return { deny: "ENOENT: ssh-keygen" };
    return { value: { ...BASH_OK, exitCode: opts.probeStderr ? 255 : 0, stderr: opts.probeStderr ?? "" } };
  });
}

// Bottom tool.call hook (stands for the engine): records the command that reached it and the permission verdict for it.
function bottomBash($: Engine, on: On, rule?: string): Seen {
  const seen: Seen = { command: "not-called", description: undefined, check: undefined };
  on("tool.check", () => ({ decision: "ask" as const, ...(rule === undefined ? {} : { rule }) }));
  on("tool.call", async (_h, e) => {
    if (e.tool !== "Bash") return { result: "" };
    seen.command = e.command;
    seen.description = e.description;
    seen.check = (await $.tool.check({ tool: "Bash", input: { command: e.command }, tool_use_id: e.tool_use_id })).decision;
    return { result: { stdout: "", stderr: "", interrupted: false } };
  });
  return seen;
}

test("a git commit reaches the tool rewritten, auto-allowed, with the note as context, when the key exists", async ($, on) => {
  world(on, { key: true });
  const seen = bottomBash($, on);
  const r = await $.tool.call({ tool: "Bash", command: 'git commit -m "x"', description: "commit" });
  expect(seen.command).toBe(`git ${signFlags(KEY)} commit -m "x"`);
  expect(seen.description).toBe("commit");
  expect(seen.check).toBe("allow");
  expect(r.context).toEqual([rewriteNote(KEY)]);
});

test("a non-commit command passes untouched and is not auto-allowed", async ($, on) => {
  world(on, { key: true });
  const seen = bottomBash($, on);
  const r = await $.tool.call({ tool: "Bash", command: "ls -la" });
  expect(seen.command).toBe("ls -la");
  expect(seen.check).toBe("ask");
  expect(r.context).toBeUndefined();
});

test("no key: a git commit passes untouched", async ($, on) => {
  world(on, { key: false });
  const seen = bottomBash($, on);
  await $.tool.call({ tool: "Bash", command: "git commit -m x" });
  expect(seen.command).toBe("git commit -m x");
  expect(seen.check).toBe("ask");
});

test("a rewrite that fails bash -n is dropped (fail open)", async ($, on) => {
  world(on, { key: true, bashExit: 2 });
  const seen = bottomBash($, on);
  await $.tool.call({ tool: "Bash", command: "git commit -m x" });
  expect(seen.command).toBe("git commit -m x");
});

test("session.start appends the missing-key warning", async ($, on) => {
  world(on, { key: false });
  const session = mock.session(on);
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  await $.session.start({ cwd: "/repo", surface: null, isInteractive: false });
  expect(JSON.stringify(session.appended())).toContain(JSON.stringify(MISSING_KEY_WARNING).slice(1, -1));
});

test("session.start appends the unusable-key warning on a passphrase signal", async ($, on) => {
  world(on, { key: true, probeStderr: "Load key: incorrect passphrase supplied to decrypt private key" });
  const session = mock.session(on);
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  await $.session.start({ cwd: "/repo", surface: null, isInteractive: false });
  expect(JSON.stringify(session.appended())).toContain(JSON.stringify(UNUSABLE_KEY_WARNING).slice(1, -1));
});

test("session.start is silent for a usable key and when ssh-keygen cannot run", async ($, on) => {
  world(on, { key: true, probeFails: true });
  const session = mock.session(on);
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  await $.session.start({ cwd: "/repo", surface: null, isInteractive: false });
  expect(session.appended()).toEqual([]);
});

test("an ask from a settings rule still prompts for a rewritten commit", async ($, on) => {
  world(on, { key: true });
  const seen = bottomBash($, on, "Bash(git:*)");
  await $.tool.call({ tool: "Bash", command: "git commit -m x" });
  expect(seen.check).toBe("ask");
});
