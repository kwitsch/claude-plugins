// Portions © 2026 DenAleksandrov (MIT) — claude-code-lsp-enforcement-kit
// symbols.mjs — JavaScript symbol extraction and target classification for js-lsp.
// Determines whether a Bash/Grep/Glob/Read tool call targets JS files and extracts
// code symbols from grep patterns. Pure logic, no stdout, safe on the hook hot-path.
'use strict';

// Zero-width / formatting chars that bypass ASCII regex symbol detection
// by splitting tokens invisibly. Strip them before any symbol check.
const ZW = /[­​-‏⁠-⁤﻿]/g;

/**
 * Coerce input to string and strip zero-width / invisible format chars.
 * @param {*} s
 * @returns {string}
 */
export function stripZeroWidth(s) {
  return String(s ?? '').replace(ZW, '');
}

// Allow-lists of explicit NON-symbols, hoisted to module scope so they are not
// rebuilt on every call (these run on the hook hot path). They are TWO
// intentionally-distinct verbatim ports and must NOT be unified:
//   ISCODESYMBOL_ALLOWLIST — from the kit's lsp-first-guard.js (Grep/Glob path).
//   CLASSIFY_SKIP          — from the kit's bash-grep-block.js (Bash path); a
//     deliberately narrower list. The kit ships two different upstream filters,
//     so Grep/Glob and Bash apply slightly different allow-lists by design.
const ISCODESYMBOL_ALLOWLIST = [
  /^(TODO|FIXME|HACK|XXX|NOTE)/i,
  /^console\./, /^import\b/, /^require\(/, /^from\b/, /^export\b/,
  /^\/\//, /^#/, /^\./, /^http/i, /^\d/,
  /^[A-Z_]{3,}$/,    // SCREAMING_SNAKE — env vars / constants
  /^[a-z]{1,8}$/,    // short all-lowercase — too generic
  /^['"`]/,
  /^use (client|server)/,
];
const CLASSIFY_SKIP = [
  /^(TODO|FIXME|HACK|XXX|NOTE)/i,
  /^console\b/, /^import\b/, /^export\b/, /^http/i, /^\d/,
  /^[A-Z_]{3,}$/, /^[a-z]{1,8}$/, /^[a-z]+-[a-z]+/,
];

// ── isCodeSymbol ──────────────────────────────────────────────────────────────
// Ported verbatim from lsp-first-guard.js (Grep hook) with String(??'').trim()
// coercion from the security audit (bash-grep-block.js / detect-lsp-provider.js).
// Preserved invariants:
//   - String(x ?? '').trim() coercion → non-string input never throws (fail-open)
//   - SCREAMING_SNAKE /^[A-Z_]{3,}$/ → NOT a symbol (env vars / constants)
//   - Zero-width strip before regexes (unicode-bypass fix via stripZeroWidth)
//   - kebab-case: only specific suffix/prefix patterns are symbols; plain kebab → allow
//   - dotted symbol support: router.refresh → symbol
//   - snake_case with 3+ segments (length ≥ 9) → symbol
/**
 * Returns true if `tokenRaw` looks like a code symbol by naming convention.
 * @param {*} tokenRaw
 * @returns {boolean}
 */
export function isCodeSymbol(tokenRaw) {
  // String coercion: non-string input (number, array, null) NEVER throws — fail-open.
  const s = stripZeroWidth(tokenRaw).trim();
  if (!s) return false;
  if (s.length < 4) return false;
  if (/\s/.test(s)) return false;
  if (/[&?+[\]{}()\\^$*]/.test(s)) return false;

  // Allow-list: explicit non-symbol patterns (ISCODESYMBOL_ALLOWLIST, module scope)
  if (ISCODESYMBOL_ALLOWLIST.some(rx => rx.test(s))) return false;

  // kebab-case handling — filename conventions are allowed, but specific
  // component/module suffixes and category prefixes are treated as symbols.
  if (/^[a-z]+-[a-z]/.test(s)) {
    // Tailwind / CSS utility prefixes — always allowed
    if (/^(text-|bg-|border-|font-|hover:|focus:|active:|group-|ring-|shadow-|rounded-|flex-|grid-|gap-|space-|divide-|overflow-|whitespace-|break-|leading-|tracking-|align-|justify-|items-|self-|order-|col-|row-|transition-|duration-|ease-|animate-|scale-|rotate-|translate-|origin-|cursor-|select-|resize-|appearance-|outline-|decoration-|underline-|line-|placeholder-|caret-|accent-|sr-|z-|opacity-|w-|h-|p-|m-|px-|py-|pt-|pb-|pl-|pr-|mx-|my-|mt-|mb-|ml-|mr-|max-|min-|inset-|top-|right-|bottom-|left-|float-|data-)/.test(s)) {
      return false;
    }
    // Kebab ending in a UI component/architectural suffix → symbol
    if (/-(modal|form|dialog|sidebar|popover|tab|list|card|button|widget|table|page|layout|header|footer|section|panel|gallery|grid|menu|nav|banner|badge|skeleton|spinner|tooltip|dropdown|select|input|textarea|checkbox|radio|switch|slider|avatar|icon|chip|toast|alert|bar|row|cell|item|field|wrapper|container|provider|context|hook|view|screen|chart|editor|builder|filler|picker|uploader|timeline|breadcrumb|steward|runner|tester|checker|resolver|reviewer|optimizer|detector|guard|enforcer)s?$/.test(s)) {
      return true;
    }
    // Kebab starting with a module-category prefix → symbol
    if (/^(actions?|helpers?|utils?|hooks?|types?|constants?|validations?|services?)-/.test(s)) {
      return true;
    }
    // Plain kebab → allow (filename convention, not a code symbol)
    return false;
  }

  // Core symbol patterns
  const isCamelCase    = /^[a-z][a-zA-Z0-9]{3,}$/.test(s) && /[A-Z]/.test(s);
  const isPascalCase   = /^[A-Z][a-zA-Z][a-zA-Z0-9]{2,}$/.test(s);
  const isDottedSymbol = /^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/i.test(s);
  const isSnakeCaseFn  = /^[a-z]+(_[a-z]+){2,}$/.test(s) && s.length >= 9;

  return isCamelCase || isPascalCase || isDottedSymbol || isSnakeCaseFn;
}

// ── globTokens ────────────────────────────────────────────────────────────────
// Ported verbatim from lsp-first-glob-guard.js token extraction.
/**
 * Extract alphabetic tokens from a glob pattern (strips *, /, ., brackets, etc.).
 * @param {*} patternRaw
 * @returns {string[]}
 */
export function globTokens(patternRaw) {
  const pattern = String(patternRaw ?? '').trim();
  return pattern
    .split(/[*/.\\{}\[\]()!?,\s|+-]+/)
    .map(t => t.trim())
    .filter(Boolean);
}

// ── extractGrepTargets helpers ──────────────────────────────────────────────────
// Value-taking flags consume their following token (or `=value`) as a value,
// grouped by what the value means. Without this, `rg -g '*.js' getUserById` and
// `rg getUserById --glob '*.js'` mistake the glob value for the search pattern and
// evade JS-symbol enforcement (CodeRabbit CR4).
const GREP_FLAG_PATTERN = new Set(['e', 'regexp']);                              // value is a search pattern
const GREP_FLAG_GLOB = new Set(['g', 'glob', 'iglob', 'include', 'include-dir']); // value is a glob/path
const GREP_FLAG_SKIP = new Set([                                                  // value is non-pattern noise
  'f', 'file', 'm', 'max-count', 'A', 'after-context', 'B', 'before-context',
  'C', 'context', 't', 'type', 'T', 'type-not', 'exclude', 'exclude-dir', 'd', 'D',
]);

// Strip one matching leading/trailing quote (single or double) from a token.
function stripQuotes(s) {
  return String(s ?? '').replace(/^['"]|['"]$/g, '');
}

// Extract the flag name (without dashes) from a -x / --xx option token; "" if not a flag.
function grepFlagName(tok) {
  const m = String(tok).match(/^--?([a-zA-Z][\w-]*)/);
  return m ? m[1] : '';
}

// Classify one pattern token into code symbols. Verbatim from the kit's
// bash-grep-block.js symbol filter: split on | and . (so dotted expressions
// aren't merged into camelCase), strip regex metachars, then apply the predicates.
function classifyPatternToSymbols(fullPattern) {
  const parts = String(fullPattern)
    .split(/\\?\||\./)
    .map(p => p.replace(ZW, '').replace(/[*+?^${}()[\]\\]/g, '').trim())
    .filter(Boolean);
  return parts.filter(p => {
    if (p.length < 4 || /\s/.test(p)) return false;
    if (CLASSIFY_SKIP.some(rx => rx.test(p))) return false;
    return (/^[a-z][a-zA-Z0-9]{3,}$/.test(p) && /[A-Z]/.test(p)) ||
           /^[A-Z][a-zA-Z][a-zA-Z0-9]{2,}$/.test(p) ||
           (/^[a-z]+(_[a-z]+){2,}$/.test(p) && p.length >= 9);
  });
}

// ── extractGrepTargets ────────────────────────────────────────────────────────
// Ported from bash-grep-block.js with an added `paths` extraction for
// isJsTarget's Bash case. Core grep detection and symbol extraction are
// verbatim; `paths` collects non-flag, non-pattern arguments.
//
// Preserved invariants:
//   - grep detection case-insensitive (/i), matches grep|rg|ag|ack NOT git grep
//   - String(??'').trim() coercion on input
//   - Zero-width strip on command before regex matching
//   - Pipe-exemption (no-symbol pass-through) is deferred to the hook decision layer, not here
//   - Split on both | and . before symbol filter (avoids camelCase false positives)
/**
 * Parse a Bash command and extract grep metadata.
 * @param {*} commandRaw
 * @returns {{ isGrep: boolean, symbols: string[], paths: string[] }}
 */
export function extractGrepTargets(commandRaw) {
  const cmd = String(commandRaw ?? '').trim().replace(ZW, '');

  // git grep is explicitly excluded
  if (/\bgit\s+grep\b/i.test(cmd)) {
    return { isGrep: false, symbols: [], paths: [] };
  }

  // Case-insensitive: catches GREP, RG, Ag, etc.
  if (!/\b(grep|rg|ag|ack)\b/i.test(cmd)) {
    return { isGrep: false, symbols: [], paths: [] };
  }

  // ── Token walk: classify each arg as flag / flag-value / pattern / path ────
  // Handles value-taking flags so a glob value (`-g '*.js'`) is never mistaken
  // for the search pattern, and a JS glob/include value still marks the call as
  // JS-targeted. The pattern is the first positional token (unless -e/--regexp
  // supplied it); the audited symbol classification stays in classifyPatternToSymbols.
  const tokens = cmd.replace(/\\"/g, '"').split(/\s+/).filter(Boolean);
  const patternCandidates = [];
  const paths = [];
  let verbSeen = false;
  let patternFromFlag = false;        // -e/--regexp provided the search pattern
  let positionalPatternTaken = false;

  const consumeFlagValue = (name, rawVal) => {
    const val = stripQuotes(rawVal);
    if (GREP_FLAG_PATTERN.has(name)) { patternCandidates.push(val); patternFromFlag = true; }
    else if (GREP_FLAG_GLOB.has(name) && looksJs(val)) { paths.push(val); }
    // GREP_FLAG_SKIP / unknown value-flags: value ignored
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!verbSeen) {
      if (/^(grep|rg|ag|ack)$/i.test(tok)) verbSeen = true;
      continue;
    }
    if (tok.startsWith('-')) {
      const name = grepFlagName(tok);
      const eq = tok.indexOf('=');
      if (eq >= 0) { consumeFlagValue(name, tok.slice(eq + 1)); continue; } // --glob=*.js
      if (GREP_FLAG_PATTERN.has(name) || GREP_FLAG_GLOB.has(name) || GREP_FLAG_SKIP.has(name)) {
        if (i + 1 < tokens.length) { consumeFlagValue(name, tokens[i + 1]); i++; } // next token is the value
        continue;
      }
      continue;                                                            // boolean flag
    }
    // positional (non-flag) token
    const val = stripQuotes(tok);
    if (!patternFromFlag && !positionalPatternTaken) {
      patternCandidates.push(val);
      positionalPatternTaken = true;
    } else {
      paths.push(val);
    }
  }

  const symbols = patternCandidates.flatMap(classifyPatternToSymbols);
  return { isGrep: true, symbols, paths };
}

// ── isJsTarget ────────────────────────────────────────────────────────────────
// NEW — not in the kit. Returns true ONLY when the target is unambiguously
// JavaScript (.js/.cjs/.mjs/.jsx). Ambiguous targets (bare grep with no JS
// path/glob, non-JS extensions) return false (fail-open / pass-through).
const JS_EXT = /\.(?:js|cjs|mjs|jsx)(?:$|["'\s])/i;

function looksJs(s) {
  return JS_EXT.test(String(s ?? ''));
}

/**
 * Returns true only when the tool call unambiguously targets JavaScript files.
 * Ambiguous targets return false (fail-open).
 * @param {string} toolName
 * @param {object} [input]
 * @returns {boolean}
 */
export function isJsTarget(toolName, input = {}) {
  switch (toolName) {
    case 'Read':
      return looksJs(input.file_path);
    case 'Grep':
      return looksJs(input.glob) || looksJs(input.path);
    case 'Glob':
      return looksJs(input.pattern);
    case 'Bash': {
      const { isGrep, paths } = extractGrepTargets(input.command);
      return isGrep && paths.some(looksJs);
    }
    default:
      return false;
  }
}
