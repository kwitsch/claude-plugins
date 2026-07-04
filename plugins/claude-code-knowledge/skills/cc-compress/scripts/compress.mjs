#!/usr/bin/env node
// Compress a markdown file into caveman-style prose via a one-shot
// `claude --print` call, validate the result, retry with one targeted fix,
// and back up the original outside the source directory (the caller — the
// cc-compress SKILL.md — passes the backup root; usually the invoking
// session's temp/scratchpad dir). Validation/retry happens entirely on
// in-memory strings; the source file is written at most once, only after a
// valid result exists — a crash mid-retry can never leave it half-compressed.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

const MAX_RETRIES = 2; // 1 initial compress attempt + 1 targeted-fix retry
const MAX_FILE_SIZE = 500_000; // 500KB
const CLAUDE_TIMEOUT_MS = 120_000;

// ---------- Frontmatter / fence helpers ----------
// JS has no \A/\Z: `^`/`$` without the `m` flag already anchor to the whole
// string, which is the equivalent. `re.DOTALL` maps to the `s` flag.

const FRONTMATTER_REGEX = /^(---\r?\n.*?\r?\n---\r?\n)(.*)$/s;
const OUTER_FENCE_REGEX = /^\s*(`{3,}|~{3,})[^\n]*\n(.*)\n\1\s*$/s;

/**
 * @param {string} text
 * @returns {{ frontmatter: string, body: string }}
 */
function splitFrontmatter(text) {
  const m = text.match(FRONTMATTER_REGEX);
  if (m) return { frontmatter: m[1], body: m[2] };
  return { frontmatter: '', body: text };
}

/**
 * @param {string} text
 * @returns {string}
 */
function stripLlmWrapper(text) {
  const m = text.match(OUTER_FENCE_REGEX);
  return m ? m[2] : text;
}

// ---------- Sensitive-path denylist ----------
// Best-effort filename/path check, refused before any content reaches the
// `claude` subprocess. It does not scan file content — a secret pasted into
// an ordinary-looking notes.md would not be caught.

const SENSITIVE_BASENAME_REGEX = /^(\.env(\..+)?|\.netrc|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|authorized_keys|known_hosts|.*\.(pem|key|p12|pfx|crt|cer|jks|keystore|asc|gpg))$/i;
const SENSITIVE_PATH_COMPONENTS = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.docker']);
// Substring tokens are checked against the separator-stripped basename, which
// already subsumes whole-basename patterns like "credentials"/"secrets" —
// keep those families here only, not duplicated in the regex above.
const SENSITIVE_NAME_TOKENS = ['secret', 'credential', 'password', 'passwd', 'apikey', 'accesskey', 'token', 'privatekey'];

/**
 * @param {string} filepath
 * @returns {boolean}
 */
function isSensitivePath(filepath) {
  const name = basename(filepath);
  if (SENSITIVE_BASENAME_REGEX.test(name)) return true;
  const parts = filepath.split(sep).map((/** @type {string} */ p) => p.toLowerCase());
  if (parts.some((p) => SENSITIVE_PATH_COMPONENTS.has(p))) return true;
  const lowered = name.toLowerCase().replace(/[_\-\s.]/g, '');
  return SENSITIVE_NAME_TOKENS.some((tok) => lowered.includes(tok));
}

// ---------- Detection (markdown-only) ----------

/**
 * @param {string} filepath
 * @returns {boolean}
 */
function shouldCompress(filepath) {
  if (basename(filepath).toLowerCase().endsWith('.original.md')) return false;
  return extname(filepath).toLowerCase() === '.md';
}

// ---------- Backup path ----------
// Mirrors the parent directory name PLUS a short hash of its full resolved
// path under the backup root. A bare parent-dir-name mirror collides for two
// different directories that share a basename (e.g. two repos both named
// "app"); the hash suffix makes the mirrored segment unique to the actual
// source directory instead of merely "usually" distinct.

/**
 * @param {string} filepath
 * @param {string} backupRoot
 * @returns {string}
 */
function backupPathFor(filepath, backupRoot) {
  const dir = dirname(filepath);
  const parentName = basename(dir);
  const hash = createHash('sha256').update(dir).digest('hex').slice(0, 8);
  const stem = basename(filepath, extname(filepath));
  return resolve(backupRoot, `${parentName}-${hash}`, `${stem}.original.md`);
}

// ---------- claude CLI call ----------

/**
 * @param {string} prompt
 * @returns {string}
 */
function callClaude(prompt) {
  const result = execFileSync('claude', ['--print', '--model', 'sonnet'], {
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: CLAUDE_TIMEOUT_MS,
  });
  return stripLlmWrapper(result.trim());
}

/**
 * @param {string} original
 * @returns {string}
 */
function buildCompressPrompt(original) {
  return `Compress this markdown into caveman format.

STRICT RULES:
- Do NOT modify anything inside \`\`\` code blocks
- Do NOT modify anything inside inline backticks
- Preserve ALL URLs exactly
- Preserve ALL headings exactly
- Preserve file paths and commands
- Return ONLY the compressed markdown body — do NOT wrap the entire output in a \`\`\`markdown fence or any other fence. Inner code blocks from the original stay as-is; do not add a new outer fence around the whole file.

Only compress natural language.

TEXT:
${original}
`;
}

