// prettier.ts — the ONE prettier in this process: the copy `bun build` inlines here, plus the
// three third-party plugins bundled next to it (java, php, shell). There is no resolver, no
// project-local probe, no PATH probe, no managed copy and no package-runner fallback: this
// instance formats every prettier-covered file. A project's prettier CONFIG is still honored in
// full.
import process from "node:process";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as prettierNs from "prettier";
import * as javaPluginNs from "prettier-plugin-java";
import * as phpPluginNs from "@prettier/plugin-php";
import * as shPluginNs from "prettier-plugin-sh";
import { walkToRoot } from "./util.js";
import { resolveEditorconfig } from "./editorconfig.js";

/** The prettier baked into this bundle by `bun build`. Always available, never probed.
 * `.default` isn't part of prettier's own types -- bundler CJS/ESM interop may wrap the real
 * module under it at runtime regardless -- so only that one access is loosely typed; the
 * resulting binding keeps prettier's real type, giving every call below (resolveConfig, format,
 * getFileInfo, clearConfigCache) full compile-time option checking. */
const bundledPrettier: typeof prettierNs = (prettierNs as unknown as { default?: typeof prettierNs }).default ?? prettierNs;

/** Version of the bundled prettier — asserted against node_modules by the freshness test. */
export const BUNDLED_PRETTIER_VERSION: string = String(bundledPrettier.version ?? "");

/** A bundled plugin's module namespace normalized to the plugin object prettier expects.
 * prettier-plugin-java and prettier-plugin-sh expose it as `default`; @prettier/plugin-php has no
 * default export and its namespace IS the plugin object. Read through a parameter on purpose: a
 * direct `ns.default` on a namespace with no such export is a bun build warning. */
function asPlugin(ns: unknown): unknown {
  return (ns as { default?: unknown }).default ?? ns;
}

/** The prettier plugins bundled alongside the prettier above: java, php and shell. java is the
 * LATEST release and loads two .wasm sidecars from this bundle's own directory (put there by
 * build.mjs); php is latest and pure JS; sh is pinned to its last pure-JS release on purpose --
 * newer releases are WASM-only and resolve their wasm OUTSIDE this bundle's directory. No plugin
 * OPTION is ever set from here (never experimentalWasm): a project's config is the only knob. */
export const BUNDLED_PLUGINS: unknown[] = [asPlugin(javaPluginNs), asPlugin(phpPluginNs), asPlugin(shPluginNs)];

// prettier-plugin-java starts `Parser.init()` in a module-scope IIFE, so a floating promise exists
// from import time. If a .wasm sidecar is missing or corrupt that promise rejects with nothing
// attached, which KILLS this process under node (verified: exit 1) and exits non-zero under bun --
// taking down formatting for every OTHER language too. Downgrade it to a stderr note so the server
// survives and only the affected language fails open. stdout is the JSON-RPC channel: never write
// there. Deliberately process-global because the hazard is created by this module's own imports;
// the cost is that an unrelated unhandled rejection is reported instead of fatal, which is the
// correct trade for a hook whose entire contract is to fail open.
process.on("unhandledRejection", (reason: unknown) => {
  const msg = String((reason as { message?: string })?.message ?? reason).split("\n")[0];
  process.stderr.write(`[universal-format] background plugin init failed; that language will fail open: ${msg}\n`);
});

// Prettier's own project-config search (verified against prettier's bundled source: its
// CONFIG_FILES searcher has no stopDirectory -- the hook that would supply one always returns
// undefined -- so it walks from the file's own directory all the way to the filesystem root,
// never just up to `cwd`). Any narrower search here would risk silently overriding a real
// upstream config this plugin never saw -- exactly the failure the printWidth guard avoids.
export const PRETTIER_CONFIG_FILENAMES = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yml",
  ".prettierrc.yaml",
  ".prettierrc.json5",
  ".prettierrc.js",
  "prettier.config.js",
  ".prettierrc.ts",
  "prettier.config.ts",
  ".prettierrc.mjs",
  "prettier.config.mjs",
  ".prettierrc.mts",
  "prettier.config.mts",
  ".prettierrc.cjs",
  "prettier.config.cjs",
  ".prettierrc.cts",
  "prettier.config.cts",
  ".prettierrc.toml",
];

// Memoized by directory: hasPrettierProjectConfig walks unbounded to the filesystem root on every
// call, and formatInProcess calls it (via shouldOverridePrintWidth) on every single json/yaml
// format -- caching avoids repeating that fs walk + package.json parse for the same directory on
// every write. Invalidated by clearPrettierConfigCaches alongside prettier's own config cache.
const projectConfigCache = new Map<string, boolean>();

// True if a prettier project config governs `fileDir` -- one of prettier's own dedicated config
// files, or a top-level "prettier" key in package.json / package.yaml (prettier reads both
// natively -- loadConfigFromPackageJson / loadConfigFromPackageYaml in its own source;
// package.yaml is pnpm's package.json equivalent). package.yaml has no bundled YAML parser here,
// so its "prettier" key is existence-checked via an anchored, top-level-only regex -- the same
// accepted residual-risk tradeoff as this plugin's other regex-based heuristics.
export function hasPrettierProjectConfig(fileDir: string): boolean {
  const cached = projectConfigCache.get(fileDir);
  if (cached !== undefined) return cached;
  const result = walkToRoot(fileDir, (dir) => {
    if (PRETTIER_CONFIG_FILENAMES.some((name) => existsSync(path.join(dir, name)))) return true;
    const pkgPath = path.join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (pkg && typeof pkg === "object" && Object.hasOwn(pkg, "prettier")) return true;
      } catch {
        /* unreadable/invalid JSON -> treat as absent */
      }
    }
    const pkgYamlPath = path.join(dir, "package.yaml");
    if (existsSync(pkgYamlPath)) {
      let text = "";
      try {
        text = readFileSync(pkgYamlPath, "utf8");
      } catch {
        /* unreadable -> treat as absent */
      }
      if (/^prettier\s*:/m.test(text)) return true;
    }
    return false;
  });
  projectConfigCache.set(fileDir, result);
  return result;
}

