import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectInflightSubagents, subagentsDirFor } from "../../plugins/cave-context/mcp/subagent-watch.mjs";

// Build <tmp>/<uuid>.jsonl + <tmp>/<uuid>/subagents/ and return the transcript path.
function layout() {
  const base = mkdtempSync(join(tmpdir(), "cc-saw-"));
  const uuid = "11111111-2222-3333-4444-555555555555";
  const transcript = join(base, `${uuid}.jsonl`);
  writeFileSync(transcript, '{"type":"summary"}\n');
  const subs = join(base, uuid, "subagents");
  mkdirSync(subs, { recursive: true });
  return { base, transcript, subs };
}
const RUNNING = '{"type":"assistant","message":{"role":"assistant"}}\n';
const DONE = '{"type":"assistant","message":{"role":"assistant"},"stop_reason":"end_turn"}\n';

test("subagentsDirFor strips .jsonl and appends /subagents", () => {
  const { transcript, subs } = layout();
  assert.equal(subagentsDirFor(transcript), subs);
});

test("in-flight agent file (no end_turn, fresh) is detected", () => {
  const { transcript, subs } = layout();
  writeFileSync(join(subs, "agent-abc.jsonl"), RUNNING);
  assert.deepEqual(detectInflightSubagents(transcript, Date.now()), ["agent-abc"]);
});

test("finished agent file (last line end_turn) is not detected", () => {
  const { transcript, subs } = layout();
  writeFileSync(join(subs, "agent-abc.jsonl"), RUNNING + DONE);
  assert.deepEqual(detectInflightSubagents(transcript, Date.now()), []);
});

test("multi-turn file with early end_turn then more activity is detected (last-line check)", () => {
  const { transcript, subs } = layout();
  writeFileSync(join(subs, "agent-abc.jsonl"), DONE + RUNNING);
  assert.deepEqual(detectInflightSubagents(transcript, Date.now()), ["agent-abc"]);
});

test("stale mtime (older than window) is not detected", () => {
  const { transcript, subs } = layout();
  const f = join(subs, "agent-old.jsonl");
  writeFileSync(f, RUNNING);
  const old = (Date.now() - 10 * 60_000) / 1000; // 10 min ago, in seconds
  utimesSync(f, old, old);
  assert.deepEqual(detectInflightSubagents(transcript, Date.now()), []);
});

test("absent subagents dir or non-.jsonl transcript -> []", () => {
  const base = mkdtempSync(join(tmpdir(), "cc-saw-"));
  assert.equal(subagentsDirFor(join(base, "nope.txt")), null);
  assert.deepEqual(detectInflightSubagents(join(base, "missing.jsonl"), Date.now()), []);
});