/**
 * @param {string} original
 * @param {string} compressed
 * @param {string[]} errors
 * @returns {string}
 */
function buildFixPrompt(original, compressed, errors) {
  const errorsStr = errors.map((e) => `- ${e}`).join('\n');
  return `You are fixing a caveman-compressed markdown file. Specific validation errors were found.

CRITICAL RULES:
- DO NOT recompress or rephrase the file
- ONLY fix the listed errors — leave everything else exactly as-is
- The ORIGINAL is provided as reference only (to restore missing content)
- Preserve caveman style in all untouched sections

ERRORS TO FIX:
${errorsStr}

HOW TO FIX:
- Missing URL: find it in ORIGINAL, restore it exactly where it belongs in COMPRESSED
- Code block mismatch: find the exact code block in ORIGINAL, restore it in COMPRESSED
- Heading mismatch: restore the exact heading text from ORIGINAL into COMPRESSED
- Do not touch any section not mentioned in the errors

ORIGINAL (reference only):
${original}

COMPRESSED (fix this):
${compressed}

Return ONLY the fixed compressed file. No explanation.
`;
}

// ---------- Validation ----------

const URL_REGEX = /https?:\/\/[^\s)]+/g;
const FENCE_OPEN_REGEX = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;
const HEADING_REGEX = /^(#{1,6})\s+(.*)/gm;
const BULLET_REGEX = /^\s*[-*+]\s+/gm;
const PATH_REGEX = /(?:\.\/|\.\.\/|\/|[A-Za-z]:\\)[\w\-/\\.]+|[\w\-.]+[/\\][\w\-/\\.]+/g;

/**
 * @param {string} text
 * @returns {[string, string][]}
 */
function extractHeadings(text) {
  return [...text.matchAll(HEADING_REGEX)].map((m) => /** @type {[string, string]} */ ([m[1], m[2].trim()]));
}

/**
 * Line-based, variable-length-fence, nesting-aware extractor: a closing fence
 * must use the same char, be >= the opening length, and have nothing but
 * whitespace after it on that line (CommonMark) — a shorter/inner fence line
 * with trailing content does not close the block.
 * @param {string} text
 * @returns {string[]}
 */
function extractCodeBlocks(text) {
  const blocks = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(FENCE_OPEN_REGEX);
    if (!open) { i++; continue; }
    const fenceChar = open[2][0];
    const fenceLen = open[2].length;
    const blockLines = [lines[i]];
    i++;
    let closed = false;
    while (i < lines.length) {
      const close = lines[i].match(FENCE_OPEN_REGEX);
      if (close && close[2][0] === fenceChar && close[2].length >= fenceLen && close[3].trim() === '') {
        blockLines.push(lines[i]);
        closed = true;
        i++;
        break;
      }
      blockLines.push(lines[i]);
      i++;
    }
    if (closed) blocks.push(blockLines.join('\n'));
  }
  return blocks;
}

/**
 * @param {string} text
 * @returns {Set<string>}
 */
function extractUrls(text) {
  return new Set(text.match(URL_REGEX) || []);
}

/**
 * @param {string} text
 * @returns {Set<string>}
 */
function extractPaths(text) {
  return new Set(text.match(PATH_REGEX) || []);
}

/**
 * @param {string} text
 * @returns {number}
 */