/** json/yaml only: true when neither a prettier project config nor an .editorconfig
 * max_line_length governs the file, i.e. prettier's built-in 80-column default would apply to a
 * project that never asked for a line-length limit. Walks .editorconfig unbounded (not
 * cwd-bounded): prettier's own internal `editorconfig: true` resolution has no project-boundary
 * concept either, so a bounded check here could miss a real max_line_length set above cwd (a
 * workspace/monorepo case) and needlessly override what prettier would already have honored. */
export function shouldOverridePrintWidth(file: string, cwd: string): boolean {
  if (hasPrettierProjectConfig(path.dirname(file))) return false;
  const ec = resolveEditorconfig(file, cwd, { unbounded: true });
  if (ec.found && typeof ec.props.max_line_length === "number") return false;
  return true;
}

/** Rewrite a config's `plugins:` entries to absolute paths resolved against the HOOK's cwd.
 * A bundled prettier resolves a bare specifier against the SERVER process's cwd, which is not
 * the session's: verified that `format()` then throws
 * `Cannot find package '<pp>' imported from <procCwd>/noop.js`, which the handler's catch turns
 * into a silent "no formatting at all" for that project. Non-string entries and already-absolute
 * paths pass through untouched. Returns null if ANY entry cannot be resolved — the caller then
 * skips formatting rather than formatting without a plugin the project asked for. */
export function resolveConfigPlugins(plugins: unknown, cwd: string): unknown[] | null {
  if (!Array.isArray(plugins)) return null;
  const req = createRequire(path.join(cwd, "package.json"));
  const out: unknown[] = [];
  for (const entry of plugins) {
    if (typeof entry !== "string" || path.isAbsolute(entry)) {
      out.push(entry);
      continue;
    }
    try {
      out.push(req.resolve(entry));
    } catch {
      return null;
    }
  }
  return out;
}

/** Format a whole source string in-process with the bundled prettier. */
export async function formatInProcess(src: string, filePath: string, cwd: string, lang: string): Promise<string> {
  // Deliberately does NOT clear prettier's config cache. Doing that per format cost ~9.9 ms of
  // the ~10.6 ms total (measured: 10.60 -> 0.73 ms/format on a nested project), i.e. it threw
  // away most of the warm-instance win on every single write. Invalidation is event-driven:
  // formatPost clears the cache when a config/ignore file is written. Trade-off, accepted
  // deliberately: a config edited OUTSIDE the Write/Edit tools (a Bash `sed`, an external
  // editor) is not noticed until the server restarts.
  // Shallow-copied: resolveConfig's result is cached internally by prettier (see above), so
  // mutating it in place would leak this call's plugin/printWidth overrides onto every other
  // file that later resolves to the same cached config.
  const config: any = { ...((await bundledPrettier.resolveConfig(filePath, { editorconfig: true })) ?? {}) };
  if (Array.isArray(config.plugins)) {
    const resolvedPlugins = resolveConfigPlugins(config.plugins, cwd);
    if (resolvedPlugins === null) return src; // unresolvable plugin -> leave the file alone
    config.plugins = resolvedPlugins;
  }
  if ((lang === "json" || lang === "yaml") && shouldOverridePrintWidth(filePath, cwd)) config.printWidth = 99999;
  // Bundled entries go LAST so a project config naming the same plugin cannot leave the bundled
  // prettier without a parser (duplicate registration verified safe). Local array, never assigned
  // back into `config`: resolveConfig's result is cached inside prettier. The resolveConfigPlugins
  // null early-return above MUST stay ahead of this -- a project with an unresolvable custom
  // plugin must keep getting "leave the file alone", not BUNDLED_PLUGINS-only formatting.
  const plugins = [...(Array.isArray(config.plugins) ? config.plugins : []), ...BUNDLED_PLUGINS];
  return await bundledPrettier.format(src, { ...config, plugins, filepath: filePath });
}

/** Drop the bundled prettier's cached config state. Called only from the PostToolUse handler,
 * once a config/ignore file has actually landed on disk — clearing at PreToolUse would re-cache
 * the pre-write content on the next resolveConfig. A broken clearConfigCache must never break
 * the hook, hence the guard + catch. */
export function clearPrettierConfigCaches(): void {
  projectConfigCache.clear();
  try {
    if (typeof bundledPrettier.clearConfigCache === "function") bundledPrettier.clearConfigCache();
  } catch {
    /* a broken instance must never break the hook */
  }
}

/** True when prettier's own ignore files exclude this path. With no subprocess prettier left,
 * this is the ONLY thing keeping the in-process path at parity with `prettier --write`, whose CLI
 * filters even explicitly-named files through `--ignore-path` (default
 * `[.gitignore, .prettierignore]`, resolved against its cwd). `getFileInfo` does NOT
 * auto-discover them (verified: no `ignorePath` -> `ignored:false`), so pass both explicitly;
 * missing files are tolerated. Any error -> not ignored (fail open to formatting). */
export async function isPrettierIgnored(filePath: string, cwd: string): Promise<boolean> {
  try {
    if (typeof bundledPrettier.getFileInfo !== "function") return false;
    const info = await bundledPrettier.getFileInfo(filePath, {
      ignorePath: [path.join(cwd, ".gitignore"), path.join(cwd, ".prettierignore")],
    });
    return info?.ignored === true;
  } catch {
    return false;
  }
}
