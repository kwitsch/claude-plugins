'use strict';
import { isJsTarget, isCodeSymbol, extractGrepTargets, globTokens } from './symbols.mjs';
import { readState, writeState, resetState } from './state.mjs';

export const ESCAPE_THRESHOLD = 2;
export const GATE2_AT = 4;
// NOTE: WARMUP_AT and GATE3_AT are intentionally absent — the gate table uses only two thresholds.

const ENFORCE_SEARCH = process.env.JS_LSP_ENFORCE_SEARCH !== 'false';     // fail-open
const ENFORCE_READ_GATE = process.env.JS_LSP_ENFORCE_READ_GATE === 'true'; // fail-closed

const ALLOW = {};
const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

const LSP_HINT = (file) =>
  `js-lsp: use the LSP tool on ${file} (jump to definition / find references) instead of text search. ` +
  `One LSP navigation call here is cheaper and more precise than grep.`;

// in-memory first-sighting reset (per server process)
const seen = new Set();
export function __resetSeenForTest() { seen.clear(); }
function maybeReset(cwd) {
  if (cwd == null || seen.has(cwd)) return;
  seen.add(cwd);
  resetState(cwd);
}

function symbolInSearch(toolName, input) {
  if (toolName === 'Grep') return String(input.pattern ?? '').split('|').some(isCodeSymbol);
  if (toolName === 'Glob') return globTokens(input.pattern).some(isCodeSymbol);
  if (toolName === 'Bash') return extractGrepTargets(input.command).symbols.some(isCodeSymbol);
  return false;
}

function searchGuard(toolName, input) {
  if (!ENFORCE_SEARCH) return ALLOW;
  if (!isJsTarget(toolName, input)) return ALLOW;
  if (!symbolInSearch(toolName, input)) return ALLOW;
  return deny(LSP_HINT('the JavaScript file you are searching'));
}

function readGate(cwd, file) {
  if (!ENFORCE_READ_GATE) return ALLOW;
  if (cwd == null) return ALLOW;                       // malformed event: fail open
  const s = readState(cwd);
  if (s.lspUnavailable) return ALLOW;                  // escape hatch already engaged

  // Escape-hatch ceiling check at entry (before this read increments blockedNoNav),
  // so read #(ESCAPE_THRESHOLD+1) returns ALLOW after exactly ESCAPE_THRESHOLD denials.
  // Fail open regardless of navCount (spec §5.3): once navCount===1, Gate 2 would
  // otherwise deny every read forever (the escape hatch could never release).
  if (s.blockedNoNav >= ESCAPE_THRESHOLD) {
    s.lspUnavailable = true;
    writeState(cwd, s);
    return ALLOW;
  }

  s.readCount += 1;
  let reason = null;

  if (!s.warmupDone) {
    reason = `js-lsp: warm up the LSP first — call the LSP tool on ${file} (jump to definition / find references), then re-read.`;
  } else if (s.readCount >= GATE2_AT && s.navCount < 2) {
    // Gate 2: >=4 reads and fewer than 2 LSP calls -> require surgical mode (2 navs)
    reason = `js-lsp: ${s.readCount} reads with <2 LSP navigation calls. Make one more LSP call (find references / jump to definition) on ${file} to enter surgical mode.`;
  }

  if (reason) {
    s.blockedNoNav += 1;
    writeState(cwd, s);
    return deny(reason);
  }
  writeState(cwd, s);
  return ALLOW;
}

export function handlePreToolUse(event) {
  try {
    if (!event || typeof event !== 'object') return ALLOW;
    const { tool_name, cwd } = event;
    const input = (event.tool_input && typeof event.tool_input === 'object') ? event.tool_input : {};
    maybeReset(cwd);
    if (tool_name === 'Read') {
      if (!isJsTarget('Read', input)) return ALLOW;    // JS-scope guard: non-JS reads pass through
      return readGate(cwd, String(input.file_path ?? 'the file'));
    }
    if (tool_name === 'Grep' || tool_name === 'Glob' || tool_name === 'Bash') return searchGuard(tool_name, input);
    return ALLOW;
  } catch { return ALLOW; }
}

export function handlePostToolUse(event) {
  try {
    if (!event || event.tool_name !== 'LSP') return ALLOW;
    // Only a SUCCESSFUL LSP call re-arms the gate. Fail open on a missing field
    // (absent tool_response → treat as success, unchanged behavior), but an
    // explicit success:false must NOT advance warmupDone/navCount or clear
    // lspUnavailable/blockedNoNav — else a failed LSP attempt (vtsls down) would
    // wipe the escape-hatch state the read gate relies on to release reads.
    if (event.tool_response && event.tool_response.success === false) return ALLOW;
    const cwd = event.cwd;
    maybeReset(cwd);
    const s = readState(cwd);
    s.warmupDone = true;
    s.navCount += 1;
    s.lspUnavailable = false;
    s.blockedNoNav = 0;   // re-arm the read gate: a successful LSP call clears the escape-hatch counter
    writeState(cwd, s);
    return ALLOW;
  } catch { return ALLOW; }
}
