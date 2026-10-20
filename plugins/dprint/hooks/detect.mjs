#!/usr/bin/env node
// Pure logic for the dprint mods module (register.ts). Zero-dep, no `$`.

/**
 * Whether a `userConfig` toggle value enables its feature. Fail-open: only a
 * literal `false` (boolean, or the string "false") disables; unset, empty or an
 * uninterpolated `${user_config.…}` placeholder stays enabled.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isEnabled(value) {
  return value !== false && value !== "false";
}

/**
 * dprint config candidates relative to the session cwd, checked in this order
 * (cwd first, then its `.config/` subdirectory).
 * @type {string[]}
 */
export const CONFIG_PATHS = ["dprint.json", "dprint.jsonc", ".dprint.json", ".dprint.jsonc", ".config/dprint.json", ".config/dprint.jsonc", ".config/.dprint.json", ".config/.dprint.jsonc"];

/**
 * Where an installed dprint binary may live, in check-dprint.mjs `findDprint`
 * order: `<dir>/dprint` for each non-empty PATH entry, then `~/.dprint/bin/dprint`.
 * @param {string | undefined} pathEnv the session's PATH
 * @param {string | undefined} home the session's HOME
 * @returns {string[]}
 */
export function dprintCandidates(pathEnv, home) {
  // shortcut: POSIX ":" separator only (Linux/macOS/WSL, as check-dprint.mjs); upgrade if native Windows is supported.
  const candidates = (pathEnv ?? "")
    .split(":")
    .filter((dir) => dir !== "")
    .map((dir) => `${dir}/dprint`);
  if (typeof home === "string" && home !== "") candidates.push(`${home}/.dprint/bin/dprint`);
  return candidates;
}

/**
 * The toast text for a found config with no dprint binary. Never names the
 * plugin: the engine already shows the toast under the plugin's name.
 * @param {string} configPath the config path relative to the session cwd
 * @returns {string}
 */
export function missingDprintWarning(configPath) {
  return `${configPath} found but dprint is not installed. Run /dprint:init-dprint to install it.`;
}
