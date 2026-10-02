#!/usr/bin/env node
// Audit a project's file extensions against <root>/.claude/skills/lsp/.lsp.json
// (the .lsp.json of the project-scope `lsp` skills-dir plugin) and, on
// --fix/--apply, additively write missing LSP-server coverage plus the plugin
// manifest on first write. A legacy <root>/.lsp.json is merged in as base
// config. Zero-dep.
// Additive-only (never removes/reorders existing keys), respects the LSP
// "first server registered wins" rule, preserves 2-space + trailing newline,
// and fails closed (writes nothing, exit 1) on a malformed or conflicting
// .lsp.json. All work happens in memory and every file is written at most
// once. The legacy root file is deleted only after the plugin write passes
// readback, as the final action.
// Diagnostics go to stderr; stdout carries only the JSON result object.

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync, realpathSync } from "node:fs";
import { resolve, join, basename, dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";

const PRUNE_NAMES = new Set([".git", "node_modules", "vendor", "dist", "build"]);
const EXT_TOKEN = /^\.[A-Za-z0-9]+$/;
// Written only when absent (never overwritten) so `.claude/skills/lsp/` loads
// as the `lsp@skills-dir` plugin.
const MANIFEST = { name: "lsp", description: "Project LSP server configuration, maintained by claude-code-knowledge:lsp-audit." };

/**
 * Recursively collect lowercased file-extension -> file count, pruning the
 * denylisted directories (single-name matches, plus the two-segment
 * `.claude/worktrees` and `.claude/agent-memory`).
 * @param {string} root absolute project root
 * @returns {Map<string, number>}
 */
function scanExtensions(root) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  /**
   * @param {string} dir
   * @param {string} parentName
   * @returns {void}
   */
  const walk = (dir, parentName) => {
    // node builtins are typed `any` via the repo's `declare module "node:*"`
    // shim, so Dirent has no importable type; annotate loosely.
    /** @type {any[]} */
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const name = e.name;
      if (e.isDirectory()) {
        if (PRUNE_NAMES.has(name)) continue;
        if (parentName === ".claude" && (name === "worktrees" || name === "agent-memory")) continue;
        walk(join(dir, name), name);
      } else if (e.isFile()) {
        const i = name.lastIndexOf(".");
        if (i <= 0) continue; // no dot, or dotfile whose only dot is leading
        const ext = ("." + name.slice(i + 1)).toLowerCase();
        counts.set(ext, (counts.get(ext) || 0) + 1);
      }
    }
  };
  walk(root, basename(root));
  return counts;
}

/**
 * Read and parse a .lsp.json file. Throws on malformed JSON so the caller can
 * fail closed. A missing file is not an error (returns an empty config).
 * @param {string} file absolute path of a .lsp.json
 * @returns {{ exists: boolean, config: Record<string, any>, raw: string }}
 */
function readLspJson(file) {
  if (!existsSync(file)) return { exists: false, config: {}, raw: "" };
  const raw = readFileSync(file, "utf8");
  const parsed = JSON.parse(raw); // throws -> caller exits 1
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    // Valid JSON but not a plain object (array/string/number/null) is just as
    // unusable as malformed JSON for our purposes: fail closed the same way,
    // via the caller's existing malformed-JSON catch, instead of silently
    // treating it as an empty config and overwriting it on --fix/--apply.
    throw new Error(`expected a JSON object at the top level, got ${Array.isArray(parsed) ? "an array" : parsed === null ? "null" : `a ${typeof parsed}`}`);
  }
  return { exists: true, config: parsed, raw };
}

/**
 * Merge a legacy project-root .lsp.json into the plugin config. Plugin servers
 * keep their order and root-only servers are appended, so at runtime the
 * plugin's blocks register first (first-registered-wins). A server id present
 * in both must be deep-equal (object key order ignored), otherwise fail closed (the root
 * file is deleted after a write, so a silent drop would lose data).
 * @param {Record<string, any>} pluginConfig
 * @param {Record<string, any>} legacyConfig
 * @param {string} legacyPath
 * @param {string} pluginPath
 * @returns {Record<string, any>}
 */
