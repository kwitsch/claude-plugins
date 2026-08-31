#!/usr/bin/env node
// hooks/rtk-install.mjs — linux-token-efficiency: SessionStart rtk installer.
//
// Async, side-effect-only SessionStart command hook. Reads the committed pin and, ONLY when
// ${HOME}/.local/bin/rtk is absent, downloads the pinned asset, verifies assetSha256, extracts,
// verifies binarySha256, and atomically renames the binary into ${HOME}/.local/bin/rtk.
// Idempotent (present => no-op, never overwrites), fail-open (every failure logs one stderr
// line and the process exits 0), one bounded download attempt. A trimmed adaptation of
// mcp/server.mjs's readPin()/downloadToFile()/hashFile()/findBinaries()/prepareBinary(),
// retargeted from the hash-suffixed private cache to the fixed ${HOME}/.local/bin/rtk. It NEVER
// downloads inside the synchronous PreToolUse hook — that is rtk-rewrite.mjs's read-only concern.
import process from "node:process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { hashFile, downloadToFile, findBinaries } from "../mcp/binary-fetch.mjs";
import { usablePath } from "../mcp/cbm-context.mjs";

const BINARY_NAME = "rtk";
/** Identical name, shape and default as update-rtk-bundle.sh's RTK_DOWNLOAD_BASE_URL; joined as
 *  `${base}/${releaseTag}/${asset}`. Overridable via RTK_DOWNLOAD_BASE_URL (test fixtures). */
const DEFAULT_DOWNLOAD_BASE_URL = "https://github.com/rtk-ai/rtk/releases/download";
/** One bounded download attempt per SessionStart process. Kept well under hooks.json's
 *  `timeout: 20` for this hook (the harness kills the whole detached process at that wall
 *  clock regardless of this signal) so a slow-but-not-hung download aborts itself in time for
 *  the `finally` cleanup below to run, instead of being hard-killed mid-write and leaving an
 *  orphaned `.rtk-install.*` scratch dir under ~/.local/bin every session. */
const DOWNLOAD_TIMEOUT_MS = 12000;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

/** @param {string} message @returns {void} */
function log(message) {
  process.stderr.write(`[rtk-install] ${message}\n`);
}

/** @param {any} error @returns {string} */
function describe(error) {
  return String(error && error.message ? error.message : error);
}

/**
 * The user's home directory: HOME when usable, else os.homedir(), else null. Uses
 * cbm-context.mjs's usablePath so this and rtk-rewrite.mjs's resolveManagedRtk agree on what
 * counts as a usable home value.
 * @param {Record<string, string|undefined>} env
 * @returns {string|null}
 */
function resolveHome(env) {
  if (usablePath(env.HOME)) return String(env.HOME).trim();
  try {
    const h = os.homedir();
    if (usablePath(h)) return h;
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * The machine-owned version pin. Exactly one binaries[] entry is required; the installer reads
 * releaseTag/asset/assetSha256/binarySha256 and ignores any legacy `path`. Any defect => null.
 * @returns {{releaseTag: string, asset: string, assetSha256: string, binarySha256: string}|null}
 */
function readPin() {
  const file = path.join(SCRIPT_DIR, "..", "rtk-bundle.json");
  /** @type {any} */
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    log(`unusable rtk-bundle.json (${file}): ${describe(e)}`);
    return null;
  }
  const binaries = Array.isArray(parsed?.binaries) ? parsed.binaries : [];
  if (binaries.length !== 1) {
    log(`rtk-bundle.json must list exactly one binaries[] entry, found ${binaries.length}`);
    return null;
  }
  const entry = binaries[0] ?? {};
  const pin = {
    releaseTag: typeof parsed?.releaseTag === "string" ? parsed.releaseTag : "",
    asset: typeof entry.asset === "string" ? entry.asset : "",
    assetSha256: typeof entry.assetSha256 === "string" ? entry.assetSha256 : "",
    binarySha256: typeof entry.binarySha256 === "string" ? entry.binarySha256 : "",
  };
  if (pin.releaseTag === "" || pin.asset === "" || !/^[0-9a-f]{64}$/.test(pin.assetSha256) || !/^[0-9a-f]{64}$/.test(pin.binarySha256)) {
    log("rtk-bundle.json is missing releaseTag/asset/assetSha256/binarySha256");
    return null;
  }
  return pin;
}

/** @returns {Promise<void>} */
async function main() {
  try {
    // 1. Platform guard first, before any pin/network I/O.
    if (os.platform() !== "linux" || os.arch() !== "x64") return;
    // 2. Toggle gate (fail-open: only the trimmed literal "false" disables).
    if (String(process.env.CLAUDE_PLUGIN_OPTION_RTK_ENABLED ?? "").trim() === "false") return;
    // 3. Resolve ${HOME}/.local/bin.
    const home = resolveHome(process.env);
    if (home === null) return;
    const homeLocalBin = path.join(home, ".local", "bin");
    const target = path.join(homeLocalBin, "rtk");
    // 4. Idempotency: a regular file, or a symlink that still resolves, counts as installed
    //    and is left untouched (never clobber a user's own rtk). A dangling/broken symlink
    //    (e.g. left behind by an uninstalled tool) is cleared so the installer can actually
    //    place a working binary instead of skipping forever.
    try {
      const dirent = lstatSync(target);
      if (dirent.isSymbolicLink()) {
        try {
          statSync(target); // follows the symlink; throws ENOENT when the target is gone
          return; // valid symlink — leave the user's own install alone
        } catch {
          rmSync(target, { force: true }); // dangling — clear it and fall through to install
        }
      } else {
        return;
      }
    } catch {
      /* absent — proceed */
    }
    // 5. Read + validate the pin.
    const pin = readPin();
    if (pin === null) return;
    // 6. Install atomically, temp dir on the SAME filesystem as the target.
    mkdirSync(homeLocalBin, { recursive: true });
    const tmp = mkdtempSync(path.join(homeLocalBin, ".rtk-install."));
    try {
      const base = process.env.RTK_DOWNLOAD_BASE_URL || DEFAULT_DOWNLOAD_BASE_URL;
      const url = `${base}/${pin.releaseTag}/${pin.asset}`;
      const archive = path.join(tmp, pin.asset);
      log(`fetching ${url}`);
      const assetSha = await downloadToFile(url, archive, DOWNLOAD_TIMEOUT_MS);
      if (assetSha !== pin.assetSha256) {
        log(`asset sha256 mismatch for ${pin.asset}; refusing to extract`);
        return;
      }
      try {
        execFileSync("tar", ["-xzf", archive, "-C", tmp], { stdio: "ignore" });
      } catch (e) {
        log(`failed to extract ${pin.asset}: ${describe(e)}`);
        return;
      }
      const found = findBinaries(tmp, BINARY_NAME);
      if (found.length !== 1) {
        log(`expected exactly one ${BINARY_NAME} inside ${pin.asset}, found ${found.length}`);
        return;
      }
      chmodSync(found[0], 0o755);
      if ((await hashFile(found[0])) !== pin.binarySha256) {
        log("extracted binary does not match the pin; nothing installed");
        return;
      }
      try {
        renameSync(found[0], target); // atomic within ~/.local/bin; a lost race is benign
      } catch (e) {
        log(`could not place rtk at ${target}: ${describe(e)}`);
        return;
      }
      log(`installed ${target}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } catch (e) {
    log(`install failed: ${describe(e)}`);
  }
}

main().catch(() => {});
