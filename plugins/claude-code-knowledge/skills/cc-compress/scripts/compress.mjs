#!/usr/bin/env node
// Compress a markdown file into caveman-style prose via a one-shot
// `claude --print` call, validate the result, retry with a targeted fix up to
// twice, and back up the original outside the source directory (the caller —
// the cc-compress SKILL.md — passes the backup root; usually the invoking
// session's temp/scratchpad dir).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, resolve, sep } from 'node:path';

const MAX_RETRIES = 2;
const MAX_FILE_SIZE = 500_000; // 500KB

// ---------- Frontmatter / fence helpers ----------
// JS has no \A/\Z: `^`/`$` without the `m` flag already anchor to the whole
// string, which is the equivalent. `re.DOTALL` maps to the `s` flag.

const FRONTMATTER_REGEX = /^(---\r?\n.*?\r?\n---\r?\n)(.*)$/s;
const OUTER_FENCE_REGEX = /^\s*(`{3,}|~{3,})[^\n]*\n(.*)\n\1\s*$/s;

function splitFrontmatter(text) {
  const m = text.match(FRONTMATTER_REGEX);
  if (m) return { frontmatter: m[1], body: m[2] };
  return { frontmatter: '', body: text };
}

function stripLlmWrapper(text) {
  const m = text.match(OUTER_FENCE_REGEX);
  return m ? m[2] : text;
}

// ---------- Sensitive-path denylist ----------
// Refuses before any content reaches the `claude` subprocess — the guard
// against shipping secrets/keys to a third-party API call.

const SENSITIVE_BASENAME_REGEX = /^(\.env(\..+)?|\.netrc|credentials(\..+)?|secrets?(\..+)?|passwords?(\..+)?|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|authorized_keys|known_hosts|.*\.(pem|key|p12|pfx|crt|cer|jks|keystore|asc|gpg))$/i;
const SENSITIVE_PATH_COMPONENTS = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.docker']);
const SENSITIVE_NAME_TOKENS = ['secret', 'credential', 'password', 'passwd', 'apikey', 'accesskey', 'token', 'privatekey'];

function isSensitivePath(filepath) {
  const name = basename(filepath);
  if (SENSITIVE_BASENAME_REGEX.test(name)) return true;
  const parts = filepath.split(sep).map((p) => p.toLowerCase());
  if (parts.some((p) => SENSITIVE_PATH_COMPONENTS.has(p))) return true;
  const lowered = name.toLowerCase().replace(/[_\-\s.]/g, '');
  return SENSITIVE_NAME_TOKENS.some((tok) => lowered.includes(tok));
}

// ---------- Detection (markdown-only) ----------

function shouldCompress(filepath) {
  if (basename(filepath).toLowerCase().endsWith('.original.md')) return false;
  return extname(filepath).toLowerCase() === '.md';
}

// ---------- Backup path ----------
// Mirrors the source's parent-dir name under the backup root to reduce
// cross-project collisions (two `notes.md` files from different repos).

function backupPathFor(filepath, backupRoot) {
  const parentName = basename(dirname(filepath));
  const stem = basename(filepath, extname(filepath));
  return resolve(backupRoot, parentName, `${stem}.original.md`);
}

// ---------- claude CLI call ----------

function callClaude(prompt) {
  const result = execFileSync('claude', ['--print', '--model', 'sonnet'], {
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return stripLlmWrapper(result.trim());
}

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

function extractHeadings(text) {
  return [...text.matchAll(HEADING_REGEX)].map((m) => [m[1], m[2].trim()]);
}

function extractCodeBlocks(text) {
  // Line-based, variable-length-fence, nesting-aware extractor: a closing
  // fence must use the same char, be >= the opening length, and have nothing
  // but whitespace after it on that line (CommonMark) — a shorter/inner fence
  // line with trailing content does not close the block.
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

function extractUrls(text) {
  return new Set(text.match(URL_REGEX) || []);
}

function extractPaths(text) {
  return new Set(text.match(PATH_REGEX) || []);
}

function countBullets(text) {
  return [...text.matchAll(BULLET_REGEX)].length;
}

function extractInlineCodes(text) {
  let stripped = text.replace(/^```[\s\S]*?^```/gm, '');
  stripped = stripped.replace(/^~~~[\s\S]*?^~~~/gm, '');
  return [...stripped.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

function validate(origText, compText) {
  const errors = [];
  const warnings = [];

  const h1 = extractHeadings(origText);
  const h2 = extractHeadings(compText);
  if (h1.length !== h2.length) errors.push(`Heading count mismatch: ${h1.length} vs ${h2.length}`);
  if (JSON.stringify(h1) !== JSON.stringify(h2)) warnings.push('Heading text/order changed');

  const c1 = extractCodeBlocks(origText);
  const c2 = extractCodeBlocks(compText);
  if (JSON.stringify(c1) !== JSON.stringify(c2)) errors.push('Code blocks not preserved exactly');

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

function compressFile(filepath, backupRoot) {
  filepath = resolve(filepath);

  if (!existsSync(filepath) || !statSync(filepath).isFile()) {
    console.log(`File not found: ${filepath}`);
    return 1;
  }
  if (statSync(filepath).size > MAX_FILE_SIZE) {
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
  mkdirSync(dirname(backupPath), { recursive: true });
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
    if (err.code === 'ENOENT') {
      console.log('claude CLI not found on PATH. Original file is untouched.');
    } else {
      console.log(`claude --print failed: ${err.stderr || err.message}`);
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

  let compressed = frontmatter + compressedBody;

  writeFileSync(backupPath, originalText);
  const backupReadback = readFileSync(backupPath, 'utf8');
  if (backupReadback !== originalText) {
    console.log(`Backup write verification failed: ${backupPath}`);
    console.log('In-memory original differs from on-disk backup. Aborting before touching the input file.');
    try { unlinkSync(backupPath); } catch { /* best-effort cleanup */ }
    return 1;
  }
  writeFileSync(filepath, compressed);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    console.log(`Validation attempt ${attempt + 1}`);
    const result = validate(originalText, compressed);
    if (result.isValid) {
      console.log('Validation passed');
      console.log(`Compressed: ${filepath}`);
      console.log(`Original:   ${backupPath}`);
      return 0;
    }
    console.log('Validation failed:');
    for (const e of result.errors) console.log(`   - ${e}`);

    if (attempt === MAX_RETRIES - 1) {
      writeFileSync(filepath, originalText);
      try { unlinkSync(backupPath); } catch { /* best-effort cleanup */ }
      console.log('Failed after retries — original restored');
      return 2;
    }

    console.log('Fixing with claude --print...');
    try {
      compressed = callClaude(buildFixPrompt(originalText, compressed, result.errors));
    } catch (err) {
      console.log(`claude --print failed during fix: ${err.stderr || err.message}`);
      writeFileSync(filepath, originalText);
      try { unlinkSync(backupPath); } catch { /* best-effort cleanup */ }
      return 2;
    }
    writeFileSync(filepath, compressed);
  }

  return 2;
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
    console.log(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