function mergeLegacyRoot(pluginConfig, legacyConfig, legacyPath, pluginPath) {
  /** @type {Record<string, any>} */
  const clone = JSON.parse(JSON.stringify(pluginConfig));
  for (const [server, block] of Object.entries(legacyConfig)) {
    if (!Object.prototype.hasOwnProperty.call(clone, server)) {
      clone[server] = block;
    } else if (!isDeepStrictEqual(clone[server], block)) {
      fail(`Conflicting "${server}" server in both ${legacyPath} and ${pluginPath} — reconcile manually; nothing written`);
    }
  }
  return clone;
}

/**
 * Set of extensions already covered by any server block, plus a map
 * ext -> the first server (in read order) that claims it.
 * @param {Record<string, any>} config
 * @returns {{ covered: Set<string>, claimedBy: Map<string, string> }}
 */
function coverage(config) {
  /** @type {Set<string>} */
  const covered = new Set();
  /** @type {Map<string, string>} */
  const claimedBy = new Map();
  for (const [server, block] of Object.entries(config)) {
    if (!block || typeof block !== "object") continue;
    const map = block.extensionToLanguage;
    if (!map || typeof map !== "object") continue;
    for (const ext of Object.keys(map)) {
      covered.add(ext);
      if (!claimedBy.has(ext)) claimedBy.set(ext, server);
    }
  }
  return { covered, claimedBy };
}

/**
 * Load the bundled catalog and index it by extension. Built directly from
 * each canonical server object's own extensionToLanguage map — the
 * top-level string aliases in lsp-map.json (e.g. ".cjs": "vtsls") are a
 * human-facing index into the file, not consulted here, so a new extension
 * added only inside a server's extensionToLanguage map is picked up with no
 * separate alias entry to keep in sync.
 * @returns {Map<string, { server: string, languageId: string, note: (string|null), canonical: any }>}
 */
function loadCatalog() {
  const catalog = JSON.parse(readFileSync(new URL("./lsp-map.json", import.meta.url), "utf8"));
  /** @type {Map<string, { server: string, languageId: string, note: (string|null), canonical: any }>} */
  const byExt = new Map();
  for (const canon of Object.values(catalog)) {
    if (!canon || typeof canon !== "object" || !canon.extensionToLanguage) continue;
    for (const [ext, languageId] of Object.entries(canon.extensionToLanguage)) {
      byExt.set(ext, {
        server: canon.server,
        languageId: /** @type {string} */ (languageId),
        note: canon.note ?? null,
        canonical: canon,
      });
    }
  }
  return byExt;
}

/**
 * Build the audit plan: proposals (catalog-known gaps) and unknowns.
 * @param {Map<string, number>} counts
 * @param {Set<string>} covered
 * @param {Record<string, any>} config
 * @param {Map<string, any>} catalog
 * @returns {{ proposals: any[], unknown: any[] }}
 */
function buildPlan(counts, covered, config, catalog) {
  /** @type {any[]} */
  const proposals = [];
  /** @type {any[]} */
  const unknown = [];
  for (const [ext, fileCount] of counts) {
    if (covered.has(ext)) continue;
    const hit = catalog.get(ext);
    if (hit) {
      proposals.push({
        ext,
        server: hit.server,
        languageId: hit.languageId,
        newServer: !Object.prototype.hasOwnProperty.call(config, hit.server),
        note: hit.note,
        fileCount,
      });
    } else {
      unknown.push({ ext, fileCount });
    }
  }
  /** @param {any} a @param {any} b @returns {number} */
  const byCount = (a, b) => b.fileCount - a.fileCount || a.ext.localeCompare(b.ext);
  proposals.sort(byCount);
  unknown.sort(byCount);
  return { proposals, unknown };
}

