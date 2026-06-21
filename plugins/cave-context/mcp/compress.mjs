// mcp/compress.mjs — caveman file-compression engine behind the `compress` tool.
// Faithful port of upstream caveman-compress (compress.py + validate.py, MIT,
// JuliusBrussee/caveman): split frontmatter, model-compress the body via the
// `claude` CLI, strip any wrapper fence, reassemble, validate verbatim regions,
// cherry-pick-fix retries. No filesystem access (the cave-compress skill owns
// file I/O); no Anthropic SDK (`claude --print` covers both auth modes).
import process from "node:process";
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { tmpdir } from "node:os";

export const MAX_INPUT_BYTES = 500000; // upstream MAX_FILE_SIZE — refuse beyond
export const MAX_RETRIES = 2;          // upstream cherry-pick-fix budget

const FRONTMATTER_RE = /^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]*)$/;
const OUTER_FENCE_RE = /^\s*(`{3,}|~{3,})[^\n]*\n([\s\S]*)\n\1\s*$/;
const URL_RE = /https?:\/\/[^\s)]+/g;
const HEADING_RE = /^#{1,6}[ \t]+\S.*$/gm;

export function splitFrontmatter(text) {
  const m = FRONTMATTER_RE.exec(text);
  return m ? { frontmatter: m[1], body: m[2] } : { frontmatter: "", body: text };
}

export function stripLlmWrapper(text) {
  const m = OUTER_FENCE_RE.exec(text);
  return m ? m[2] : text;
}

// Extract fenced code blocks (``` or ~~~) as verbatim strings, fence lines included.
function extractFencedBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  let openChar = null, buf = [];
  for (const line of lines) {
    const open = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
    if (!openChar && open) { openChar = open[1][0]; buf = [line]; continue; }
    if (openChar) {
      buf.push(line);
      const close = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === openChar) { blocks.push(buf.join("\n")); openChar = null; }
    }
  }
  return blocks;
}

export function validate(original, compressed) {
  const errors = [];
  for (const u of new Set(original.match(URL_RE) || [])) {
    if (!compressed.includes(u)) errors.push(`Missing URL: ${u}`);
  }
  for (const block of extractFencedBlocks(original)) {
    if (!compressed.includes(block)) {
      errors.push(`Altered/missing code block (starts: ${block.split("\n")[0]})`);
    }
  }
  for (const h of original.match(HEADING_RE) || []) {
    if (!compressed.includes(h)) errors.push(`Missing heading: ${h}`);
  }
  return { valid: errors.length === 0, errors };
}

export function buildCompressPrompt(body) {
  return `Compress the markdown below into caveman terse-encoding. Cut prose tokens; keep every fact.

RULES:
- Drop articles (a/an/the), filler (just/really/basically/simply/actually), hedging, pleasantries, and aux verbs where a fragment works. Fragments are fine. Prefer short synonyms.
- PRESERVE VERBATIM — never modify: fenced & inline code, URLs and links, file paths, identifiers, commands, numbers, versions, quoted strings, error messages.
- PRESERVE STRUCTURE — keep every markdown heading exactly, list nesting, tables, and link targets. Compress only the text within the structure.
- If cutting a word loses a fact, keep it. Compression, not amputation.

Do NOT wrap the whole output in a \`\`\`markdown fence or any other outer fence. Inner code blocks stay exactly as-is. Return ONLY the compressed markdown body.

TEXT:
${body}`;
}

export function buildFixPrompt(original, compressed, errors) {
  const list = errors.map((e) => `- ${e}`).join("\n");
  return `You are fixing a caveman-compressed markdown file. Validation found specific errors.

RULES:
- Do NOT recompress or rephrase. ONLY fix the listed errors; leave everything else exactly as-is.
- The ORIGINAL is reference only — use it to restore missing URLs, code blocks, and headings into the COMPRESSED file at the right place.

ERRORS TO FIX:
${list}

ORIGINAL (reference only):
${original}

COMPRESSED (fix this):
${compressed}

Return ONLY the fixed compressed file. No explanation, no outer fence.`;
}
