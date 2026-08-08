# CLAUDE.md — universal-format

Auto-formatter plugin backed by a plugin-local MCP stdio server (`mcp/server.mjs` — a
committed `bun build` bundle, see "Built artifact" below), launched via a bun-preferred
`bin/mjs-launch.sh` wrapper. Two `mcp_tool` hooks on `Write|Edit`: **PreToolUse
`format_pre`** formats prettier languages (JS/TS, JSON, YAML, Markdown, CSS, SCSS)
in-process BEFORE the write via `hookSpecificOutput.updatedInput`, always with the
prettier bundled into the server; **PostToolUse `format_post`** formats the remaining
languages (Shell/Java/Kotlin/Python/Go/PHP) on disk after the write via each tool's CLI,
and returns `{}` for every prettier language. No `userConfig` — the hooks ARE the plugin
(see "No toggle").

## Architecture (do not "fix" without reading this)

- **One MCP server, two tools.** `.mcp.json` registers `universal-format-hooks`
  (`command: ${CLAUDE_PLUGIN_ROOT}/bin/mjs-launch.sh`, `args:
["${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs"]`, no `env` block). Both hooks reference the
  runtime-namespaced `plugin:universal-format:universal-format-hooks` (NOT the bare
  `.mcp.json` key — that fails to connect). `timeout: 60`, no `async`, no `if` on
  either. All logic lives in `mcp/server.mjs`; the old `hooks/format-file.mjs` command
  hook is deleted. This plugin writes nothing outside the project: `${CLAUDE_PLUGIN_DATA}`
  is not used at all.
- **`bin/mjs-launch.sh` is shipped for repo parity, NOT for speed.** Measured on this
  machine, bun is SLOWER here than node (warm format ~48 ms bun vs ~39 ms node; first
  format ~354 ms vs ~161 ms); only the one-time module import is faster under bun.
  Both are far under the ~223 ms cold-CLI spawn, so the in-process thesis holds. Do
  NOT "restore" a direct-`.mjs` invocation on performance grounds, and do NOT claim
  bun is faster here, without a new decision. Wrapper uses the APPEND-PATH form
  (inherited PATH wins over `~/.local/bin`/`~/.bun/bin`) so a stale user-dir binary
  can't shadow a system tool.
- **`format_pre` never sets `permissionDecision`.** Only `updatedInput` (+ the
  `additionalContext` reformat notice). `"allow"` would auto-approve every Write/Edit;
  `"defer"` would drop the mutation. For Edit it emits a WHOLE-FILE SWAP:
  `updatedInput = { file_path, old_string: <entire pre-edit file>, new_string:
<formatted whole file>, replace_all: false }` — formatting only the Edit fragment is
  broken and is not the design. `applyEdit` mirrors Claude Code's Edit contract
  (not-found / non-unique → `null` → return `{}` so the original Edit proceeds/errs).
- **Synchronous hooks, still.** Neither hook is `async`: the reformat must land, and
  Claude must see the "re-read before further edits" notice, before its next tool call
  touches the file. The notice text is identical across both events (only
  `hookEventName` differs). Success is decided by CONTENT DIFF, never exit codes, in
  both handlers. Every error/guard-failure returns `{}` (silent fail open).

## Bundled prettier (no resolver) (do not "fix" without reading this)

There is exactly ONE prettier in this process: the copy `bun build` inlines into
`mcp/server.mjs` from `src/universal-format-mcp/prettier.ts`'s
`import * as prettierNs from "prettier"`. It formats every prettier-covered file,
unconditionally. **Deliberately removed, do not re-add:** the project-local tier
(`createRequire(cwd).resolve("prettier")`), the PATH tier (`onPath("prettier")`), the
plugin-installed copy under the plugin data dir, the `npx --yes prettier` safety net, the
`resolvePrettierSource` predicate, `loadPrettier`/`loadedPrettiers`, `isToolAvailable`,
`guardPrintWidthArgv`, and the six prettier `REGISTRY` entries. `format_pre` owns every
prettier language end to end; `format_post` returns `{}` for them (both hooks carry the
same `Write|Edit` matcher, so coverage is identical).

Two consequences, both accepted:

- **A project's own prettier version no longer wins.** Every project is formatted by the
  bundled version even when it pins another one in `devDependencies` or has one on
  `PATH`; a project's CI `prettier --check` may then disagree with what this plugin
  wrote. The escape hatch is `.prettierignore`.
- **Third-party prettier plugins are best-effort.** See `resolveConfigPlugins` below.