/**
 * Apply the selected proposals additively into a clone of the existing config.
 * @param {Record<string, any>} config existing parsed config
 * @param {Map<string, string>} claimedBy ext -> existing server that claims it
 * @param {any[]} proposals full proposal list (already sorted)
 * @param {Set<string>} targetSet extensions to apply
 * @param {Map<string, any>} catalog
 * @returns {{ result: Record<string, any>, applied: string[], createdServers: string[], mergedIntoServers: string[], conflictsSkipped: string[] }}
 */
function applyProposals(config, claimedBy, proposals, targetSet, catalog) {
  /** @type {Record<string, any>} */
  const result = JSON.parse(JSON.stringify(config));
  /** @type {string[]} */
  const applied = [];
  /** @type {string[]} */
  const createdServers = [];
  /** @type {string[]} */
  const mergedIntoServers = [];
  /** @type {string[]} */
  const conflictsSkipped = [];
  for (const p of proposals) {
    if (!targetSet.has(p.ext)) continue;
    // Defensive: a proposal is by definition uncovered, but re-check so a
    // target already claimed is never double-written.
    if (claimedBy.has(p.ext)) {
      conflictsSkipped.push(p.ext);
      continue;
    }
    if (!p.newServer) {
      const block = result[p.server];
      // A structurally-invalid existing entry (string/number/null instead of
      // a server-config object — silently skipped at LSP-runtime per the
      // cc-reference doc, and tolerated the same way by coverage() above)
      // must fail closed here too, not throw a raw TypeError mid-write.
      if (!block || typeof block !== "object" || Array.isArray(block)) {
        fail(`Malformed .lsp.json: existing "${p.server}" entry is not a server config object`);
      }
      if (block.extensionToLanguage != null && typeof block.extensionToLanguage !== "object") {
        fail(`Malformed .lsp.json: existing "${p.server}.extensionToLanguage" is not an object`);
      }
      block.extensionToLanguage ||= {};
      block.extensionToLanguage[p.ext] = p.languageId;
      if (!mergedIntoServers.includes(p.server)) mergedIntoServers.push(p.server);
      applied.push(p.ext);
    } else {
      if (!Object.prototype.hasOwnProperty.call(result, p.server)) {
        const canon = catalog.get(p.ext).canonical;
        result[p.server] = {
          command: canon.command,
          args: canon.args,
          extensionToLanguage: {},
          startupTimeout: canon.startupTimeout,
        };
        createdServers.push(p.server);
      }
      // Scoped to exactly what was applied — never the catalog server's
      // other sibling extensions the caller didn't target.
      result[p.server].extensionToLanguage[p.ext] = p.languageId;
      applied.push(p.ext);
    }
  }
  return {
    result,
    applied,
    createdServers,
    mergedIntoServers,
    conflictsSkipped,
  };
}

/**
 * Print an error to stderr and exit 1.
 * @param {string} msg
 * @returns {never}
 */
function fail(msg) {
  console.error(msg);
  process.exit(1);
}

/**
 * @returns {void}
 */
