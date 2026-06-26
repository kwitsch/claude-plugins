'use strict';
// handlers.mjs — PreToolUse and PostToolUse hook handlers for LSP-first enforcement.
// Enforces LSP warm-up and navigation quotas before allowing text search or file reads
// on language-scoped targets. All decisions are fail-open (soft deny via JSON, never throws).
import { isTsTarget, isCodeSymbol, extractGrepTargets, globTokens } from './symbols.mjs';
import { readState, writeState, resetState } from './state.mjs';

export const ESCAPE_THRESHOLD = 2;
export const GATE2_AT = 4;
// NOTE: WARMUP_AT and GATE3_AT are intentionally absent — the gate table uses only two thresholds.

const ENFORCE_SEARCH = process.env.TS_LSP_ENFORCE_SEARCH !== 'false';     // fail-open
const ENFORCE_READ_GATE = process.env.TS_LSP_ENFORCE_READ_GATE === 'true'; // fail-closed

const ALLOW = {};
const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

// Word-identical across js-lsp/ts-lsp/shell-lsp (maintainability; pinned by
// test/js-lsp/messages.test.mjs). The builders take only data (file path / count),
// never a language phrase, so the rendered strings are identical across plugins.
export const LSP_HINT = () =>
  `lsp: use the LSP tool (workspaceSymbol → goToDefinition / findReferences) instead of text search on code symbols. ` +
  `One LSP navigation call is cheaper and more precise than grep.`;
export const WARMUP_HINT = (file) =>
  `lsp: warm up the LSP first — call the LSP tool on ${file} (goToDefinition / findReferences), then re-read.`;
export const GATE2_HINT = (file, reads) =>
  `lsp: ${reads} reads with <2 LSP navigation calls. Make one more LSP call (findReferences / goToDefinition) on ${file} to enter surgical mode.`;

// in-memory first-sighting reset (per server process)
const seen = new Set();
export function __resetSeenForTest() { seen.clear(); }
// Reset persisted state on first encounter of a cwd within this server process.
function maybeReset(cwd) {
  if (cwd == null || seen.has(cwd)) return;
  seen.add(cwd);
  resetState(cwd);
}

// Return true if the tool's search pattern or command contains a code symbol.
function symbolInSearch(toolName, input) {
  if (toolName === 'Grep') return String(input.pattern ?? '').split('|').some(isCodeSymbol);
  if (toolName === 'Glob') return globTokens(input.pattern).some(isCodeSymbol);
  if (toolName === 'Bash') return extractGrepTargets(input.command).symbols.some(isCodeSymbol);
  return false;
}

// Deny symbol-bearing searches on language-scoped targets; pass everything else through.
function searchGuard(toolName, input) {
  if (!ENFORCE_SEARCH) return ALLOW;
  if (!isTsTarget(toolName, input)) return ALLOW;
  if (!symbolInSearch(toolName, input)) return ALLOW;
  return deny(LSP_HINT());
}

// Gate file reads: require LSP warm-up, enforce a navigation quota, and release
// via an escape hatch after ESCAPE_THRESHOLD consecutive denials with no LSP call.
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
    reason = WARMUP_HINT(file);
  } else if (s.readCount >= GATE2_AT && s.navCount < 2) {
    // Gate 2: >=4 reads and fewer than 2 LSP calls -> require surgical mode (2 navs)
    reason = GATE2_HINT(file, s.readCount);
  }

  if (reason) {
    s.blockedNoNav += 1;
    writeState(cwd, s);
    return deny(reason);
  }
  writeState(cwd, s);
  return ALLOW;
}

// PreToolUse hook entry point: route Read to the read gate, search tools to searchGuard.
export function handlePreToolUse(event) {
  try {
    if (!event || typeof event !== 'object') return ALLOW;
    const { tool_name, cwd } = event;
    const input = (event.tool_input && typeof event.tool_input === 'object') ? event.tool_input : {};
    maybeReset(cwd);
    if (tool_name === 'Read') {
      if (!isTsTarget('Read', input)) return ALLOW;    // TS-scope guard: non-TS reads pass through
      return readGate(cwd, String(input.file_path ?? 'the file'));
    }
    if (tool_name === 'Grep' || tool_name === 'Glob' || tool_name === 'Bash') return searchGuard(tool_name, input);
    return ALLOW;
  } catch { return ALLOW; }
}

// PostToolUse hook entry point: on a successful LSP call, advance warm-up and nav counts,
// then re-arm the read gate by clearing the escape-hatch counter.
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