**Project-level prettier CONFIG discovery is unchanged.** `formatInProcess` still calls
`resolveConfig(filePath, { editorconfig: true })`, so `.prettierrc*`, `prettier.config.*`,
a top-level `"prettier"` key in `package.json`/`package.yaml` and `.editorconfig` are all
honored exactly as before — only _which prettier module runs_ was simplified.

**`resolveConfigPlugins` exists because a bundled prettier resolves `plugins:` against
the SERVER process's cwd, not the session's** (verified: from a foreign cwd `format()`
throws `Cannot find package '<pp>' imported from <procCwd>/noop.js`, which the handler's
catch turns into a silent "no formatting at all" for that project). It rewrites every
non-absolute string entry to an absolute path via
`createRequire(join(cwd, "package.json")).resolve(entry)`, passes non-strings and
absolute paths through untouched, and returns `null` if any entry is unresolvable — on
`null`, `formatInProcess` returns its input unchanged, so the handler's
`formatted === input` check yields `{}`. Formatting is skipped rather than performed
without a plugin the project asked for; silently stripping `plugins` was considered and
rejected (it would write output the project never asked for, and would fail anyway for a
parser-providing plugin).

**`isPrettierIgnored` keeps the in-process path at parity with the CLI** (do not drop
it — it matters MORE now that no subprocess prettier path exists to get it for free):
`prettier --write <file>` filters even an explicitly-named file through `--ignore-path`,
which defaults to `[.gitignore, .prettierignore]` resolved against its cwd. `getFileInfo`
does NOT auto-discover those files (verified: without `ignorePath` it returns
`ignored:false`), so both are passed explicitly, joined to `cwd`; missing files are
tolerated and any error falls open to formatting. Without it, `format_pre` would reformat
a `.prettierignore`d file — including this repo's own `pnpm-lock.yaml` and its own
generated `mcp/server.mjs`.

**Config-cache invalidation is event-driven, NOT per format** (do not "fix" back):
`formatInProcess` deliberately does not call `clearConfigCache()`. Doing so per format
cost ~9.9 ms of ~10.6 ms total (measured 10.60 → 0.73 ms/format on a nested project) — it
threw away most of the warm-instance win on every single write. Instead `formatPost`
calls `clearPrettierConfigCaches()` (one guarded `clearConfigCache()` on the bundled
instance, inside a `try/catch`) when the written file's basename is in
`CACHE_INVALIDATING_BASENAMES` (`PRETTIER_CONFIG_FILENAMES` + `package.json` +
`package.yaml` + `.editorconfig` + `.prettierignore` + `.gitignore`). Three things this
depends on, all verified empirically:

- **PostToolUse is the only correct moment.** PreToolUse fires before the write, so
  clearing there would just re-cache the pre-write content on the next `resolveConfig`.
- **The check runs BEFORE the `EXT_MAP` language guard.** Most of these basenames have no
  extension (`.prettierrc`, `.editorconfig`, `.prettierignore`), so the guard would drop
  them and the cache would never clear.
- **One instance means one clear.** The old `loadedPrettiers` iteration existed only to
  reach several tiers; with a single bundled instance a single guarded call is the whole
  mechanism.

Prettier's cache is stale in all three shapes — config **created** after a negative
lookup, `.prettierrc` **edited**, `.editorconfig` **edited** (a separate cache inside
prettier, also covered by `clearConfigCache()`). Ignore files are in the trigger set for
completeness only: prettier does not cache them at all (`getFileInfo` re-reads on every
call), so clearing for them is a no-op today.

**Accepted trade-off, pinned by a test:** a config that changes without passing through
Write/Edit (a Bash `sed`, an external editor) is NOT picked up until the server restarts.
Both directions are covered in `prettier.test.mjs`, probing `semi` on a `.mjs` file —
never json/yaml `printWidth`, which `shouldOverridePrintWidth` re-reads from disk on every
call and would make the test pass for the wrong reason.

## No toggle (do not "fix" without reading this)

This plugin declares no `userConfig` — see `.claude/rules/plugin-userconfig.md`'s
exception list. Auto-formatting IS the entire plugin; disabling it is equivalent to
uninstalling. The bats suite asserts `userConfig`'s absence as a tripwire.

## Path exclusions (`isExcludedPath`)

