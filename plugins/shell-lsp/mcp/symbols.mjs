// Portions © 2026 DenAleksandrov (MIT) — claude-code-lsp-enforcement-kit
'use strict';

// Zero-width / formatting chars that bypass ASCII regex symbol detection.
const ZW = /[­​-‏⁠-⁤﻿]/g;

export function stripZeroWidth(s) {
  return String(s ?? '').replace(ZW, '');
}

// ── isShellCodeSymbol ───────────────────────────────────────────────────────
// Shell "code symbols" worth redirecting to LSP are function- and variable-name
// shaped tokens. Conservative, because a bare grep token carries weak signal:
//   - namespaced function:  name::sub        (e.g. git::push, log::info)
//   - multi-word snake_case: >=2 segments    (e.g. deploy_app), length >= 5
// Everything else passes through (fail-open): single words, SCREAMING_SNAKE
// (env vars), single letters, camelCase/Pascal/dotted (no shell convention).
const NAMESPACED = /^[a-z][a-z0-9]*::[a-z][a-z0-9_]*$/;
const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

export function isShellCodeSymbol(tokenRaw) {
  const s = stripZeroWidth(tokenRaw).trim();
  if (!s) return false;
  if (/\s/.test(s)) return false;
  if (s.includes('/')) return false;                    // path, not a symbol
  if (/[&?+[\]{}()\\^$*]/.test(s)) return false;        // regex/glob metachars
  if (/^['"`#]/.test(s) || /^\d/.test(s)) return false; // quoted / comment / numeric
  if (/^(TODO|FIXME|HACK|XXX|NOTE)/i.test(s)) return false;
  if (NAMESPACED.test(s)) return true;
  if (s.length >= 5 && SNAKE.test(s)) return true;
  return false;
}

// ── globTokens ──────────────────────────────────────────────────────────────
// Ported verbatim from js-lsp.
export function globTokens(patternRaw) {
  const pattern = String(patternRaw ?? '').trim();
  return pattern
    .split(/[*/.\\{}\[\]()!?,\s|+-]+/)
    .map(t => t.trim())
    .filter(Boolean);
}

// ── grep flag tables (verbatim from js-lsp) ──────────────────────────────────
const GREP_FLAG_PATTERN = new Set(['e', 'regexp']);
const GREP_FLAG_GLOB = new Set(['g', 'glob', 'iglob', 'include', 'include-dir']);
const GREP_FLAG_SKIP = new Set([
  'f', 'file', 'm', 'max-count', 'A', 'after-context', 'B', 'before-context',
  'C', 'context', 't', 'type', 'T', 'type-not', 'exclude', 'exclude-dir', 'd', 'D',
]);

function stripQuotes(s) { return String(s ?? '').replace(/^['"]|['"]$/g, ''); }
function grepFlagName(tok) { const m = String(tok).match(/^--?([a-zA-Z][\w-]*)/); return m ? m[1] : ''; }

// Shell pattern splitter: split ONLY on | (alternation) — NEVER on ':' (keep
// name::sub) — strip regex metachars while KEEPING _ and :, apply NO naming
// predicate (isShellCodeSymbol is the sole authority, applied in handlers).
function splitPatternTokens(fullPattern) {
  return String(fullPattern)
    .split(/\\?\|/)
    .map(p => p.replace(ZW, '').replace(/[*+?^${}()[\]\\]/g, '').trim())
    .filter(Boolean);
}

const SHELL_EXT = /\.(?:sh|bash)(?:$|["'\s])/i;
function looksShell(s) { return SHELL_EXT.test(String(s ?? '')); }

// ── extractGrepTargets (ported from js-lsp; looksJs→looksShell, JS filter→shell) ─
export function extractGrepTargets(commandRaw) {
  const cmd = String(commandRaw ?? '').trim().replace(ZW, '');
  if (/\bgit\s+grep\b/i.test(cmd)) return { isGrep: false, symbols: [], paths: [] };
  if (!/\b(grep|rg|ag|ack)\b/i.test(cmd)) return { isGrep: false, symbols: [], paths: [] };

  const tokens = cmd.replace(/\\"/g, '"').split(/\s+/).filter(Boolean);
  const patternCandidates = [];
  const paths = [];
  let verbSeen = false;
  let patternFromFlag = false;
  let positionalPatternTaken = false;

  const consumeFlagValue = (name, rawVal) => {
    const val = stripQuotes(rawVal);
    if (GREP_FLAG_PATTERN.has(name)) { patternCandidates.push(val); patternFromFlag = true; }
    else if (GREP_FLAG_GLOB.has(name) && looksShell(val)) { paths.push(val); }
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!verbSeen) { if (/^(grep|rg|ag|ack)$/i.test(tok)) verbSeen = true; continue; }
    if (tok.startsWith('-')) {
      const name = grepFlagName(tok);
      const eq = tok.indexOf('=');
      if (eq >= 0) { consumeFlagValue(name, tok.slice(eq + 1)); continue; }
      if (GREP_FLAG_PATTERN.has(name) || GREP_FLAG_GLOB.has(name) || GREP_FLAG_SKIP.has(name)) {
        if (i + 1 < tokens.length) { consumeFlagValue(name, tokens[i + 1]); i++; }
        continue;
      }
      continue;
    }
    const val = stripQuotes(tok);
    if (!patternFromFlag && !positionalPatternTaken) { patternCandidates.push(val); positionalPatternTaken = true; }
    else { paths.push(val); }
  }

  const symbols = patternCandidates.flatMap(splitPatternTokens);
  return { isGrep: true, symbols, paths };
}

// ── isShellTarget (shell analog of isJsTarget) ───────────────────────────────
export function isShellTarget(toolName, input = {}) {
  switch (toolName) {
    case 'Read': return looksShell(input.file_path);
    case 'Grep': return looksShell(input.glob) || looksShell(input.path);
    case 'Glob': return looksShell(input.pattern);
    case 'Bash': { const { isGrep, paths } = extractGrepTargets(input.command); return isGrep && paths.some(looksShell); }
    default: return false;
  }
}
