# CLAUDE.md — src/universal-format-mcp

TypeScript sources of the generated `plugins/universal-format/mcp/server.mjs`. Plugin-level rules (hook roster, explicit `input` field, do-not-restore list): `plugins/universal-format/CLAUDE.md`. After editing any `*.ts` or `build.mjs` here, run `pnpm run build:universal-format-mcp` before commit.

## Module constraints

- Keep the import graph acyclic: `types ← util ← editorconfig ← prettier ← registry ← handlers ← server`.
- Use `./x.js` specifiers for relative imports: the root tsconfig's `moduleResolution: "NodeNext"` requires it, and `bun build` resolves `./x.js` to `x.ts`.
- Keep module-level singletons (`probeCache`, `ignoreCache`, `projectConfigCache`, `gitRootCache`, `cwdOverrides`) single instances — bun emits each module once, so both handlers share them. Never use a single "current cwd" global: concurrent sub-agent calls carry different cwds against this one server process.
- `server.ts` re-exports the symbols the `test/universal-format/*.test.mjs` suites import from the built artifact (e.g. `resolveBase`); add a re-export when a test needs a new symbol.
- `detectRuntime()` in `server.ts` stays module-local and non-exported, and reads `process.versions.bun` (never a bare `Bun` identifier), so the node-target bundle has no `Bun.` / `bun:` token (enforced by `build-artifact.test.mjs`).
- `SERVER_INFO.version` is inlined from `plugin.json` at build time (`--env`): never hand-pair it with a release bump, and expect a version bump to reach the bundle only after a rebuild.

## Bundled prettier (no resolver) (do not "fix" without reading this)

- There is exactly ONE prettier in the process: the copy `bun build` inlines from `prettier.ts`'s `import * as prettierNs from "prettier"`. It formats every prettier-covered file, unconditionally.
- **Deliberately removed, do not re-add:** the project-local tier (`createRequire(cwd).resolve("prettier")`), the PATH tier, the plugin-data copy, the `npx --yes prettier` safety net, `resolvePrettierSource`, `loadPrettier`/`loadedPrettiers`, `isToolAvailable`, `guardPrintWidthArgv`, and the six prettier `REGISTRY` entries. `format_pre` owns every prettier language; `format_post` returns `{}` for them.
- Three third-party plugins are bundled next to it (`BUNDLED_PLUGINS` in `prettier.ts`: `prettier-plugin-java`, `@prettier/plugin-php`, `prettier-plugin-sh`) and appended to the `plugins` option of EVERY `formatInProcess` call (single-branched call site).
  - They replaced the shell/java/php CLI chains outright — those `REGISTRY` entries and `MAPPERS` are deleted and there is NO CLI fallback: a plugin that cannot parse a file throws, the handler's `catch` returns `{}`, the write proceeds unformatted.
  - Pins are exact (root `package.json`; asserted by `build-artifact.test.mjs`). Java and php are the latest releases; shell is pinned to its last release that bundles cleanly — 0.17.0+ resolves its wasm outside the bundle's directory and needs ~540 lines of vendored TinyGo glue to defeat a long-standing `sideEffects` bug. Do not bump it without re-verifying the bundle.
  - Never set a plugin OPTION from this code (in particular never `experimentalWasm`): a project's prettier config is the only knob.
  - Keep `prettier.ts`'s stderr-only `process.on("unhandledRejection")` guard: plugin-java fires `Parser.init()` in a module-scope IIFE, so a missing/corrupt sidecar rejects a floating promise at import time, which kills the server under node and takes down all thirteen languages instead of just Java. `bundled-plugins.test.mjs` asserts the guard is armed.
  - Kotlin/Python/Go/Rust stay on CLIs by survey: kotlin's only plugin `spawnSync`s `java -jar` against a bundled JVM jar and needs prettier 1.x, python's is a single 2018 release pinned to a prettier git SHA, and no viable prettier plugin formats Go or Rust.
