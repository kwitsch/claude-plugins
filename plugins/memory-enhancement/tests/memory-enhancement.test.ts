import { expect, mock, test, type TestBody } from "claude-code/testing";
import { NUDGE, dueKey } from "../hooks/dream.mjs";

type Engine = Parameters<TestBody>[0];
type On = Parameters<TestBody>[1];

const PROJECT = "/work/project";
const REAL = "/real/project"; // where PROJECT's realpath lands
const DONE = { answer: "", durationMs: 1, isAborted: false, turnId: "t1", reason: "answer" as const };

type World = { store: Map<string, unknown> };

// The world beneath the mod: an in-memory $.store, a session with `turns` user turns.
function world(on: On, turns: number, entries: Record<string, unknown> = {}): World {
  const w: World = { store: new Map(Object.entries(entries)) };
  on("session.root", async () => ({ value: PROJECT }));
  on("session.turns", async () => ({ value: turns }));
  on("fs.stat", async (_$, e) => ({
    value: { kind: "dir" as const, size: 0, mtimeMs: 0, isLink: false, ...(e.path === PROJECT ? { realPath: REAL } : {}) },
  }));
  on("store.get", async (_$, e) => ({ value: w.store.get(e.key) }));
  on("store.set", async (_$, e) => {
    w.store.set(e.key, e.value);
    return { value: undefined };
  });
  on("store.delete", async (_$, e) => {
    w.store.delete(e.key);
    return { value: undefined };
  });
  on("turn.complete", async () => ({ text: "" }));
  on("session.start", async (_$, e) => ({ cwd: e.cwd }));
  return w;
}

const key = (): Promise<string> => dueKey(REAL);
const start = ($: Engine) => $.session.start({ cwd: PROJECT, surface: null, isInteractive: false });

test("a main-loop turn end sets the project's key under the realpath hash", async ($, on) => {
  const w = world(on, 0);
  await $.turn.complete(DONE);
  expect([...w.store]).toEqual([[await key(), true]]);
});

test("an existing key is left untouched (no rewrite)", async ($, on) => {
  const w = world(on, 0, { [await key()]: "keep" });
  await $.turn.complete(DONE);
  expect(w.store.get(await key())).toBe("keep");
});

test("subagent, aborted and errored turns set nothing", async ($, on) => {
  const w = world(on, 0);
  await $.turn.complete({ ...DONE, agentId: "a1" });
  await $.turn.complete({ ...DONE, isAborted: true, reason: "aborted" });
  await $.turn.complete({ ...DONE, reason: "error" });
  expect(w.store.size).toBe(0);
});

test("a fresh startup with the key set appends the nudge and deletes the key", async ($, on) => {
  const w = world(on, 0, { [await key()]: true });
  const s = mock.session(on);
  await start($);
  expect(w.store.size).toBe(0);
  expect(s.appended().map((r) => r.message)).toEqual([{ type: "user", role: "user", isMeta: true, content: [{ type: "text", text: NUDGE }] }]);
});

test("a fresh startup without the key appends nothing", async ($, on) => {
  world(on, 0);
  const s = mock.session(on);
  await start($);
  expect(s.appended()).toEqual([]);
});

test("another project's key is not consumed", async ($, on) => {
  const w = world(on, 0, { [await dueKey("/elsewhere")]: true });
  const s = mock.session(on);
  await start($);
  expect(w.store.size).toBe(1);
  expect(s.appended()).toEqual([]);
});

test("a resumed session (user turns already in the transcript) keeps the key and appends nothing", async ($, on) => {
  const w = world(on, 3, { [await key()]: true });
  const s = mock.session(on);
  await start($);
  expect(w.store.has(await key())).toBe(true);
  expect(s.appended()).toEqual([]);
});

test("auto_dream false keeps the key and appends nothing", { options: { auto_dream: false } }, async ($, on) => {
  const w = world(on, 0, { [await key()]: true });
  const s = mock.session(on);
  await start($);
  expect(w.store.has(await key())).toBe(true);
  expect(s.appended()).toEqual([]);
});

test("auto_dream false still sets the key at turn end", { options: { auto_dream: false } }, async ($, on) => {
  const w = world(on, 0);
  await $.turn.complete(DONE);
  expect(w.store.has(await key())).toBe(true);
});
