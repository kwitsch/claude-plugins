// subagent-watch.mjs — detect in-flight subagent transcripts for the Stop guard.
// Zero-dep (Node/Bun built-ins only).
import fs from "node:fs";
import path from "node:path";

// 3-minute recency window. Intentionally fail-open: a subagent blocked inside a
// long tool call won't update mtime, so a very short window would miss the
// exact case most prone to a lost completion notification. Consider raising to
// 10–15 min if false-negatives on long-running subagents prove to be a problem.
const WINDOW_MS = 180_000;

// Subagents dir is <session-dir>/subagents/, where <session-dir> is the transcript
// path with the .jsonl extension stripped. transcript_path is
// <projects-dir>/<session-uuid>.jsonl; subagent transcripts live at
// <projects-dir>/<session-uuid>/subagents/agent-<id>.jsonl.
export function subagentsDirFor(transcriptPath) {
  if (!transcriptPath || !transcriptPath.endsWith(".jsonl")) return null;
  const sessionDir = transcriptPath.replace(/\.jsonl$/, "");
  const cand = path.join(sessionDir, "subagents");
  try { if (fs.statSync(cand).isDirectory()) return cand; } catch {}
  return null;
}

// In-flight iff: file matches agent-*.jsonl, its LAST non-empty line lacks
// `"stop_reason":"end_turn"`, and mtime is within WINDOW_MS. Checking only the
// terminal record avoids false-negatives on multi-turn subagents whose earlier
// turns contained a non-final end_turn.
export function detectInflightSubagents(transcriptPath, nowMs) {
  const dir = subagentsDirFor(transcriptPath);
  if (!dir) return [];
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return []; }
  const inflight = [];
  for (const name of entries) {
    if (!name.startsWith("agent-") || !name.endsWith(".jsonl")) continue;
    const full = path.join(dir, name);
    let st, body;
    try {
      st = fs.statSync(full);
      if (!st.isFile()) continue;
      if (nowMs - st.mtimeMs > WINDOW_MS) continue; // stale/crashed → don't block
      body = fs.readFileSync(full, "utf8");
    } catch { continue; }
    const last = lastNonEmpty(body);
    if (!last) continue;
    if (last.includes('"stop_reason":"end_turn"')) continue; // finished
    inflight.push(name.replace(/\.jsonl$/, ""));
  }
  return inflight;
}

function lastNonEmpty(body) {
  const lines = body.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim()) return lines[i];
  }
  return null;
}