- Accepted consequences:
  - A project's own prettier version no longer wins; a project's CI `prettier --check` may disagree with what this plugin wrote. The escape hatch is `.prettierignore`.
  - Third-party prettier plugins named in a project's config are best-effort (see `resolveConfigPlugins`).
- Project-level prettier CONFIG discovery is unchanged: `formatInProcess` calls `resolveConfig(filePath, { editorconfig: true })`, so `.prettierrc*`, `prettier.config.*`, the `package.json`/`package.yaml` `"prettier"` key and `.editorconfig` are honored.
- **`resolveConfigPlugins`:** a bundled prettier resolves `plugins:` against the SERVER process's cwd, not the session's (verified: a foreign cwd throws `Cannot find package '<pp>'`, which the handler's catch turns into silent no formatting).
  - It rewrites every non-absolute string entry to an absolute path via `createRequire(join(cwd, "package.json")).resolve(entry)`, passes non-strings and absolute paths through, and returns `null` if any entry is unresolvable.
  - On `null`, `formatInProcess` returns its input unchanged, so the handler's `formatted === input` check yields `{}`: skip formatting rather than format without a plugin the project asked for. Silently stripping `plugins` was rejected (writes output the project never asked for, and fails anyway for parser-providing plugins).

## `.prettierignore` is the ONE ignore source (do not "fix" back to CLI parity)

- `prettier --write <file>` filters even an explicitly named file through `--ignore-path` (CLI default `[.gitignore, .prettierignore]`). `isPrettierIgnored` passes ONLY `<base>/.prettierignore` (module-private `PRETTIER_IGNORE_FILENAME`, read by `readIgnoreState` and `probePrettierIgnored`).
- Do not restore `.gitignore`: a `.gitignore`d-but-not-`.prettierignore`d file (a `dist/` bundle, generated sources, this repo's `docs/`) IS formatted on purpose; `.prettierignore` is the single opt-out.
- `getFileInfo` does NOT auto-discover ignore files (verified), so the path is passed explicitly, joined to the file's `base`; a missing file is tolerated and any error falls open to formatting. This repo's `pnpm-lock.yaml` and generated `mcp/server.mjs` are in the root `.prettierignore` (not merely `.gitignore`) for exactly that reason.

## Config-cache invalidation is event-driven, NOT per format (do not "fix" back)

- `formatInProcess` deliberately does not call `clearConfigCache()`: per format it cost nearly all of the time and threw away the warm-instance win on every write.
- Instead `formatPost` calls `clearPrettierConfigCaches()` (one guarded `clearConfigCache()` in a `try/catch`) when the written file's basename is in `CACHE_INVALIDATING_BASENAMES` (`PRETTIER_CONFIG_FILENAMES` + `package.json` + `package.yaml` + `.editorconfig` + `.prettierignore`). This depends on:
  - PostToolUse is the only correct moment: clearing at PreToolUse would re-cache the pre-write content on the next `resolveConfig`.
  - The check runs BEFORE the `EXT_MAP` language guard: most of these basenames have no extension, so the guard would drop them and the cache would never clear.
  - One instance means one clear (the old `loadedPrettiers` iteration is gone).
- Prettier's cache goes stale in three shapes: a config created after a negative lookup, `.prettierrc` edited, `.editorconfig` edited.
- `.prettierignore` is spread in from `PRETTIER_IGNORE_BASENAMES` so the set stays the single "a config-ish file was written" concept. `clearConfigCache()` is inert for it (prettier caches no ignore file), but `formatPost`'s basename block has a second line that re-primes this server's own ignore cache.
- Accepted trade-off, pinned by a test: a config changed without passing through Write/Edit (Bash `sed`, external editor) is NOT picked up until the server restarts. `prettier.test.mjs` covers both directions by probing `semi` on a `.mjs` file — never json/yaml `printWidth`, which `shouldOverridePrintWidth` re-reads from disk on every call and would make the test pass for the wrong reason.

## Ignore-file caching is event-driven too (do not "fix" back to a per-call re-read)

- `isPrettierIgnored` keeps its name, signature and `formatPre` call site but is backed by the module-level `ignoreCache: Map<base, { hasRules, verdicts }>` in `prettier.ts`, keyed by `resolveBase`'s base directory like `projectConfigCache`. Out-of-cwd files add one entry per foreign project root for the process lifetime (same accepted growth class as `projectConfigCache`).
- `hasRules` derives from the base-rooted `.prettierignore`'s CONTENT, not its existence: a file holding only blank/`#` lines cannot ignore anything, and any doubt (unreadable file, unusual escape) resolves to `true` (the slow path).
- `verdicts` memoizes prettier's own per-path `getFileInfo` answers — sound because gitignore matching is purely path-based, so a verdict changes only when an ignore file does.
- Prettier remains the only thing that decides whether a path matches. Do not hand-roll a matcher: negation, `**`, anchoring, directory-only patterns and escapes would silently regress.
- Refresh events, none on the `formatPre` hot path:
  - **`formatPost` on a `.prettierignore` write** — `primePrettierIgnoreCache(base)` re-reads the BASE-rooted file (a nested `sub/.prettierignore` write causes a harmless re-read instead of mistaking the written file for the cached one). Same BEFORE-the-`EXT_MAP`-guard placement as the config clear, for the same reason.
  - **`cwd_changed`** — `clearPrettierIgnoreCache(old_cwd)`, then `primePrettierIgnoreCache(new_cwd)` plus `warmPrettierConfigCache(new_cwd)` (a `resolveConfig` on a probe path in the new directory, result discarded: it populates prettier's own directory-keyed search cache and stores nothing of its own).
  - **Server restart** — there is no startup moment with a known cwd (MCP `initialize` carries no cwd; `SessionStart`/`Setup` fire before the server connects), so "at start" is populate-on-first-use, like `projectConfigCache`/`hasPrettierProjectConfig`.
- There is deliberately NO second prettier-config store: `formatInProcess` still calls `resolveConfig(filePath, { editorconfig: true })`, and `clearPrettierConfigCaches()` is still the invalidation.
- Same accepted trade-off as the config cache, pinned by two tests: an ignore file edited out of band is not picked up until a Write/Edit lands on it, a `cd` happens, or the server restarts (mild: a newly ignored file is formatted once more).
- `clearPrettierConfigCaches()` deliberately does NOT touch `ignoreCache`: a `.prettierrc` write cannot change what is ignored.

## `cwd` is a hint, never a gate — `resolveBase` is the anchor (`handlers.ts`)

- `resolveBase` is shared by both handlers, exported, and re-exported from `server.ts` so `handlers.test.mjs` can test it against the built artifact. There is NO outside-cwd guard: a Write/Edit to any path is formatted, including a file in no project at all.
- `resolveBase(cwd, resolved)` (backed by `resolveBaseAndRel`, which resolves `base` and the base-relative path together so the containment check is never computed twice) returns, in order:
  1. `cwd`, when non-empty and `relativeIfContains` says it contains the file — byte-identical to the old behavior for every in-cwd file, which keeps the existing suite a meaningful regression gate;
  2. else the nearest ancestor directory of the file holding a `.git` entry — existence-checked, NEVER `isDirectory()`-checked, because a linked worktree's and a submodule's `.git` is a FILE. The walk uses `util.ts`'s `walkToRoot` (no second ascent loop), stops AT `$HOME` without checking it (a git-tracked dotfiles checkout at `$HOME` must never become "the project" for an unrelated scratch file), and is memoized per file directory in `findGitRoot`'s `gitRootCache` (process-lifetime);
  3. else the file's own directory.
- Everything project-scoped anchors on that `base`: `isExcludedPath`'s input (`path.relative(base, resolved)`), `<base>/.prettierignore`, prettier `plugins:` resolution, the `.editorconfig`/tool-native-config walk bound, the formatter subprocess's cwd and the `ignoreCache` key. An out-of-cwd file is therefore formatted against ITS project's config.
- `base` is always an ancestor-or-equal of the file's directory, so the relative path never escapes with `..` and both bounded upward walks (`findNativeConfig`, `resolveEditorconfig`) terminate at `base` instead of walking to the filesystem root.
- `relativeIfContains` is `path.relative`-based on purpose: the older `resolved !== dir && !resolved.startsWith(dir + path.sep)` form rejected EVERY file when the directory carried a trailing separator or was `/` — silently formatting nothing for the whole session. Do not "simplify" it back to a `startsWith` prefix test, and do not re-add a project-membership gate (the cwd-as-gate pattern this design removed).
- The only skip reasons are extension/language, `isExcludedPath`/`isClaudeInternalPath`, and `<base>/.prettierignore`. A relative `file_path` with an empty `cwd` is the one unresolvable case and returns `{}`.
- The notice text shows the base-relative path when `base === cwd` (in-cwd messages stay byte-identical) and the absolute path otherwise.

## Path exclusions (`isExcludedPath`)

- Beyond `node_modules`/`vendor`/`.git`, it skips two Claude-Code-owned subtrees that can land inside a broad cwd (`$HOME`, a repo root nesting worktrees): `.claude/worktrees/` (harness-created git worktrees, never this session's own project content) and `.claude/agent-memory/` (gitignored agent runtime artifacts). A basename containing the literal `.local.` (e.g. `settings.local.json`) is skipped regardless of directory, matching `.claude/.gitignore`'s `*.local.*` convention.
- **Deliberately narrow — not a blanket `.claude/` exclusion:** `rules/`, `agents/`, `skills/` and `settings.json` under `.claude/` are tracked content and keep being formatted.
- **Evaluate `isExcludedPath` on the BASE-relative path, never the absolute one.** Absolute segments would permanently exclude a background session's own worktree (`<repo>/.claude/worktrees/<name>/…`) — the bug `worktree_entered` exists to fix. `node_modules`/`vendor`/`.git`/`*.local.*` are position-independent and still apply on `rel`.
- **`isClaudeInternalPath` closes the out-of-cwd gap, gated on `base !== cwd`.** A file written by absolute path into a SIBLING agent's worktree/scratch state would anchor `base` at that worktree's own root (its `.git` is a FILE, so the git-root walk stops there), erasing `.claude/worktrees` from `rel` and formatting content this agent never entered. `handlers.ts` therefore checks the file's absolute path for `.claude/worktrees`/`.claude/agent-memory` — but ONLY when `base !== cwd`: when `base === cwd` the write is inside the session's own project root (including its own entered worktree, via `worktreeEntered`'s override), whose absolute path legitimately contains `.claude/worktrees/<name>`, and must keep formatting.
- **`worktree_entered` / `cwdOverrides`:** `EnterWorktree` switches a background-job session's cwd into `.claude/worktrees/<name>/`, yet later `Write|Edit` hook calls keep reporting the PRE-worktree `cwd` (observed: zero `CwdChanged` events across a real `EnterWorktree`). Every file in the session's own worktree then resolves as `.claude/worktrees/<name>/...` relative to that stale cwd, so exclusion silently stops all formatting.
  - `worktree_entered` (`PostToolUse:EnterWorktree`, reading `tool_response.worktreePath` — the field coding-toolbox's `worktreeRefreshHandler` also prefers over `cwd`) raises an override in `handlers.ts`'s `cwdOverrides` that `formatPre`/`formatPost` resolve through instead of trusting `args.cwd`. Do not remove it on the theory that `CwdChanged` "should" cover it.
- **`cwdOverrides` is a `Map` keyed by `agent_id` (falling back to `session_id`), NEVER a bare global.** One MCP server process is shared by every subagent in the session; a single override would let whichever subagent's `EnterWorktree` fired last win for EVERY concurrent subagent, formatting one agent's files against a sibling's worktree.
  - `overrideKey()` derives the key; a call with neither field resolves to `""`, is un-keyable, and falls through to raw `args.cwd` (never crashes, never guesses).
  - Pinned by `prettier.test.mjs`'s "concurrent subagents keep independent overrides" test.

## YAML/JSON line-length guard (do not "fix" without reading this)

- Prettier's default `printWidth` (80) wraps JSON/YAML arrays and flow mappings in projects that never asked for an 80-column limit. Prettier's bare CLI already honors a project's own config, so this guard only covers the ABSENT-config case: no project config now means no line-length limit.
- `shouldOverridePrintWidth(file, cwd)` (json/yaml only; every other language is untouched) checks `hasPrettierProjectConfig`, then `resolveEditorconfig`'s `max_line_length`; only when both come up empty does `formatInProcess` set `config.printWidth = 99999` (never `Infinity` — prettier rejects it).
  - `hasPrettierProjectConfig` is existence-only over prettier's own `CONFIG_FILES` (`.prettierrc*`/`prettier.config.*`) plus a top-level `"prettier"` key in `package.json` (parsed JSON, `Object.hasOwn` on the top-level key only — an entry under `devDependencies` does NOT count) or `package.yaml` (anchored top-level-only regex; there is no bundled YAML parser).
  - `normalizeProps` drops an explicit `max_line_length = off` (treated as "not set"), so it falls through to the `99999` override. Same net effect (no limit), not a bug.
- **Unbounded walk, not `cwd`-bounded:** `hasPrettierProjectConfig` walks from the edited file's own directory to the filesystem root, like prettier's own config searcher (its `stopDirectory` hook returns `undefined`). Stopping at cwd (as `findNativeConfig`/`resolveEditorconfig` correctly do) would risk misdetecting "absent" for a prettier config above the project root (workspace/monorepo) and silently overriding a config this plugin never saw.
- **Markdown is deliberately untouched:** prettier's default `proseWrap` is `"preserve"`, so there is no default-line-length problem for `.md`, and a `printWidth` would perturb OTHER formatting decisions inside a Markdown file (e.g. how a fenced `json` block wraps).
- `css`/`scss`/`less`/`html`/`vue`/`graphql`/`shell`/`java`/`php` are unguarded too — only json/yaml were reported as having the problem.

## Build (`build.mjs`)

- Run `pnpm install --frozen-lockfile` in the tree you build from (the bundle embeds THIS prettier; `node_modules` must be local), then `pnpm run build:universal-format-mcp`. Requires a local bun; CI never runs it.
- Output is a 3-line banner plus the bundle body: `#!/usr/bin/env node`, the `@ts-nocheck` "generated bundle" line, and `// uf-build-fingerprint src=<16hex> body=<16hex> prettier=<v> plugins=<pins> assets=<16hex> bun=<v>`.
  - `plugins=` is the three exact plugin pins read from the root `package.json` (not `node_modules` — two of the three do not export `./package.json`).
  - `assets=` is a 16-hex hash over the copied `.wasm` sidecars as `basename \0 bytes \0`, sorted by basename; it closes the gap that `hashSourceTree` (`src=`) covers only `src/`.
  - `bun=` is provenance only, never asserted: bun is pinned nowhere in this repo and byte-equality across bun versions is not claimed.
- Freshness is enforced by `test/universal-format/build-artifact.test.mjs` under `pnpm run test:unit` (recomputes the source and body hashes, compares the bundled prettier version with the installed one), so CI needs no bun and no byte-reproducibility.
- Bundle the WHOLE prettier package (all parser plugins) on purpose: prettier delegates embedded `html`/`graphql`/`css` blocks inside Markdown to those parsers, so trimming would silently break accepted inputs.
- `eslint.config.mjs` and the root `.prettierignore` both exclude the artifact; neither matches `.wasm`, and `EXT_MAP` has no `.wasm` entry, so nothing ever tries to format a sidecar.

### Build flags (every one is load-bearing)

- `--target=node` — bun's default target is `browser`. With `node`, built-ins stay external imports and no bun shims are emitted (no `Bun.`, no `import.meta.require`), so the bundle runs under plain `node`.
- `--format=esm` — named exports must survive for `node --test`; `import.meta.url` must stay real (`isMainModule` depends on it).
- `--env=UNIVERSAL_FORMAT_MCP_VERSION*` — inlines `plugin.json`'s version as a compile-time constant into `SERVER_INFO.version` (survives running under plain node with the env var unset).
- `cwd: repoRoot` on the spawn — bun embeds cwd-relative `// <module path>` provenance comments; pinning cwd makes the output caller-independent.
- Comment canonicalization — `node_modules/.pnpm/<pkg>/node_modules/` becomes `node_modules/` inside `//`-prefixed lines only, so hoisted and pnpm-symlinked layouts produce identical sha256.
- Banner prepended by the script (not `--banner`) — the shebang must be byte one and the fingerprint must be computed over the final body.
- `@ts-nocheck` on line 2 — the artifact sits under `plugins/**/*.mjs`, which the root `tsconfig.json` `include` glob matches; unchecked it reports thousands of `TS7006`-class errors. It also exempts the file from the JSDoc floor (`.claude/rules/jsdoc-mjs.md`).
- `chmodSync(0o755)` — per `.claude/rules/hooks-executable.md`. The file is already git mode `100755` and `core.fileMode=false`, so a rebuild in place needs no `git update-index --chmod=+x`.
- **Not** `--minify` — a ~8% gzip saving is not worth losing line-numbered stack traces in a fail-open code path.
- **Not** `--reject-unresolved` — prettier resolves a project's config file through a runtime `import()` of a computed path, unresolvable at build time by design.
- **Not** `--production` / `--bytecode` / `--compile` — `--production` implies minification, `--bytecode` forces CJS, `--compile` emits a standalone executable; all three contradict a node-runnable ESM artifact.

### Wasm sidecars

- The artifact is `server.mjs` PLUS three committed `.wasm` sidecars in the same `mcp/` directory: `web-tree-sitter.wasm`, `tree-sitter-java_orchard.wasm` and `main.wasm` (sh-syntax's parser). Git mode `100644`; `*.wasm binary` in `.gitattributes`.
- They live there because `prettier-plugin-java` and `web-tree-sitter` load theirs via `new URL(<name>, import.meta.url)`, which after bundling resolves to the BUNDLE's own directory regardless of the dependency's internal layout. Verified relocatable: the whole `mcp/` directory runs from a copy with no `node_modules` above it, under node and bun (matters because the plugin runs from a versioned plugin-cache copy).
- `sh-syntax` resolves `main.wasm` through a CJS `__dirname`-relative lookup instead, and bun hardcodes THAT as the build machine's absolute path. `build.mjs`'s `containShSyntaxDirname` rewrites it to the same `import.meta.url`-based resolution, anchored so the lookup lands next to the bundle (it throws loudly when the shim shape changes).
- `bun build` cannot emit any of the three (all are runtime lookups the bundler cannot see), so `build.mjs` copies them by hand: resolving each the way its plugin resolves it at runtime, sweeping every other `*.wasm` out of the output directory first (a plugin bump that renames a grammar cannot leave an orphan), and fingerprinting them into `assets=`.
- Never hand-edit the bundle or the sidecars.

### Packaging rationale (why it stays bundled)

- The plugin runs from a versioned plugin-cache copy with no ancestor `node_modules`, and `bin/mjs-launch.sh` execs `bun`/`node` with no install step. `prettier` and its java/php/shell plugins (with their `web-tree-sitter`/`sh-syntax` wasm bindings) are root devDependencies never present under `plugins/`, so they resolve at runtime only because `bun build` inlines them into one file.
- Un-bundling to bare-specifier `.mjs` imports would fail to start for every real consumer; vendoring a full `node_modules` under `mcp/` is larger and more drift-prone; a runtime `pnpm install` step breaks the repo's zero-install launcher convention.
- The wasm-sidecar copy and the `sh-syntax __dirname` rewrite are consequences of bundling, not independent reasons to un-bundle. Reopen only if Claude Code's plugin-install model ever provisions `node_modules` at runtime.
