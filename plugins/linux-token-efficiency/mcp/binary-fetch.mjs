// mcp/binary-fetch.mjs — linux-token-efficiency: shared download/verify/extract helpers.
// Imported, never executed: no shebang (mode 100644), no main(), no process.exit. Used by
// both mcp/server.mjs (cbm) and hooks/rtk-install.mjs (rtk) — the two consumers share the
// identical download-then-verify discipline (sha256 the stream while writing it, then
// sha256 the extracted binary) but each owns its own pin shape, binary name and target path.
import path from "node:path";
import { createReadStream, createWriteStream, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** @param {string} file @returns {Promise<string>} */
export async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * Streams `url` to `dest`, hashing as it writes. Bounded by `timeoutMs` — the caller picks
 * the budget (a long-lived MCP server process can afford minutes; a hook killed by
 * hooks.json's own timeout cannot).
 * @param {string} url
 * @param {string} dest
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
export async function downloadToFile(url, dest, timeoutMs) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok || response.body === null) throw new Error(`download failed (${response.status}): ${url}`);
  const hash = createHash("sha256");
  await pipeline(
    Readable.fromWeb(response.body),
    async function* (/** @type {any} */ source) {
      for await (const chunk of source) {
        hash.update(chunk);
        yield chunk;
      }
    },
    createWriteStream(dest),
  );
  return hash.digest("hex");
}

/**
 * Every file named `binaryName` under `dir` — an archive may also ship extras (install.sh,
 * LICENSE, …), and the caller decides how to react to 0 or >1 matches.
 * @param {string} dir
 * @param {string} binaryName
 * @returns {string[]}
 */
export function findBinaries(dir, binaryName) {
  /** @type {string[]} */
  const found = [];
  /** @param {string} current @returns {void} */
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name === binaryName) found.push(full);
    }
  };
  walk(dir);
  return found;
}
