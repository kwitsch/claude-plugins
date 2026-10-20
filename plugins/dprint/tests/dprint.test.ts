import { expect, mock, test, type TestBody } from "claude-code/testing";
import { missingDprintWarning } from "../hooks/detect.mjs";

type On = Parameters<TestBody>[1];
type Toast = { text: string; timeoutMs?: number };

const CONFIG = "/repo/dprint.json";
const FILE = { kind: "file" as const, size: 10, mtimeMs: 0, isLink: false };

// The world beneath the plugin: HOME/PATH, which paths are regular files, and a toast recorder.
function world(on: On, files: { configs: string[]; bins: string[] }): Toast[] {
  const toasts: Toast[] = [];
  const present = new Set([...files.configs, ...files.bins]);
  mock.env(on, { HOME: "/home/tester", PATH: "/usr/bin:/opt/bin" });
  on("fs.stat", (_$, e) => (present.has(e.path) ? { value: FILE } : { deny: "ENOENT" }));
  on("ui.toast", (_$, e) => {
    toasts.push(e);
    return { value: undefined };
  });
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  return toasts;
}

// $.ui.toast is fire-and-forget: its raise settles a few host hops after the hook returned.
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

test("a cwd dprint.json with no dprint binary raises one toast", async ($, on) => {
  const toasts = world(on, { configs: [CONFIG], bins: [] });
  await $.session.start({ cwd: "/repo", surface: null, isInteractive: true });
  await settle();
  expect(toasts.length).toBe(1);
  expect(toasts[0].text).toBe(missingDprintWarning("dprint.json"));
  expect(toasts[0].timeoutMs).toBe(10000);
});

test("a .config/dprint.jsonc alone is found and named in the toast", async ($, on) => {
  const toasts = world(on, {
    configs: ["/repo/.config/dprint.jsonc"],
    bins: [],
  });
  await $.session.start({ cwd: "/repo", surface: null, isInteractive: true });
  await settle();
  expect(toasts.length).toBe(1);
  expect(toasts[0].text).toBe(missingDprintWarning(".config/dprint.jsonc"));
});

test("dprint on PATH: no toast", async ($, on) => {
  const toasts = world(on, { configs: [CONFIG], bins: ["/opt/bin/dprint"] });
  await $.session.start({ cwd: "/repo", surface: null, isInteractive: true });
  await settle();
  expect(toasts).toEqual([]);
});

test("dprint only at ~/.dprint/bin/dprint: no toast", async ($, on) => {
  const toasts = world(on, {
    configs: [CONFIG],
    bins: ["/home/tester/.dprint/bin/dprint"],
  });
  await $.session.start({ cwd: "/repo", surface: null, isInteractive: true });
  await settle();
  expect(toasts).toEqual([]);
});

test("no dprint config: no toast", async ($, on) => {
  const toasts = world(on, { configs: [], bins: [] });
  await $.session.start({ cwd: "/repo", surface: null, isInteractive: true });
  await settle();
  expect(toasts).toEqual([]);
});

test("a non-interactive session (-p / SDK): no toast", async ($, on) => {
  const toasts = world(on, { configs: [CONFIG], bins: [] });
  await $.session.start({ cwd: "/repo", surface: null, isInteractive: false });
  await settle();
  expect(toasts).toEqual([]);
});

test("toggle off: no toast", { options: { warn_missing_dprint: false } }, async ($, on) => {
  const toasts = world(on, { configs: [CONFIG], bins: [] });
  await $.session.start({ cwd: "/repo", surface: null, isInteractive: true });
  await settle();
  expect(toasts).toEqual([]);
});

test("a failing toast never fails session start (fail open)", async ($, on) => {
  mock.env(on, { HOME: "/home/tester", PATH: "/usr/bin:/opt/bin" });
  on("fs.stat", (_$, e) => (e.path === CONFIG ? { value: FILE } : { deny: "ENOENT" }));
  on("ui.toast", () => ({ deny: "boom" }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  const r = await $.session.start({
    cwd: "/repo",
    surface: null,
    isInteractive: true,
  });
  await settle();
  expect(r).toEqual({ cwd: "/repo" });
});
