#!/usr/bin/env node
// hooks/rtk-install.mjs — linux-token-efficiency: SessionStart rtk installer.
//
// Async, side-effect-only SessionStart command hook. ONLY when ${HOME}/.local/bin/rtk is
// absent, it fetches the release's checksums.txt and the tarball asset in parallel from the
// releases/latest/download/ redirect alias, verifies the tarball's sha256 against the
// checksums entry, extracts it, and atomically renames the binary into ${HOME}/.local/bin/rtk.
// Idempotent (present => no-op, never overwrites), fail-open (every failure logs one stderr
// line and the process exits 0), one bounded download attempt. Shares
// downloadToFile()/findBinaries()/fetchExpectedSha() with mcp/server.mjs's cbm provisioning.
// It NEVER downloads inside the synchronous PreToolUse hook — that is rtk-rewrite.mjs's concern.
import process from "node:process";
import os from "node:os";
import path from "node:path";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { downloadToFile, findBinaries, fetchExpectedSha } from "../mcp/binary-fetch.mjs";
import { usablePath } from "../mcp/cbm-context.mjs";

const BINARY_NAME = "rtk";
const RTK_ASSET = "rtk-x86_64-unknown-linux-musl.tar.gz";
/** The stable per-repo alias GitHub 302-redirects to the newest release's assets;
 *  `${base}/${asset}` and `${base}/checksums.txt` both resolve there. `fetch` follows
 *  redirects, so there is no separate tag-resolution step, no GitHub API call, no rate
 *  limit. Overridable via RTK_DOWNLOAD_BASE_URL (test fixtures point it at 127.0.0.1). */
const DEFAULT_DOWNLOAD_BASE_URL = "https://github.com/rtk-ai/rtk/releases/latest/download";
/** One bounded attempt per SessionStart process, kept well under hooks.json's timeout: 20 so
 *  the finally cleanup runs before a hard kill instead of leaving an orphaned scratch dir. */
const DOWNLOAD_TIMEOUT_MS = 12000;

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

/** @returns {Promise<void>} */
async function main() {
  try {
    // 1. Platform guard first, before any network I/O.
    if (os.platform() !== "linux" || os.arch() !== "x64") return;
    // 2. Toggle gate (fail-open: only the trimmed literal "false" disables).
    if (String(process.env.CLAUDE_PLUGIN_OPTION_RTK_ENABLED ?? "").trim() === "false") return;
    // 3. Resolve ${HOME}/.local/bin.
    const home = resolveHome(process.env);
    if (home === null) return;
    const homeLocalBin = path.join(home, ".local", "bin");
    const target = path.join(homeLocalBin, "rtk");
    // 4. Idempotency: a regular file, or a symlink that still resolves, is left untouched
    //    (never clobber a user's own rtk). A dangling symlink is cleared so a stale leftover
    //    cannot wedge the installer forever.
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
    // 5. Install atomically, temp dir on the SAME filesystem as the target.
    mkdirSync(homeLocalBin, { recursive: true });
    const tmp = mkdtempSync(path.join(homeLocalBin, ".rtk-install."));
    try {
      const base = process.env.RTK_DOWNLOAD_BASE_URL || DEFAULT_DOWNLOAD_BASE_URL;
      const archive = path.join(tmp, RTK_ASSET);
      log(`fetching ${base}/${RTK_ASSET}`);
      // checksums and asset in parallel — the alias IS the download URL, so no extra hop.
      const [expectedSha, actualSha] = await Promise.all([
        fetchExpectedSha(`${base}/checksums.txt`, RTK_ASSET, DOWNLOAD_TIMEOUT_MS),
        downloadToFile(`${base}/${RTK_ASSET}`, archive, DOWNLOAD_TIMEOUT_MS),
      ]);
      if (actualSha !== expectedSha) {
        log("asset sha256 mismatch; refusing to extract");
        return;
      }
      try {
        execFileSync("tar", ["-xzf", archive, "-C", tmp], {
          stdio: "ignore",
        });
      } catch (e) {
        log(`failed to extract ${RTK_ASSET}: ${describe(e)}`);
        return;
      }
      const found = findBinaries(tmp, BINARY_NAME);
      if (found.length !== 1) {
        log(`expected exactly one ${BINARY_NAME} inside ${RTK_ASSET}, found ${found.length}`);
        return;
      }
      chmodSync(found[0], 0o755);
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
