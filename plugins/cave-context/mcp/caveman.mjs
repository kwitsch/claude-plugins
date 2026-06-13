// caveman.mjs — reimplemented caveman core (zero-dep). caveman:compress format.
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const VALID_LEVELS = ["lite", "full", "ultra"];
export const DEFAULT_LEVEL = "lite";
const STATE_FILE = "active-level";
const MAX_BYTES = 16;

// Read a settings.json file and return its caveman_level option, or null on any failure.
// Fail-open: missing file / parse error / missing key / invalid value → null (never throw).
function levelFromSettings(file) {
  try {
    const raw = readFileSync(file, "utf8");
    const json = JSON.parse(raw);
    const lvl = json?.pluginConfigs?.["cave-context"]?.options?.caveman_level;
    return VALID_LEVELS.includes(lvl) ? lvl : null;
  } catch { return null; }
}

// The configured default compression level, in precedence local > project > user:
//   ${CLAUDE_PROJECT_DIR}/.claude/settings.local.json
//   ${CLAUDE_PROJECT_DIR}/.claude/settings.json   (only when CLAUDE_PROJECT_DIR set)
//   ${HOME}/.claude/settings.json
// First file whose options.caveman_level is a VALID_LEVEL wins; else DEFAULT_LEVEL.
// Fully fail-open — any error anywhere yields DEFAULT_LEVEL.
export function configuredDefaultLevel() {
  try {
    const files = [];
    const projectDir = process.env.CLAUDE_PROJECT_DIR && process.env.CLAUDE_PROJECT_DIR.trim();
    if (projectDir) {
      files.push(join(projectDir, ".claude", "settings.local.json"));
      files.push(join(projectDir, ".claude", "settings.json"));
    }
    const home = process.env.HOME && process.env.HOME.trim();
    if (home) files.push(join(home, ".claude", "settings.json"));
    for (const f of files) {
      const lvl = levelFromSettings(f);
      if (lvl) return lvl;
    }
  } catch { /* fail open */ }
  return DEFAULT_LEVEL;
}

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
    if (!arg) return configuredDefaultLevel();
    if (["off", "stop", "disable"].includes(arg)) return "off";
    if (VALID_LEVELS.includes(arg)) return arg;
    return null; // unknown arg → no change
  }
  if (ACT.test(low)) return configuredDefaultLevel();
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
