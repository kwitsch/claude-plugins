#!/usr/bin/env node
// universal-format skill driver: apply the plugin's on-write formatting to a
// list of files, reusing the plugin's own MCP-server handlers verbatim — no new
// formatting logic. Reads a newline-delimited list file (argv[2]); each line is
// one path, resolved against process.cwd(). Prettier languages: read content,
// call formatPre (Write), persist the returned updatedInput.content. CLI
// languages (Kotlin/Python/Go/Rust): call formatPost, which reformats the file
// on disk itself. Fail-open per file; always exits 0 — the printed summary is
// the signal, not the exit code.
//
// server.mjs is a committed `// @ts-nocheck` bundle, so its exports are
// untyped; the namespace is cast to any so this file typechecks under
// checkJs+strict without touching (or re-typing) the bundle.

import { readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import process from "node:process";
import * as formatServer from "../../mcp/server.mjs";

const { formatPre, formatPost, EXT_MAP, PRETTIER_LANGS } = /** @type {any} */ (formatServer);

const listFile = process.argv[2];
if (!listFile) {
  console.error("usage: format-files.mjs <listfile>");
  process.exit(2);
}

const cwd = process.cwd();
const paths = String(readFileSync(listFile, "utf8"))
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

let formatted = 0;
let unchanged = 0;
let skipped = 0;
/** @type {string[]} */
const lines = [];

for (const p of paths) {
  const resolved = resolve(cwd, p);
  const lang = EXT_MAP[extname(resolved).toLowerCase()];
  if (!lang) {
    skipped++;
    lines.push(`skipped (unsupported): ${p}`);
    continue;
  }
  try {
    if (PRETTIER_LANGS.has(lang)) {
      const content = readFileSync(resolved, "utf8");
      const pre = /** @type {any} */ (
        await formatPre({
          cwd,
          tool_name: "Write",
          tool_input: { file_path: resolved, content },
        })
      );
      const next = pre?.hookSpecificOutput?.updatedInput?.content;
      if (typeof next === "string" && next !== content) {
        writeFileSync(resolved, next);
        formatted++;
        lines.push(`formatted: ${p}`);
      } else {
        unchanged++;
        lines.push(`unchanged: ${p}`);
      }
    } else {
      const post = /** @type {any} */ (
        await formatPost({
          cwd,
          tool_input: { file_path: resolved },
          tool_response: { success: true },
        })
      );
      if (post?.hookSpecificOutput) {
        formatted++;
        lines.push(`formatted: ${p}`);
      } else {
        unchanged++;
        lines.push(`unchanged: ${p}`);
      }
    }
  } catch (err) {
    skipped++;
    lines.push(`skipped (error: ${err instanceof Error ? err.message : String(err)}): ${p}`);
  }
}

for (const line of lines) console.log(line);
console.log(`universal-format: ${formatted} formatted, ${unchanged} unchanged, ${skipped} skipped (${paths.length} total)`);
process.exit(0);
