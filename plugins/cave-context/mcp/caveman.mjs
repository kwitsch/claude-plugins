// caveman.mjs — reimplemented caveman core (zero-dep). caveman:compress format.
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const VALID_LEVELS = ["lite", "full", "ultra"];
export const DEFAULT_LEVEL = "full";
const STATE_FILE = "active-level";
const MAX_BYTES = 16;

export function stateDir() {
  const base = process.env.CLAUDE_PLUGIN_DATA && process.env.CLAUDE_PLUGIN_DATA.trim()
    ? process.env.CLAUDE_PLUGIN_DATA
    : join(homedir(), ".claude", "cave-context");
  try { mkdirSync(base, { recursive: true }); } catch { /* ignore */ }
  return base;
}

function flagPath(dir) { return join(dir, STATE_FILE); }

export function writeLevel(dir, level) {
  if (!VALID_LEVELS.includes(level)) return false; // refuse invalid — no silent overwrite
  try { writeFileSync(flagPath(dir), level, { mode: 0o600 }); return true; } catch { return false; }
}

export function clearLevel(dir) { try { unlinkSync(flagPath(dir)); } catch { /* ignore */ } }

export function readLevel(dir) {
  const p = flagPath(dir);
  try {
    const st = lstatSync(p);
    if (!st.isFile() || st.size > MAX_BYTES) return null; // symlink/oversize → reject
    const v = readFileSync(p, "utf8").trim();
    return VALID_LEVELS.includes(v) ? v : null;
  } catch { return null; }
}

const ACT = /\b(activate|enable|turn on|start|talk like)\b.*\bcaveman\b|\bcaveman\b.*\b(mode|activate|enable|turn on|start)\b/i;
const DEACT = /\b(stop|disable|deactivate|turn off)\b.*\bcaveman\b|\bcaveman\b.*\b(stop|disable|deactivate|turn off)\b|\bnormal mode\b/i;

// Returns: a level string, "off", or null (no change requested).
export function detectLevelChange(prompt) {
  const p = (prompt || "").trim();
  const low = p.toLowerCase();
  if (DEACT.test(low)) return "off";
  const m = low.match(/^\/(?:caveman|cave-context)(?:\s+(\S+))?/);
  if (m) {
    const arg = m[1];
    if (!arg) return DEFAULT_LEVEL;
    if (["off", "stop", "disable"].includes(arg)) return "off";
    if (VALID_LEVELS.includes(arg)) return arg;
    return null; // unknown arg → no change
  }
  if (ACT.test(low)) return DEFAULT_LEVEL;
  return null;
}

export function rulesetText(level) {
  const lvl = VALID_LEVELS.includes(level) ? level : DEFAULT_LEVEL;
  return [
    `CAVE-CONTEXT MODE ACTIVE — level: ${lvl}`,
    "",
    "Respond terse like smart caveman. All technical substance stay. Only fluff die.",
    "",
    "## Persistence",
    `ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift. Still active if unsure. Off only: "stop caveman" / "normal mode". Current level: ${lvl}. Switch: /caveman lite|full|ultra.`,
    "",
    "## Rules",
    "Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries, hedging. Fragments OK. Short synonyms. Technical terms exact. Code blocks unchanged. Errors quoted exact.",
    "Pattern: [thing] [action] [reason]. [next step].",
    "",
    "## Auto-Clarity",
    "Drop caveman for: security warnings, irreversible actions, multi-step sequences where order risks misread, user confused/repeats. Resume after.",
    "",
    "## Boundaries",
    "Code/commits/PRs: write normal. Level persist until changed or session end.",
  ].join("\n");
}

export function reminderText(level) {
  const lvl = VALID_LEVELS.includes(level) ? level : DEFAULT_LEVEL;
  return `CAVE-CONTEXT MODE ACTIVE (${lvl}). Drop articles/filler/pleasantries/hedging. Fragments OK. Code/commits/security: write normal.`;
}
