#!/usr/bin/env node
// Detect the development tools (runtimes, package managers, LSP servers) a
// project uses, from catalog signal-file basenames anywhere in the pruned tree
// and from the bare command names in the project-root .lsp.json / .mcp.json,
// against the bundled tool-map.json catalog. Zero-dep. Audit mode is
// read-only; --write renders the bundled init-dev-environment templates into
// <root>/.claude/skills/init-dev-environment/ atomically, only when that
// directory is absent. Diagnostics go to stderr; stdout carries only the JSON
// result object.

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, mkdtempSync, chmodSync, renameSync, rmSync, rmdirSync } from "node:fs";
import { resolve, join, basename, relative } from "node:path";

// audit-lsp.mjs's denylist plus virtualenv, cache and build-output directories:
// third-party packages in them ship their own package.json / requirements.txt,
// which would read as a project signal.
const PRUNE_NAMES = new Set([".git", "node_modules", "vendor", "dist", "build", ".venv", "venv", ".tox", "site-packages", "target"]);
const ASSUMED_PRESENT = new Set(["git", "bash", "sh", "curl", "claude"]);
// Trust-boundary filter for repo-supplied command names: 1-64 characters, so
// paths, ${...} variables, spaces, backticks and $(...) never pass.
const COMMAND_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const EVIDENCE_CAP = 5;

/**
 * Load the bundled catalog and index it. Both indexes are Maps, so a
 * repo-supplied name like "constructor" can never resolve to a tool.
 * @returns {{ fileIndex: Map<string, string>, commandIndex: Map<string, string>, ids: string[] }}
 */
function loadCatalog() {
  try {
    const catalog = JSON.parse(readFileSync(new URL("./tool-map.json", import.meta.url), "utf8"));
    if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) throw new Error("expected a JSON object at the top level");
    /** @type {Map<string, string>} */
    const fileIndex = new Map();
    /** @type {Map<string, string>} */
    const commandIndex = new Map();
    const ids = Object.keys(catalog);
    for (const id of ids) {
      const entry = catalog[id];
      if (!entry || !Array.isArray(entry.files) || !Array.isArray(entry.commands)) throw new Error(`"${id}" needs "files" and "commands" arrays`);
      for (const f of entry.files) fileIndex.set(f, id);
      for (const c of entry.commands) commandIndex.set(c, id);
    }
    return { fileIndex, commandIndex, ids };
  } catch (err) {
    throw new Error(`Malformed bundled tool-map.json catalog: ${/** @type {any} */ (err).message}`, { cause: err });
  }
}

/**
 * Walk the tree (prune rules: see PRUNE_NAMES) and collect, per tool id,
 * the root-relative paths of regular files whose basename is a catalog signal.
 * Symlinks are never followed: Dirent isDirectory()/isFile() are false for them.
 * @param {string} root absolute project root
 * @param {Map<string, string>} fileIndex basename -> tool id
 * @returns {Map<string, string[]>}
 */
function findSignalFiles(root, fileIndex) {
  /** @type {Map<string, string[]>} */
  const hits = new Map();
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
    // readdir order is filesystem-dependent; sort so capped evidence is deterministic.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const name = e.name;
      if (e.isDirectory()) {
        if (PRUNE_NAMES.has(name)) continue;
        if (parentName === ".claude" && (name === "worktrees" || name === "agent-memory")) continue;
        walk(join(dir, name), name);
      } else if (e.isFile()) {
        const id = fileIndex.get(name);
        if (id === undefined) continue;
        const list = hits.get(id) || [];
        list.push(relative(root, join(dir, name)));
        hits.set(id, list);
      }
    }
  };
  walk(root, basename(root));
  return hits;
}

/**
 * Read a JSON config file. Absent -> null. Malformed JSON or a top level that
 * is not a plain object throws, so main() fails closed before any write.
 * @param {string} path
 * @returns {Record<string, any> | null}
 */
function readJsonObject(path) {
  if (!existsSync(path)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Malformed ${path}: ${/** @type {any} */ (err).message}`, { cause: err });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Malformed ${path}: expected a JSON object at the top level, got ${Array.isArray(parsed) ? "an array" : parsed === null ? "null" : `a ${typeof parsed}`}`);
  }
  return parsed;
}

/**
 * Bare command names from the project-root .lsp.json (every server block's
 * `command`) and .mcp.json (every `mcpServers.*.command`). Root only; entries
 * without a string `command` (e.g. http/sse servers) are skipped.
 * @param {string} root
 * @returns {{ command: string, source: string }[]}
 */
function configCommands(root) {
  /** @type {{ command: string, source: string }[]} */
  const out = [];
  /**
   * @param {any} block
   * @param {string} source
   * @returns {void}
   */
  const take = (block, source) => {
    if (block && typeof block === "object" && !Array.isArray(block) && typeof block.command === "string") out.push({ command: block.command, source });
  };
  const lsp = readJsonObject(join(root, ".lsp.json"));
  if (lsp) for (const block of Object.values(lsp)) take(block, ".lsp.json");
  const mcp = readJsonObject(join(root, ".mcp.json"));
  const servers = mcp ? mcp.mcpServers : null;
  if (servers && typeof servers === "object" && !Array.isArray(servers)) for (const block of Object.values(servers)) take(block, ".mcp.json");
  return out;
}

