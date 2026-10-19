// Pure logic for the auto-dream mod (hooks/register.ts). Zero-dep, no `$`:
// register.ts does every store, file system and session read.

/**
 * Fail-open: only `false` (the userConfig boolean) or the literal string
 * "false" disables. The nudge creates no state, so an unset value is enabled.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isAutoDreamEnabled(value) {
  return value !== false && value !== "false";
}

export const NUDGE =
  "A memory dream cycle is due for this project. Run one now: " +
  "orient (locate the memory directory from this session's own auto-memory " +
  "system-prompt block), gather signal (targeted grep over the most recent " +
  "main-session transcripts for corrections/preferences/decisions), " +
  "consolidate (merge duplicate memories, drop stale entries, resolve " +
  "contradictions, author a new memory file for any signal with no " +
  "existing memory home, back up each changed file alongside itself " +
  "before writing, compress new/changed non-MEMORY.md detail files via " +
  "cc-compress when available), then update the MEMORY.md index (keep it " +
  "under 200 lines / 25KB). Only touch files that actually need a change.";

/**
 * The project's `$.store` key: `dream-due:` plus the first 8 hex chars of
 * sha256 over the project dir's realpath (the 0.4.x flag file's hash).
 * @param {string} realProjectDir
 * @returns {Promise<string>}
 */
export async function dueKey(realProjectDir) {
  // Web Crypto globals (node, bun and the mods worker all have them); the root tsconfig's lib is ES2022 only.
  /** @type {{ crypto: { subtle: { digest(alg: string, data: Uint8Array): Promise<ArrayBuffer> } }, TextEncoder: new () => { encode(s: string): Uint8Array } }} */
  const web = /** @type {any} */ (globalThis);
  const digest = await web.crypto.subtle.digest("SHA-256", new web.TextEncoder().encode(realProjectDir));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `dream-due:${hex.slice(0, 8)}`;
}