function main() {
  const argv = process.argv.slice(2);
  let rootArg = ".";
  let mode = "audit";
  /** @type {string[]} */
  let applyExts = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fix") {
      mode = "fix";
    } else if (a === "--apply") {
      mode = "apply";
      applyExts = (argv[++i] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (!a.startsWith("--")) {
      if (rootArg === ".") rootArg = a;
    }
  }
  const root = resolve(rootArg);
  const pluginDir = join(root, ".claude", "skills", "lsp");
  const pluginLsp = join(pluginDir, ".lsp.json");
  const manifest = join(pluginDir, ".claude-plugin", "plugin.json");
  const legacyLsp = join(root, ".lsp.json");

  let plugin;
  try {
    plugin = readLspJson(pluginLsp);
  } catch (err) {
    fail(`Malformed .lsp.json at ${pluginLsp}: ${/** @type {any} */ (err).message}`);
    return;
  }

  // A root that is itself a plugin loads its own root .lsp.json, so that file is
  // live plugin config, not a legacy file to migrate and delete.
  let legacy = { exists: false, config: /** @type {Record<string, any>} */ ({}), raw: "" };
  if (!existsSync(join(root, ".claude-plugin", "plugin.json"))) {
    try {
      legacy = readLspJson(legacyLsp);
    } catch (err) {
      fail(`Malformed .lsp.json at ${legacyLsp}: ${/** @type {any} */ (err).message}`);
      return;
    }
  }

  // Both files are read before anything else happens. Conflicts fail closed
  // here, in every mode (audit included), so audit and write runs always agree.
  // A plugin file that is a link to the root file would make the final delete
  // remove the only real copy.
  if (legacy.exists && plugin.exists && realpathSync(legacyLsp) === realpathSync(pluginLsp)) {
    fail(`${pluginLsp} resolves to the same file as ${legacyLsp} — replace the link with a regular file; nothing written`);
  }
  const base = legacy.exists ? mergeLegacyRoot(plugin.config, legacy.config, legacyLsp, pluginLsp) : plugin.config;

  const counts = scanExtensions(root);
  const { covered, claimedBy } = coverage(base);

  let catalog;
  try {
    catalog = loadCatalog();
  } catch (err) {
    fail(`Malformed bundled lsp-map.json catalog: ${/** @type {any} */ (err).message}`);
    return;
  }

  const { proposals, unknown } = buildPlan(counts, covered, base, catalog);

  if (mode === "audit") {
    process.stdout.write(
      JSON.stringify(
        {
          root,
          lspJsonExists: plugin.exists,
          legacyRootLspJson: legacy.exists,
          covered: [...covered].sort(),
          proposals,
          unknown,
          conflicts: [],
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  const validExt = new Set(mode === "fix" ? proposals.map((p) => p.ext) : applyExts.filter((t) => EXT_TOKEN.test(t) && proposals.some((p) => p.ext === t)));
  const { result, applied, createdServers, mergedIntoServers, conflictsSkipped } = applyProposals(base, claimedBy, proposals, validExt, catalog);

  let wrote = false;
  let migratedFromRoot = false;
  const needsWrite = applied.length > 0 || legacy.exists;
  if (needsWrite) {
    // Order matters: manifest dir -> manifest (only if absent) -> .lsp.json -> readback -> delete legacy root (last).
    mkdirSync(dirname(manifest), { recursive: true });
    if (!existsSync(manifest)) writeFileSync(manifest, JSON.stringify(MANIFEST, null, 2) + "\n");
    const trailing = !plugin.exists || plugin.raw.endsWith("\n") ? "\n" : "";
    writeFileSync(pluginLsp, JSON.stringify(result, null, 2) + trailing);
    // Readback verification: re-parse and confirm every applied ext resolves.
    let back;
    try {
      back = JSON.parse(readFileSync(pluginLsp, "utf8"));
    } catch (err) {
      fail(`Readback parse failed after write: ${/** @type {any} */ (err).message}`);
      return;
    }
    const backCovered = coverage(back).covered;
    for (const ext of applied) {
      if (!backCovered.has(ext)) fail(`Post-write assertion failed: ${ext} not resolvable after write`);
    }
    if (legacy.exists) {
      for (const ext of coverage(legacy.config).covered) {
        if (!backCovered.has(ext)) fail(`Post-write assertion failed: legacy ${ext} not resolvable after write`);
      }
      try {
        unlinkSync(legacyLsp); // final action: only reached after the verified plugin write
      } catch (err) {
        fail(`Wrote ${pluginLsp} but could not delete ${legacyLsp}: ${/** @type {any} */ (err).message} — its config is already in the plugin; delete the root file manually`);
        return;
      }
      migratedFromRoot = true;
    }
    wrote = true;
  }

  process.stdout.write(
    JSON.stringify(
      {
        root,
        applied,
        createdServers,
        mergedIntoServers,
        conflictsSkipped: [...new Set(conflictsSkipped)],
        wrote,
        migratedFromRoot,
      },
      null,
      2,
    ) + "\n",
  );
}

main();
