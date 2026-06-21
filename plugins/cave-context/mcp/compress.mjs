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
// NOTE: greedy match — over-strips a doc whose first AND last top-level lines are both fences
// (treats them as one wrapper); fails safe: validate() then catches missing blocks → retries → valid:false.
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

// PATH augmentation mirrors bin/bnx.sh — non-interactive spawns often miss these.
function augmentedPath() {
  const home = process.env.HOME;
  const extra = home ? `${home}/.local/bin:${home}/.bun/bin` : "";
  return extra ? `${extra}:${process.env.PATH ?? ""}` : (process.env.PATH ?? "");
}

export function callClaude(prompt, opts = {}) {
  const bin = opts.bin ?? process.env.CAVE_COMPRESS_CLAUDE_BIN ?? "claude";
  const model = opts.model ?? process.env.CAVE_COMPRESS_MODEL;
  const timeoutMs = opts.timeoutMs ?? (Number(process.env.CAVE_COMPRESS_TIMEOUT_MS) || 120000);
  // Isolation: --strict-mcp-config (no MCP servers → no cave-context recursion),
  // --setting-sources project from a config-less tmpdir cwd (no user plugins/hooks),
  // text output, no session persistence.
  const args = ["--print", "--output-format", "text", "--strict-mcp-config",
    "--no-session-persistence", "--setting-sources", "project"];
  if (model) args.push("--model", model);
  const env = { ...process.env, ...(opts.env || {}), PATH: augmentedPath() };
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: tmpdir(), env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`claude timed out after ${timeoutMs}ms`)); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });        // ENOENT, etc.
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`claude exited ${code}: ${err.trim().slice(0, 300)}`));
    });
    // A broken pipe (claude exits before draining a >64KB prompt) emits an async
    // EPIPE on stdin outside the Promise path — swallow it so it can't crash the
    // server; the close/error handlers still produce the real verdict.
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}

function fail(compressed, reason, errors = []) {
  return { compressed, changed: false, valid: false, errors, reason };
}

export async function compressText(text, opts = {}) {
  if (typeof text !== "string" || !text.trim()) return fail(typeof text === "string" ? text : "", "empty or whitespace-only input");
  if (Buffer.byteLength(text, "utf8") > MAX_INPUT_BYTES) return fail(text, `input too large (max ${MAX_INPUT_BYTES} bytes)`);

  const { frontmatter, body } = splitFrontmatter(text);
  if (!body.trim()) return fail(text, "body empty after frontmatter removal");

  const endsWithNewline = text.endsWith("\n");
  const ensureNl = (s) => endsWithNewline && !s.endsWith("\n") ? s + "\n" : s;

  let compressedBody;
  try { compressedBody = stripLlmWrapper((await callClaude(buildCompressPrompt(body), opts)).trim()); }
  catch (e) { return fail(text, String(e?.message ?? e)); }
  if (!compressedBody) return fail(text, "model returned empty output");
  if (compressedBody.trim() === body.trim()) return { compressed: ensureNl(frontmatter + compressedBody), changed: false, valid: true, errors: [] };

  let compressed = frontmatter + compressedBody;
  let result = validate(text, compressed);
  for (let attempt = 0; !result.valid && attempt < MAX_RETRIES; attempt++) {
    let fixed;
    try { fixed = stripLlmWrapper((await callClaude(buildFixPrompt(text, compressed, result.errors), opts)).trim()); }
    catch (e) { return fail(text, String(e?.message ?? e), result.errors); }
    if (!fixed) break;
    compressed = fixed;                 // fix prompt operates on the FULL file (frontmatter included)
    result = validate(text, compressed);
  }
  if (!result.valid) return fail(text, "validation failed after retries", result.errors);
  return { compressed: ensureNl(compressed), changed: true, valid: true, errors: [] };
}