Beyond `node_modules`/`vendor`/`.git`, `isExcludedPath` also skips two Claude-Code-owned subtrees that can land inside `cwd` when a session's working directory is broad (e.g. `$HOME`, or a repo root that nests worktrees under itself): `.claude/worktrees/` (git worktrees the harness creates — gitignored via `.claude/.gitignore`'s `worktrees/` entry — never this session's own project content) and `.claude/agent-memory/` (this repo's own gitignored "Agent runtime artifacts — local only, never pushed" directory; the same class of thing is a reasonable default exclusion for any target repo). Any file whose basename contains the literal substring `.local.` (e.g. `settings.local.json`) is also skipped, matching `.claude/.gitignore`'s own `*.local.*` personal-override convention — checked regardless of directory, not just under `.claude/`.

**Deliberately narrow — not a blanket `.claude/` exclusion.** This repo (and plenty of real projects) tracks legitimate content directly under `.claude/` — `rules/`, `agents/`, `skills/`, `settings.json` — that should keep getting auto-formatted like any other file. Only the two named subtrees are excluded; a `.claude/rules/*.md` edit still triggers `prettier` exactly as before.

## YAML/JSON line-length guard (do not "fix" without reading this)

`prettier`'s own default `printWidth` (80) drives real wrapping decisions —
verified empirically: a JSON/YAML array or flow mapping longer than 80
columns gets broken onto multiple lines by default, purely because of this
default, in a project that never asked for an 80-column limit. Unlike the
`google-java-format`/`clang-format`/`ruff`/`black` tools above,
`prettier`'s CLI auto-discovers its **own** project config when invoked bare
("native" strategy) — so a project with a real `.prettierrc`/`printWidth`
setting was always already respected. This guard only changes the _absent_
case: previously, no project config meant prettier's built-in 80-column
default applied unconditionally; now it means no line-length limit at all.

- `shouldOverridePrintWidth(file, cwd)` (used only for `json`/`yaml` inside
  `formatInProcess`; `markdown`/`css`/`scss`/`jsts` are untouched) checks the same two
  things in the same order — `hasPrettierProjectConfig`, then `resolveEditorconfig`'s
  `max_line_length` — and only when both come up empty (or resolve to `off`) does
  `formatInProcess` set `config.printWidth = 99999`: (1) `hasPrettierProjectConfig`,
  existence-only over prettier's own bundled `CONFIG_FILES` list
  (`.prettierrc*`/`prettier.config.*`) plus a top-level `"prettier"` key in
  `package.json` (parsed as JSON, `Object.hasOwn` on the top-level key only — a
  `"prettier"` entry under `devDependencies` does **not** count) or `package.yaml`
  (pnpm's `package.json` equivalent; existence-checked via an anchored
  top-level-only regex, since this file has no bundled YAML parser) — verified
  against prettier 3.9.6's own source
  (`loadConfigFromPackageJson`/`loadConfigFromPackageYaml`); (2) if that finds
  nothing, `resolveEditorconfig` (the same resolver `ruff`/`black` already use) —
  prettier already reads `.editorconfig`'s `max_line_length` natively when run bare
  (verified empirically), so a project that set it there is also left alone. One
  wrinkle: `normalizeProps` drops an explicit `max_line_length = off` entirely
  (treated the same as "not set" — see its own comment), so a project that
  deliberately turned the limit _off_ via `.editorconfig` still falls through to the
  `printWidth = 99999` override. Same net effect either way (no line-length limit),
  so this isn't a behavior bug — just worth knowing so "off" isn't mistaken for a
  case this guard skips. Only when **both** checks come up empty (or resolve to
  "off") does `config.printWidth = 99999` get set — a value large enough that no
  real line ever triggers wrapping, without passing a literal `Infinity` (prettier
  rejects that).
- **Unbounded walk, not `cwd`-bounded:** `hasPrettierProjectConfig` walks from
  the edited file's own directory all the way to the filesystem root, not
  just up to `cwd` — verified against prettier 3.9.6's own source: its config
  searcher's `stopDirectory` hook always returns `undefined`, so its real
  default search has no such bound either. Stopping at `cwd` (the way
  `findNativeConfig`/`resolveEditorconfig` do, correctly, for `ruff`/`black`/
  `.editorconfig`) would risk misdetecting "absent" for a real
  prettier config living above the project root (a workspace/monorepo case)
  — silently overriding a config this plugin never saw, the opposite of what
  this guard exists to prevent.