/**
 * Classify signal files and config commands into catalog tools and manual
 * to-dos. Evidence is unique, in insertion order (signal files first, then
 * config commands), capped at EVIDENCE_CAP.
 * @param {string} root
 * @returns {{ tools: { id: string, evidence: string[] }[], manual: { command: string, evidence: string[] }[] }}
 */
function detect(root) {
  const { fileIndex, commandIndex, ids } = loadCatalog();
  /** @type {Map<string, string[]>} */
  const toolEvidence = new Map();
  /** @type {Map<string, string[]>} */
  const manualEvidence = new Map();
  /**
   * @param {Map<string, string[]>} map
   * @param {string} key
   * @param {string} item
   * @returns {void}
   */
  const add = (map, key, item) => {
    const list = map.get(key) || [];
    if (!list.includes(item) && list.length < EVIDENCE_CAP) list.push(item);
    map.set(key, list);
  };
  for (const [id, paths] of findSignalFiles(root, fileIndex)) for (const p of paths) add(toolEvidence, id, p);
  for (const { command, source } of configCommands(root)) {
    if (!COMMAND_TOKEN.test(command) || ASSUMED_PRESENT.has(command)) continue;
    const id = commandIndex.get(command);
    if (id !== undefined) add(toolEvidence, id, `${source}: ${command}`);
    else add(manualEvidence, command, `${source}: ${command}`);
  }
  const tools = ids.filter((id) => toolEvidence.has(id)).map((id) => ({ id, evidence: toolEvidence.get(id) || [] }));
  const manual = [...manualEvidence.keys()].sort().map((command) => ({ command, evidence: manualEvidence.get(command) || [] }));
  return { tools, manual };
}

/**
 * Fill the SKILL.md template. Function replacers keep `$&`/`$1` literal.
 * @param {string} template
 * @param {string[]} ids
 * @param {{ command: string }[]} manual
 * @returns {string}
 */
function render(template, ids, manual) {
  return template.replaceAll("@@TOOLS@@", () => ids.join(" ")).replaceAll("@@MANUAL@@", () => (manual.length ? manual.map((m) => m.command).join(", ") : "none"));
}

/**
 * Write <root>/.claude/skills/init-dev-environment/ atomically: both templates
 * are read first, the skill is built in a same-filesystem temp dir outside the
 * watched skills dir, chmod 0755 (mkdtemp creates 0700), then renamed into
 * place. On any failure after mkdtemp the temp dir is removed and the error
 * rethrown, so no partial skill directory is ever left.
 * @param {string} root
 * @param {string[]} ids
 * @param {{ command: string }[]} manual
 * @returns {boolean} skillsDirCreated — true when this call created <root>/.claude/skills
 */
function writeSkill(root, ids, manual) {
  const skillTemplate = readFileSync(new URL("../templates/init-dev-environment/SKILL.md.tmpl", import.meta.url), "utf8");
  const installer = readFileSync(new URL("../templates/init-dev-environment/install.sh", import.meta.url));
  const skillsDir = join(root, ".claude", "skills");
  const skillsDirCreated = !existsSync(skillsDir);
  mkdirSync(skillsDir, { recursive: true });
  let tmp = "";
  try {
    tmp = mkdtempSync(join(root, ".claude", ".init-dev-environment-"));
    writeFileSync(join(tmp, "SKILL.md"), render(skillTemplate, ids, manual));
    writeFileSync(join(tmp, "install.sh"), installer);
    chmodSync(tmp, 0o755);
    renameSync(tmp, join(skillsDir, "init-dev-environment"));
  } catch (err) {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    // Undo the skills dir this call created, so a retry still reports
    // skillsDirCreated (rmdir only removes an empty directory).
    if (skillsDirCreated) {
      try {
        rmdirSync(skillsDir);
      } catch {
        // not empty or already gone: leave it
      }
    }
    throw err;
  }
  return skillsDirCreated;
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
  /** @type {string | null} */
  let rootArg = null;
  let write = false;
  for (const a of argv) {
    if (a === "--write") write = true;
    else if (!a.startsWith("--") && rootArg === null) rootArg = a;
  }
  const root = resolve(rootArg ?? ".");
  const skillDir = join(root, ".claude", "skills", "init-dev-environment");

  /** @type {ReturnType<typeof detect>} */
  let found;
  try {
    found = detect(root);
  } catch (err) {
    fail(/** @type {any} */ (err).message);
    return;
  }

  const skillExists = existsSync(skillDir);
  /** @type {Record<string, any>} */
  const out = { root, tools: found.tools, manual: found.manual, skillDir, skillExists };
  if (write) {
    const wrote = found.tools.length > 0 && !skillExists;
    let skillsDirCreated = false;
    if (wrote) {
      try {
        skillsDirCreated = writeSkill(
          root,
          found.tools.map((t) => t.id),
          found.manual,
        );
      } catch (err) {
        fail(`Failed to write ${skillDir}: ${/** @type {any} */ (err).message}`);
        return;
      }
    }
    out.wrote = wrote;
    out.skillsDirCreated = skillsDirCreated;
  }
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

main();
