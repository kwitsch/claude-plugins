#!/usr/bin/env node
// Audit a project's file extensions against its project-root .lsp.json and,
// on --fix/--apply, additively write missing LSP-server coverage. Zero-dep.
// Additive-only (never removes/reorders existing keys), respects the LSP
// "first server registered wins" rule, preserves 2-space + trailing newline,
// and fails closed (writes nothing, exit 1) on a malformed .lsp.json. All work
// happens in memory; the file is written at most once, as the final action.
// Diagnostics go to stderr; stdout carries only the JSON result object.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join, basename } from "node:path";

const PRUNE_NAMES = new Set([".git", "node_modules", "vendor", "dist", "build"]);
const EXT_TOKEN = /^\.[A-Za-z0-9]+$/;

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
 * Read and parse <root>/.lsp.json. Throws on malformed JSON so the caller can
 * fail closed. A missing file is not an error (returns an empty config).
 * @param {string} root
 * @returns {{ exists: boolean, config: Record<string, any>, raw: string }}
 */
function readLspJson(root) {
  const p = join(root, ".lsp.json");
  if (!existsSync(p)) return { exists: false, config: {}, raw: "" };
  const raw = readFileSync(p, "utf8");
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

  let lsp;
  try {
    lsp = readLspJson(root);
  } catch (err) {
    fail(`Malformed .lsp.json at ${join(root, ".lsp.json")}: ${/** @type {any} */ (err).message}`);
    return;
  }

  const counts = scanExtensions(root);
  const { covered, claimedBy } = coverage(lsp.config);

  let catalog;
  try {
    catalog = loadCatalog();
  } catch (err) {
    fail(`Malformed bundled lsp-map.json catalog: ${/** @type {any} */ (err).message}`);
    return;
  }

  const { proposals, unknown } = buildPlan(counts, covered, lsp.config, catalog);

  if (mode === "audit") {
    process.stdout.write(
      JSON.stringify(
        {
          root,
          lspJsonExists: lsp.exists,
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
  const { result, applied, createdServers, mergedIntoServers, conflictsSkipped } = applyProposals(lsp.config, claimedBy, proposals, validExt, catalog);

  let wrote = false;
  if (applied.length > 0) {
    const trailing = !lsp.exists || lsp.raw.endsWith("\n") ? "\n" : "";
    const p = join(root, ".lsp.json");
    writeFileSync(p, JSON.stringify(result, null, 2) + trailing);
    // Readback verification: re-parse and confirm every applied ext resolves.
    let back;
    try {
      back = JSON.parse(readFileSync(p, "utf8"));
    } catch (err) {
      fail(`Readback parse failed after write: ${/** @type {any} */ (err).message}`);
      return;
    }
    const backCovered = coverage(back).covered;
    for (const ext of applied) {
      if (!backCovered.has(ext)) fail(`Post-write assertion failed: ${ext} not resolvable after write`);
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
      },
      null,
      2,
    ) + "\n",
  );
}

main();