- **Markdown is deliberately untouched.** `prettier`'s default `proseWrap` is
  `"preserve"` — verified empirically that prettier does **not** rewrap long
  prose lines by default, so there was no default-line-length problem to fix
  for `.md` in the first place. Passing `--print-width` here would do nothing
  to prose, but does perturb _other_ formatting decisions inside a Markdown
  file (verified empirically: it changes how a fenced ` ```json ` code block
  gets wrapped) — an unrelated side effect this guard has no reason to cause.
- `.scss`'s own printWidth default is also unguarded, same as `css`/`markdown`
  — only `json`/`yaml` were reported as having this problem.

`php` is a chain of one: `php-cs-fixer`, `native` strategy (always bare, aside from `--using-cache=no`) — no `.editorconfig` mapping, no `MAPPERS` entry. Its own docs state that a bare `fix` with no `--config`/`--rules` already defaults to `@PSR12` when no `.php-cs-fixer.php`/`.dist.php` is found, and auto-discovers a project's own config when one exists. Since format success here is always judged by content diff (never exit code), its exit-code contract doesn't matter. `--using-cache=no` is required: `php-cs-fixer` caches by default, and without this flag it writes a `.php-cs-fixer.cache` file into the project root on every PHP format — the one cwd-relative side effect this plugin would otherwise have (contrast `universal-lint`'s own `tsc` cache, deliberately routed to `${CLAUDE_PLUGIN_DATA}` to avoid exactly this). No chain tool has an npm fallback of any kind; `npm view` shows their same-named npm packages are either non-existent, unrelated projects, or unofficial wrappers with no repo and near-zero downloads. Known limitation (confirmed with the user at this feature's design stage): PATH-only detection — unlike `universal-lint`'s own `tsc` special case (`node_modules/.bin/tsc`), no `vendor/bin/php-cs-fixer` discovery exists, even though most real PHP projects install it as a local Composer dev-dependency rather than globally.

**PHP_CodeSniffer's `phpcbf` was deliberately NOT added as a fallback** (do not re-add without reading this): its bare-invocation default standard is version-dependent — PSR-12 only on the brand-new PHP_CodeSniffer 4.0.x, PEAR on the still-dominant 3.x line (confirmed against PHP_CodeSniffer's own source for both versions). Pinning an explicit `--standard=PSR12` to force determinism was considered and rejected: PHP_CodeSniffer only auto-discovers a project's own `phpcs.xml`/`.phpcs.xml`(`.dist`) ruleset when NO `--standard` is given, so an explicit flag would silently defeat that discovery — trading one wrong behavior (an unpredictable PEAR/PSR-12 default) for another (ignoring a project's real ruleset). A one-tool chain was judged the honest answer, matching the existing `shell`/`scss`/`yaml`/`markdown` chain-of-one precedent.

## Built artifact (do not edit `mcp/server.mjs`)

`mcp/server.mjs` is **generated**. The source of truth is `src/universal-format-mcp/`:

| File              | Responsibility                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`        | `FormatTool`, `LangEntry`, `EditorConfigProps` (type-only)                                                                                                      |
| `util.ts`         | `walkToRoot`, `onPath` + the module-level `probeCache` singleton                                                                                                |
| `editorconfig.ts` | `findNativeConfig`, `resolveEditorconfig`, `parseEditorconfig`, `matchGlob`, `MAPPERS`, `buildInvocation`                                                       |
| `prettier.ts`     | the bundled prettier, `BUNDLED_PRETTIER_VERSION`, config discovery, `resolveConfigPlugins`, `formatInProcess`, `isPrettierIgnored`, `clearPrettierConfigCaches` |
| `registry.ts`     | `EXT_MAP`, `PRETTIER_LANGS`, `REGISTRY` (CLI chains only), `resolveInvocation`, `selectFormatter`                                                               |
| `handlers.ts`     | `isExcludedPath`, `applyEdit`, `CACHE_INVALIDATING_BASENAMES`, `formatPre`, `formatPost`                                                                        |
| `server.ts`       | MCP scaffold, `isMainModule`, `SERVER_INFO` (hand-paired with `plugin.json`), and the artifact's 17 public re-exports                                           |
| `build.mjs`       | the build driver (node-runnable; also runs under bun)                                                                                                           |

Import graph is acyclic (`types ← util ← editorconfig ← prettier ← registry ← handlers ← server`)
and relative imports use the `./x.js` specifier form, required by the root tsconfig's
`moduleResolution: "NodeNext"`; `bun build` resolves `./x.js` to `x.ts`. Module-level singletons
(`probeCache`) stay single instances — bun emits each module once, so both handlers share them.

```bash
pnpm install --frozen-lockfile          # the bundle embeds THIS prettier
pnpm run build:universal-format-mcp     # requires a local bun; CI never runs it
```

The driver writes a 3-line banner then the bundle body: `#!/usr/bin/env node`, the `@ts-nocheck`
"generated bundle" line, and `// uf-build-fingerprint src=<16hex> body=<16hex> prettier=<v> bun=<v>`.
Freshness is enforced by `test/universal-format/build-artifact.test.mjs` under
`pnpm run test:unit` — it recomputes the source hash and the body hash and compares the bundled
prettier version against the installed one, so CI needs **no bun** and no byte-reproducibility.
`bun=` is provenance only, never asserted: bun is pinned nowhere in this repo and byte-equality
across bun versions is not claimed.

Every flag is load-bearing:

| Flag / setting                                      | Why                                                                                                                                                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--target=node`                                     | bun's default target is `browser`. With `node`, built-ins stay external imports and no bun shims are emitted — verified: 0 occurrences of `Bun.` and of `import.meta.require`, runs under plain `node`.                                                |
| `--format=esm`                                      | named exports must survive for `node --test`; `import.meta.url` must stay real (`isMainModule` depends on it).                                                                                                                                         |
| `cwd: repoRoot` on the spawn                        | bun embeds cwd-relative `// <module path>` provenance comments; building from a parent directory changed 20 comment lines. Pinning cwd makes the output caller-independent. Run `pnpm install` in the tree you build from so `node_modules` is local.  |
| comment canonicalization                            | `node_modules/.pnpm/<pkg>/node_modules/` → `node_modules/` inside `// `-prefixed lines only; hoisted and pnpm-symlinked layouts then produce identical sha256.                                                                                         |
| banner prepended by the script (not `--banner`)     | the shebang must be byte one and the fingerprint must be computed over the final body.                                                                                                                                                                 |
| `@ts-nocheck` on line 2                             | the artifact sits under `plugins/**/*.mjs`, which the root `tsconfig.json` `include` glob matches directly; unchecked it reports thousands of `TS7006`-class errors. It also exempts the file from the JSDoc floor (see `.claude/rules/jsdoc-mjs.md`). |
| `chmodSync(0o755)`                                  | per `.claude/rules/hooks-executable.md`. The file is already git mode `100755` and `core.fileMode=false`, so a rebuild in place needs no `git update-index --chmod=+x`.                                                                                |
| **not** `--minify`                                  | ~8% gzip saving is not worth losing line-numbered stack traces in a fail-open code path.                                                                                                                                                               |
| **not** `--reject-unresolved`                       | prettier resolves a project's config file through a runtime `import()` of a computed path, unresolvable at build time _by design_.                                                                                                                     |
| **not** `--production` / `--bytecode` / `--compile` | `--production` implies minification, `--bytecode` forces CJS, `--compile` emits a standalone bun executable — all three contradict a node-runnable ESM artifact.                                                                                       |

Measured: ~5.4 MB, `node --check` clean in 0.13 s, byte-identical on repeated builds in one tree,
runs under both `node` and `bun`, import ≈113 ms, first format ≈30 ms, warm format ≈1.3 ms. The
whole prettier package (all 13 parser plugins) is bundled on purpose: prettier delegates embedded
`html`/`graphql`/`css` blocks inside Markdown to those parsers, so trimming would silently break
accepted inputs. `eslint.config.mjs` and `.prettierignore` both exclude the artifact.

## Tests

`test/universal-format/` — split into one `.bats` file per language/tool
(`scaffold.bats`, `core.bats`, `go.bats`, `kotlin.bats`, `java.bats`,
`python.bats`, `jsts.bats`, `json.bats`, `yaml.bats`, `markdown.bats`,
`css.bats`, `php.bats`), mirroring `test/coding-toolbox/`'s split. `test_helper.bash`
holds what's shared across files (`common_setup`, `rg_or_grep`, `make_stub`,
`rec_stub`, and `_mcp_call` — the single async-safe JSON-RPC driver over the MCP
server, held open via a FIFO and polled for the `"id":2` response, wrapping
`format_file_call`/`pre_tool_use_write_call`/`pre_tool_use_edit_call`). Hermetic:
stub formatters on an isolated `PATH` recording argv, no real network — the
prettier-language suites need **no stubs at all**, since the bundled prettier needs
no network and no PATH entry. The prettier-language `printWidth` policy is asserted
on produced content rather than on a recorded argv. Plus
`test/universal-format/*.test.mjs` (`node:test` unit tests for the `.editorconfig`
resolver, registry flag mapping, the in-process prettier contract in
`prettier.test.mjs`, and artifact freshness in `build-artifact.test.mjs`). Run:

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/universal-format/
pnpm run test:unit
pnpm run typecheck
pnpm run lint
```