function countBullets(text) {
  return [...text.matchAll(BULLET_REGEX)].length;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractInlineCodes(text) {
  let stripped = text.replace(/^```[\s\S]*?^```/gm, '');
  stripped = stripped.replace(/^~~~[\s\S]*?^~~~/gm, '');
  return [...stripped.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

/**
 * @param {[string, string][]} a
 * @param {[string, string][]} b
 * @returns {boolean}
 */
function headingsEqual(a, b) {
  return a.length === b.length && a.every((h, i) => h[0] === b[i][0] && h[1] === b[i][1]);
}

/**
 * @param {string[]} a
 * @param {string[]} b
 * @returns {boolean}
 */
function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * @param {string} origText
 * @param {string} compText
 * @returns {{ isValid: boolean, errors: string[], warnings: string[] }}
 */
function validate(origText, compText) {
  const errors = [];
  const warnings = [];

  const h1 = extractHeadings(origText);
  const h2 = extractHeadings(compText);
  if (h1.length !== h2.length) errors.push(`Heading count mismatch: ${h1.length} vs ${h2.length}`);
  if (!headingsEqual(h1, h2)) warnings.push('Heading text/order changed');

  const c1 = extractCodeBlocks(origText);
  const c2 = extractCodeBlocks(compText);
  if (!arraysEqual(c1, c2)) errors.push('Code blocks not preserved exactly');

  const u1 = extractUrls(origText);
  const u2 = extractUrls(compText);
  if (u1.size !== u2.size || [...u1].some((u) => !u2.has(u))) {
    const lost = [...u1].filter((u) => !u2.has(u));
    const added = [...u2].filter((u) => !u1.has(u));
    errors.push(`URL mismatch: lost=${JSON.stringify(lost)}, added=${JSON.stringify(added)}`);
  }

  const p1 = extractPaths(origText);
  const p2 = extractPaths(compText);
  if (p1.size !== p2.size || [...p1].some((p) => !p2.has(p))) {
    const lost = [...p1].filter((p) => !p2.has(p));
    const added = [...p2].filter((p) => !p1.has(p));
    warnings.push(`Path mismatch: lost=${JSON.stringify(lost)}, added=${JSON.stringify(added)}`);
  }

  const b1 = countBullets(origText);
  const b2 = countBullets(compText);
  if (b1 > 0 && Math.abs(b1 - b2) / b1 > 0.15) {
    warnings.push(`Bullet count changed too much: ${b1} -> ${b2}`);
  }

  const ic1 = extractInlineCodes(origText);
  const ic2 = extractInlineCodes(compText);
  const count1 = new Map();
  for (const c of ic1) count1.set(c, (count1.get(c) || 0) + 1);
  const count2 = new Map();
  for (const c of ic2) count2.set(c, (count2.get(c) || 0) + 1);
  const sameCounts = count1.size === count2.size
    && [...count1.entries()].every(([code, n]) => count2.get(code) === n);
  if (!sameCounts) {
    const lost = [];
    for (const [code, count] of count1.entries()) {
      if (!count2.has(code)) lost.push(code);
      else if (count2.get(code) < count) lost.push(`${code} (lost ${count - count2.get(code)} of ${count} occurrences)`);
    }
    const added = [...count2.keys()].filter((c) => !count1.has(c));
    if (lost.length) errors.push(`Inline code lost: ${JSON.stringify(lost)}`);
    if (added.length) warnings.push(`Inline code added: ${JSON.stringify(added)}`);
  }

  return { isValid: errors.length === 0, errors, warnings };
}

// ---------- Core ----------

/**
 * @param {string} filepath
 * @param {string} backupRoot
 * @returns {number} process exit code
 */
function compressFile(filepath, backupRoot) {
  filepath = resolve(filepath);

  /** @type {any} */
  let stat;
  try {
    stat = statSync(filepath);
  } catch {
    console.log(`File not found: ${filepath}`);
    return 1;
  }
  if (!stat.isFile()) {
    console.log(`File not found: ${filepath}`);
    return 1;
  }
  if (stat.size > MAX_FILE_SIZE) {
    console.log(`File too large to compress safely (max 500KB): ${filepath}`);
    return 1;
  }
  if (isSensitivePath(filepath)) {
    console.log(
      `Refusing to compress ${filepath}: filename looks sensitive ` +
      '(credentials, keys, secrets, or known private paths). ' +
      'Compression sends file contents to the Anthropic API. ' +
      'Rename the file if this is a false positive.'
    );
    return 1;
  }
  if (!shouldCompress(filepath)) {
    console.log('Skipping: not a markdown file');
    return 0;
  }

  console.log(`Processing: ${filepath}`);
  const originalText = readFileSync(filepath, 'utf8');
  if (!originalText.trim()) {
    console.log('Refusing to compress: file is empty or whitespace-only.');
    return 1;
  }

  const backupPath = backupPathFor(filepath, backupRoot);
  if (existsSync(backupPath)) {
    console.log(`Backup file already exists: ${backupPath}`);
    console.log('The original backup may contain important content.');
    console.log('Aborting to prevent data loss. Remove or rename the backup file to proceed.');
    return 1;
  }

  const { frontmatter, body } = splitFrontmatter(originalText);
  if (frontmatter) {
    console.log(`Detected YAML frontmatter (${frontmatter.length} chars) — preserving verbatim`);
  }
  if (!body.trim()) {
    console.log('Refusing to compress: body is empty after frontmatter removal.');
    return 1;
  }

  console.log('Compressing with claude --print...');
  let compressedBody;
  try {
    compressedBody = callClaude(buildCompressPrompt(body));
  } catch (err) {
    const e = /** @type {any} */ (err);
    if (e.code === 'ENOENT') {
      console.log('claude CLI not found on PATH. Original file is untouched.');
    } else {
      console.log(`claude --print failed: ${e.stderr || e.message}`);
    }
    return 1;
  }

  if (!compressedBody || !compressedBody.trim()) {
    console.log('Compression aborted: claude returned an empty response.');
    console.log('Original file is untouched (no backup created).');
    return 1;
  }
  if (compressedBody.trim() === body.trim()) {
    console.log('Compression aborted: output is identical to input.');
    console.log('Original file is untouched (no backup created).');
    return 1;
  }

  // Validate + retry entirely in memory. The source file is never written
  // until a valid result exists — a crash/kill mid-loop leaves nothing to
  // restore, because nothing was ever touched.
  let compressed = frontmatter + compressedBody;
  let attempt = 1;
  let result = validate(originalText, compressed);
  console.log(`Validation attempt ${attempt}`);

  while (!result.isValid && attempt < MAX_RETRIES) {
    console.log('Validation failed:');
    for (const e of result.errors) console.log(`   - ${e}`);
    console.log('Fixing with claude --print...');
    let fixed;
    try {
      fixed = callClaude(buildFixPrompt(originalText, compressed, result.errors));
    } catch (err) {
      const e = /** @type {any} */ (err);
      console.log(`claude --print failed during fix: ${e.stderr || e.message}`);
      console.log('Original file is untouched (no backup created).');
      return 2;
    }
    // Re-pin the ORIGINAL frontmatter: the fix prompt sends the full file
    // (frontmatter included) and asks the model to leave everything else
    // as-is, but a second LLM pass over YAML frontmatter is not a guarantee
    // — re-split the fix response and keep only its body.
    compressed = frontmatter + splitFrontmatter(fixed).body;
    attempt++;
    console.log(`Validation attempt ${attempt}`);
    result = validate(originalText, compressed);
  }

  if (!result.isValid) {
    console.log('Validation failed:');
    for (const e of result.errors) console.log(`   - ${e}`);
    console.log('Failed after retries — original untouched (no backup created)');
    return 2;
  }

  console.log('Validation passed');
  if (result.warnings.length) {
    console.log('Warnings (non-blocking):');
    for (const w of result.warnings) console.log(`   - ${w}`);
  }

  const finalContent = originalText.endsWith('\n') && !compressed.endsWith('\n')
    ? compressed + '\n'
    : compressed;

  mkdirSync(dirname(backupPath), { recursive: true });
  writeFileSync(backupPath, originalText);
  const backupReadback = readFileSync(backupPath, 'utf8');
  if (backupReadback !== originalText) {
    console.log(`Backup write verification failed: ${backupPath}`);
    console.log('In-memory original differs from on-disk backup. Aborting before touching the input file.');
    try { unlinkSync(backupPath); } catch { /* best-effort cleanup */ }
    return 1;
  }
  writeFileSync(filepath, finalContent);
  console.log(`Compressed: ${filepath}`);
  console.log(`Original:   ${backupPath}`);
  return 0;
}

// ---------- CLI ----------

function main() {
  const [, , filepath, backupRoot] = process.argv;
  if (!filepath || !backupRoot) {
    console.log('Usage: compress.mjs <filepath> <backup-root-dir>');
    process.exit(1);
  }
  try {
    process.exit(compressFile(filepath, backupRoot));
  } catch (err) {
    const e = /** @type {any} */ (err);
    console.log(`Error: ${e.message}`);
    process.exit(1);
  }
}

main();
