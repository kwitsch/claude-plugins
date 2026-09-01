// mcp/binary-fetch.mjs — linux-token-efficiency: shared download/verify/extract helpers.
// Imported, never executed: no shebang (mode 100644), no main(), no process.exit. Used by
// both mcp/server.mjs (cbm) and hooks/rtk-install.mjs (rtk). Both share one discipline:
// fetch the release's checksums.txt (parseExpectedSha/fetchExpectedSha, exactly-one-entry
// or fail closed), download the tarball while streaming its sha256 (downloadToFile), and
// compare the two. The single verified tarball is trusted; the extracted binary is not
// re-hashed. Each consumer owns its own asset name and target path.
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

/**
 * Parse a goreleaser-style checksums.txt body and return the single expected sha256 for
 * `assetName`. Throws (fails closed) on 0 or >1 matching lines or a malformed hash — the
 * exactly-one-entry rule the maintainer scripts enforce with awk. Handles sha256sum's
 * optional "*" binary-mode prefix on the filename field. Splits each line on a whitespace
 * run (awk's default field split), NOT a fixed two-space split.
 * @param {string} text
 * @param {string} assetName
 * @returns {string}
 */
export function parseExpectedSha(text, assetName) {
  /** @type {string[]} */
  const matches = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const hash = parts[0];
    const name = parts[1];
    if (name === assetName || name === "*" + assetName) matches.push(hash);
  }
  if (matches.length !== 1) {
    throw new Error(`checksums.txt must list exactly one entry for ${assetName}, found ${matches.length}`);
  }
  const hash = matches[0];
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error(`checksums.txt hash for ${assetName} is malformed`);
  }
  return hash;
}

/**
 * Fetch a goreleaser-style checksums.txt and return the single expected sha256 for
 * `assetName`. Thin fetch + delegate to parseExpectedSha; throws on a non-OK response. No
 * extra headers — the download host is a CDN, not api.github.com.
 * @param {string} url
 * @param {string} assetName
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
export async function fetchExpectedSha(url, assetName, timeoutMs) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`checksums fetch failed (${response.status}): ${url}`);
  return parseExpectedSha(await response.text(), assetName);
}
