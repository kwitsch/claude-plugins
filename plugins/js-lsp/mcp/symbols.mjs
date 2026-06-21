// Portions © 2026 DenAleksandrov (MIT) — claude-code-lsp-enforcement-kit
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

  // Allow-list: explicit non-symbol patterns
  const allowList = [
    /^(TODO|FIXME|HACK|XXX|NOTE)/i,
    /^console\./, /^import\b/, /^require\(/, /^from\b/, /^export\b/,
    /^\/\//, /^#/, /^\./, /^http/i, /^\d/,
    /^[A-Z_]{3,}$/,    // SCREAMING_SNAKE — env vars / constants
    /^[a-z]{1,8}$/,    // short all-lowercase — too generic
    /^['"`]/,
    /^use (client|server)/,
  ];
  if (allowList.some(rx => rx.test(s))) return false;

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
  const isDottedSymbol = /^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/.test(s);
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

// ── extractGrepTargets ────────────────────────────────────────────────────────
// Ported from bash-grep-block.js with an added `paths` extraction for
// isJsTarget's Bash case. Core grep detection and symbol extraction are
// verbatim; `paths` collects non-flag, non-pattern arguments.
//
// Preserved invariants:
//   - grep detection case-insensitive (/i), matches grep|rg|ag|ack NOT git grep
//   - String(??'').trim() coercion on input
//   - Zero-width strip on command before regex matching
//   - Pipe-exemption fires only when no symbol is present (security audit fix)
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

  // ── Extract the search pattern ────────────────────────────────────────────
  const cleaned = cmd.replace(/\\"/g, '"');
  const patternMatch =
    cleaned.match(/\b(?:grep|rg|ag|ack)\s+(?:-\S+\s+)*"([^"]+)"/i) ||
    cleaned.match(/\b(?:grep|rg|ag|ack)\s+(?:-\S+\s+)*'([^']+)'/i) ||
    cleaned.match(/\b(?:grep|rg|ag|ack)\s+(?:(?:-\w+\s+(?:[a-z]+\s+)?)*?)([A-Z][a-zA-Z]\w+)/i);

  let symbols = [];
  if (patternMatch) {
    const fullPattern = patternMatch[1];
    // Split on both | and . so dotted expressions aren't merged into camelCase
    const parts = fullPattern
      .split(/\\?\||\./)
      .map(p => p.replace(ZW, '').replace(/[*+?^${}()[\]\\]/g, '').trim())
      .filter(Boolean);

    symbols = parts.filter(p => {
      if (p.length < 4 || /\s/.test(p)) return false;
      const skip = [
        /^(TODO|FIXME|HACK|XXX|NOTE)/i,
        /^console\b/, /^import\b/, /^export\b/, /^http/i, /^\d/,
        /^[A-Z_]{3,}$/, /^[a-z]{1,8}$/, /^[a-z]+-[a-z]+/,
      ];
      if (skip.some(rx => rx.test(p))) return false;

      return (/^[a-z][a-zA-Z0-9]{3,}$/.test(p) && /[A-Z]/.test(p)) ||
             /^[A-Z][a-zA-Z][a-zA-Z0-9]{2,}$/.test(p) ||
             (/^[a-z]+(_[a-z]+){2,}$/.test(p) && p.length >= 9);
    });
  }

  // ── Extract file/glob paths ───────────────────────────────────────────────
  // Collect non-flag tokens that appear after the pattern position.
  // These are candidate file paths / globs (e.g. "src/app.js", "**/*.js").
  const paths = [];
  // Tokenize the command; skip flags (-r, --include=...) and the grep verb itself
  // and the search pattern (first non-flag token after the verb).
  const tokens = cleaned.split(/\s+/);
  let verbSeen = false;
  let patternSeen = false;
  for (const tok of tokens) {
    if (!verbSeen) {
      if (/^(grep|rg|ag|ack)$/i.test(tok)) verbSeen = true;
      continue;
    }
    if (tok.startsWith('-')) continue;        // flag
    if (!patternSeen) { patternSeen = true; continue; } // skip search pattern token
    // Everything after the pattern is a path/glob argument
    // Strip surrounding quotes
    paths.push(tok.replace(/^['"]|['"]$/g, ''));
  }

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
