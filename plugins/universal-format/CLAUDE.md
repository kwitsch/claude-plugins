# CLAUDE.md — universal-format

Auto-formatter plugin backed by a plugin-local MCP stdio server (`mcp/server.mjs` — a committed
`bun build` bundle plus three committed `.wasm` sidecars, see "Built artifact" below), launched via
a bun-preferred `bin/mjs-launch.sh` wrapper. Four `mcp_tool` hooks — two on `Write|Edit`, one on
`CwdChanged`, one on `PostToolUse:EnterWorktree`: **PreToolUse `format_pre`** formats the thirteen
prettier languages (JS/TS, JSON, YAML, Markdown, CSS, SCSS, LESS, HTML, Vue, GraphQL, Shell, Java,
PHP) in-process BEFORE the write via `hookSpecificOutput.updatedInput`, always with the prettier
bundled into the server; **PostToolUse `format_post`** formats the four remaining languages
(Kotlin/Python/Go/Rust) on disk after the write via each tool's CLI, and returns `{}` for every prettier
language; **CwdChanged `cwd_changed`** formats nothing at all — it drops the old directory's cached
ignore state and prefetches the new directory's (see "Ignore-file caching"); **PostToolUse
`worktree_entered`** (matcher `EnterWorktree`) does the same cache priming as `cwd_changed`, plus
raises a session-lifetime cwd override, because `CwdChanged` has been observed to never fire when
`EnterWorktree` moves a background-job session's cwd into a worktree (see "Path exclusions"). No
`userConfig` — the hooks ARE the plugin (see "No toggle").

## Architecture (do not "fix" without reading this)

- **Explicit hook `input` field, one per `mcp_tool` hook — REQUIRED, not decorative
  (0.14.1 fix).** Live-verified on Claude Code 2.1.226: an `mcp_tool` hook with NO
  `"input"` field receives a literal empty `arguments: {}` — not the full hook JSON
  that `.claude/rules/hooks-mcp-server.md`'s reference `server.mjs` template previously
  assumed as the (undocumented) default. Root-caused by patching a live plugin-cache
  copy of `server.mjs` to log raw `params.arguments` and confirming `{}` for both
  `format_pre`/`format_post` on a real Write call; the official hooks docs never
  actually documented a full-JSON-passthrough default (confirmed via a docs re-check),
  so this repo's own assumption — not a version regression — was the bug. Each hook now
  reconstructs exactly the fields its handler reads, via `${...}` string-substitution
  placeholders (`hooks/hooks.json`): `format_pre` → `cwd`, `agent_id`, `session_id`,
  `tool_name`, `tool_input.{file_path,content,old_string,new_string,replace_all}`;
  `format_post` → `cwd`, `agent_id`, `session_id`, `tool_input.file_path`,
  `tool_response.success`; `worktree_entered` → `cwd`, `agent_id`, `session_id`,
  `tool_response.worktreePath`; `cwd_changed` → `agent_id`, `session_id`, `old_cwd`,
  `new_cwd`. Pinned by `scaffold.bats`'s "every mcp_tool hook declares an explicit
  input field" test plus one shape-assertion test per hook.
  **Substitution is string-only — no documented type preservation**, per the official
  docs ("string values support `${path}` substitution"): a placeholder that resolves to
  a boolean or object in the real hook JSON (`tool_input.replace_all`,
  `tool_response.success`) arrives as the STRING `"true"`/`"false"`, not a real
  boolean. `handlers.ts`'s `formatPre`/`formatPost` compare against both the real and
  the string-coerced form (`=== true || === "true"`, `=== false || === "false"`) for
  exactly these two fields — do not "simplify" back to a bare boolean comparison.
  **claude-code-knowledge and coding-toolbox's own `mcp_tool` hooks were not audited
  for this same gap** when this was found — check `hooks-mcp-tool-event-matrix.md`'s
  `GLOBAL_MECHANICS.optional_fields` note before assuming either one still gets full
  hook JSON without an explicit `input`.
- **One MCP server, four tools.** `.mcp.json` registers `universal-format-hooks`
  (`command: ${CLAUDE_PLUGIN_ROOT}/bin/mjs-launch.sh`, `args:
["${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs"]`, no `env` block). All four hooks reference the
  runtime-namespaced `plugin:universal-format:universal-format-hooks` (NOT the bare
  `.mcp.json` key — that fails to connect). `timeout: 60`, no `async`, no `if` on any of
  them; the `CwdChanged` block additionally carries no `matcher` (that event silently
  ignores one), and `worktree_entered`'s matcher is the literal tool name `EnterWorktree`
  (same idiom coding-toolbox's `worktree_refresh` already uses for the same tool). All logic
  lives in `mcp/server.mjs`; the old `hooks/format-file.mjs` command hook is deleted. This
  plugin writes nothing outside the project: `${CLAUDE_PLUGIN_DATA}` is not used at all.
- **`bin/mjs-launch.sh` is shipped for repo parity, NOT for speed.** Re-measured 2026-08-19
  on Kiwi-Tower (Linux x86_64, node v24.19.0, bun 1.3.14) via a Phase 0 benchmark (median of
  5 spawn-and-drive runs, 100 warm format_pre calls each): bun is NOT meaningfully faster
  here than node (bun warm p50 3.6 ms vs node 3.8 ms; first format bun 96.9 ms vs node
  82.1 ms). The pinned threshold (bun warm p50 ≥ 20% lower AND bun first format ≤ node's)
  is NOT met, so the single-bundle diagnostic-only design stands. Do NOT "restore" a
  direct-`.mjs` invocation on performance grounds, and do NOT claim bun is faster here,
  without a new benchmark. Wrapper uses the APPEND-PATH form (inherited PATH wins over
  `~/.local/bin`/`~/.bun/bin`) so a stale user-dir binary can't shadow a system tool.
- **The source detects its runtime (`process.versions.bun`) for a startup diagnostic
  only — it does NOT branch behavior.** `server.ts`'s module-local, non-exported
  `detectRuntime()` reads `process.versions.bun` (never a bare `Bun` identifier, so the
  node-target bundle stays free of `Bun.`/`bun:` and needs no `@types/bun`) and
  `startServer()` emits one `[universal-format-hooks] running under <node|bun>` line on
  stderr at startup. Per the fresh 2026-08-19 Phase 0 benchmark (bun not meaningfully
  faster here), there is deliberately NO `Bun.*` fast path. Do NOT add a
  `Bun.*`-branching fast path or a second runtime-optimized bundle here without a new
  benchmark clearing the pinned threshold (bun warm p50 ≥ 20% lower AND first format ≤
  node's) — that is the deferred two-bundle redesign, its own design unit.
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

**Three third-party plugins are bundled next to it** (0.11.0): `prettier-plugin-java@2.10.3`,
`@prettier/plugin-php@0.25.0` and `prettier-plugin-sh@0.16.1`, registered as the module-internal
`BUNDLED_PLUGINS` array in `prettier.ts` and appended to the `plugins` option of EVERY
`formatInProcess` call (single-branched call site; verified not to perturb any pre-existing
language). They replaced the `shell`, `java` and `php` CLI chains outright — those `REGISTRY`
entries, their `MAPPERS` and every doc describing them are deleted, and there is deliberately NO
CLI fallback: a plugin that cannot parse a file throws, the handler's `catch` returns `{}`, and the
write proceeds unformatted. Pins are **exact**: java is the LATEST release (its two `.wasm`
sidecars resolve to the bundle's own directory, so shipping them needs no path hack); shell's
`sh-syntax` dependency ships its own `main.wasm` the same way (see "Built artifact"); php's latest
is pure JS, and shell is pinned to its last pure-JS release on purpose — 0.17.0+ is WASM-only,
resolves its wasm OUTSIDE the bundle's directory and needs 539 lines of vendored TinyGo glue to
defeat a four-year-old `sideEffects` bug. Never set a plugin OPTION from this code (in particular
never `experimentalWasm`): a project's prettier config is the only knob. `prettier.ts` also arms a
stderr-only `process.on("unhandledRejection")` handler — plugin-java fires `Parser.init()` in a
module-scope IIFE, so a missing/corrupt sidecar rejects a floating promise at import time, which
without the guard KILLS the server under node (verified: exit 1) and takes down all thirteen
languages instead of just Java. Kotlin, Python and Go stay on their CLIs by survey, not by
deferral: kotlin's only plugin `spawnSync`s `java -jar` against a bundled 39.9 MB JVM jar and needs
prettier 1.x, python's has a single 2018 release pinned to a prettier git SHA, no prettier
plugin formats Go source at all, and no viable prettier plugin formats Rust source either.

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

**`isPrettierIgnored` is the ONE ignore source, and it is deliberately NOT CLI parity** (do not
"fix" it back): `prettier --write <file>` filters even an explicitly-named file through
`--ignore-path`, whose CLI default is `[.gitignore, .prettierignore]`. This plugin passes **only**
`<base>/.prettierignore` — the single module-private `PRETTIER_IGNORE_FILENAME` constant in
`prettier.ts`, read by both `readIgnoreState` and `probePrettierIgnored`. **Do not restore
`.gitignore` for CLI parity:** "not tracked by git" and "must not be reformatted" are different
questions, so a `.gitignore`d-but-not-`.prettierignore`d file (a `dist/` bundle, generated
sources, this repo's own `docs/`) IS formatted here on purpose, and `.prettierignore` is the single
opt-out users are pointed at. `getFileInfo` does NOT auto-discover ignore files (verified: without
`ignorePath` it returns `ignored:false`), so the one path is passed explicitly, joined to the
file's `base` (see "`resolveBase`" below); a missing file is tolerated and any error falls open to
formatting. Without it, `format_pre` would reformat a `.prettierignore`d file — including this
repo's own `pnpm-lock.yaml` and its own generated `mcp/server.mjs`, both of which are listed in the
root `.prettierignore` (not merely `.gitignore`) for exactly that reason.

**Config-cache invalidation is event-driven, NOT per format** (do not "fix" back):
`formatInProcess` deliberately does not call `clearConfigCache()`. Doing so per format
cost ~9.9 ms of ~10.6 ms total (measured 10.60 → 0.73 ms/format on a nested project) — it
threw away most of the warm-instance win on every single write. Instead `formatPost`
calls `clearPrettierConfigCaches()` (one guarded `clearConfigCache()` on the bundled
instance, inside a `try/catch`) when the written file's basename is in
`CACHE_INVALIDATING_BASENAMES` (`PRETTIER_CONFIG_FILENAMES` + `package.json` +
`package.yaml` + `.editorconfig` + `.prettierignore`). Three things this
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
prettier, also covered by `clearConfigCache()`). The one ignore file is spread into
`CACHE_INVALIDATING_BASENAMES` from `PRETTIER_IGNORE_BASENAMES` (a one-element set since 0.14.0)
so the set stays the single "a config-ish file was written" concept; `clearConfigCache()` really
is inert for it (prettier caches no ignore file — `getFileInfo` re-reads on every call), but it is
not inert overall: `formatPost`'s basename block has a **second** line that re-reads this
server's own ignore cache for it. See the next section.

**Accepted trade-off, pinned by a test:** a config that changes without passing through
Write/Edit (a Bash `sed`, an external editor) is NOT picked up until the server restarts.
Both directions are covered in `prettier.test.mjs`, probing `semi` on a `.mjs` file —
never json/yaml `printWidth`, which `shouldOverridePrintWidth` re-reads from disk on every
call and would make the test pass for the wrong reason.

**Ignore-file caching is event-driven too** (do not "fix" back to a per-call re-read):
`isPrettierIgnored` keeps its name, signature and `formatPre` call site, but is backed by a
module-level `ignoreCache: Map<base, { hasRules, verdicts }>` in `prettier.ts`, keyed by the
caller's **base** directory (`resolveBase`'s result — the session cwd for every in-cwd file, so
keys, hit rates and the `cwd_changed`/`worktree_entered` prime/clear calls are exactly as before)
exactly like `projectConfigCache` — never a single "current cwd" global, because concurrent
in-flight calls from sub-agents can carry different cwds against this one server process.
Out-of-cwd files add one entry per foreign project root, each holding that project's own
`.prettierignore` state; those entries live for the process lifetime, bounded by the handful of
distinct project roots one session ever writes into — the same growth class already accepted for
`projectConfigCache`. `hasRules` is derived from the base-rooted `.prettierignore`'s **content**,
not its mere existence: a `.prettierignore` holding only blank/`#` lines cannot ignore anything,
and any doubt (an unreadable file, an unusual escape) resolves to `true`, i.e. the unchanged slow
path. `verdicts` memoizes prettier's own per-path `getFileInfo` answers — sound because gitignore
matching is purely path-based, so a verdict can only change when an ignore file changes. Prettier
remains the only thing that decides whether a path matches a rule, so no ignore-dialect feature
(negation, `**`, anchoring, directory-only patterns, escapes) can silently regress; a hand-rolled
matcher was rejected for exactly that reason. Measured: 0.45 ms per repeat PreToolUse saved with
both ignore files present, 0.17 ms for ignore-less projects.

Three events refresh it, all event-driven, none on the `formatPre` hot path:

- **`formatPost` on a `.prettierignore` write** — `primePrettierIgnoreCache(base)` re-reads the
  **base-rooted** file (so a nested `sub/.prettierignore` write causes a harmless, correct re-read
  rather than mistaking the written file for the cached one). Same BEFORE-the-`EXT_MAP`-guard
  placement as the config clear, for the same reason: these basenames have no extension.
- **`cwd_changed`** — `clearPrettierIgnoreCache(old_cwd)` then `primePrettierIgnoreCache(new_cwd)`
  plus `warmPrettierConfigCache(new_cwd)`. The warm is `resolveConfig` on a probe path in the new
  directory, result discarded: it populates **prettier's own** directory-keyed config-search cache
  (1.92 ms cold → 0.25 ms for the first real format there) and stores nothing of its own. There is
  deliberately **no second prettier-config store** — `formatInProcess` still calls
  `resolveConfig(filePath, { editorconfig: true })` and `clearPrettierConfigCaches()` is still the
  invalidation.
- **Server restart** — there is no startup moment with a known cwd (MCP `initialize` carries only
  `protocolVersion`, and `SessionStart`/`Setup` fire before the server connects), so "at start" is
  populate-on-first-use, exactly like `projectConfigCache`/`hasPrettierProjectConfig`.

**Same accepted trade-off as the config cache, pinned by two tests:** an ignore file edited
out of band (a Bash `sed`, an external editor) is not picked up until a Write/Edit lands on it, a
`cd` happens, or the server restarts. The fail direction is mild — a newly ignored file gets
formatted once more. `clearPrettierConfigCaches()` deliberately does NOT touch `ignoreCache`: a
`.prettierrc` write cannot change what is ignored.

**`cwd` is a HINT, never a gate — `resolveBase` is the anchor** (`handlers.ts`, shared by both
handlers; exported and re-exported from `server.ts` so `handlers.test.mjs` can test it against the
built artifact). There is **no outside-cwd guard** any more: a Write/Edit to any path is formatted,
including a file in no project at all. `resolveBase(cwd, resolved)` (backed by
`resolveBaseAndRel`, which resolves `base` and the base-relative path together so the in-cwd
containment check is never computed twice) returns, in order: (1) `cwd`, when it is non-empty and
`relativeIfContains` says it contains the file — byte-identical behavior to before for every
in-cwd file, which is what keeps the whole existing suite a meaningful regression gate; (2)
otherwise the nearest ancestor directory of the file holding a `.git` entry, **existence-checked,
never `isDirectory()`-checked**, because a linked worktree's and a submodule's `.git` is a FILE
(found via `util.ts`'s `walkToRoot`, so there is no second hand-rolled ascent loop) — this walk
stops AT `$HOME` without checking it (a git-tracked dotfiles checkout at `$HOME` must never become
"the project" for an unrelated scratch file), and its result is memoized per file directory
(`findGitRoot`'s `gitRootCache`, process-lifetime, same accepted growth class as `ignoreCache`/
`projectConfigCache`) so an out-of-cwd session doesn't re-walk the filesystem on every hook call;
(3) otherwise the file's own directory. Everything project-scoped anchors on that `base`:
`isExcludedPath`'s input (`path.relative(base, resolved)`), `<base>/.prettierignore`, prettier
`plugins:` resolution, the `.editorconfig`/tool-native-config walk bound, the formatter
subprocess's cwd and the `ignoreCache` key — so an out-of-cwd file is formatted against **its own**
project's config. Because `base` is always an ancestor-or-equal of the file's directory, the
relative path never escapes with `..` and both bounded upward walks (`findNativeConfig`,
`resolveEditorconfig`) terminate at `base` instead of silently walking to the filesystem root.
`relativeIfContains` is `path.relative`-based on purpose: the older
`resolved !== dir && !resolved.startsWith(dir + path.sep)` form rejected **every** file when the
directory carried a trailing separator or was `/` — it silently formatted nothing for that whole
session. Do not "simplify" it back to a `startsWith` prefix test, and do not re-add a
project-membership gate — that is exactly the cwd-as-gate pattern this design removed. The only
reasons to skip are extension/language, `isExcludedPath`/`isClaudeInternalPath`, and
`<base>/.prettierignore`; a relative `file_path` with an empty `cwd` is the one unresolvable case
and returns `{}`. The notice text shows the base-relative path when `base === cwd` (so in-cwd
messages stay byte-identical) and the absolute path otherwise.

## No toggle (do not "fix" without reading this)

This plugin declares no `userConfig` — see `.claude/rules/plugin-userconfig.md`'s
exception list. Auto-formatting IS the entire plugin; disabling it is equivalent to
uninstalling. The bats suite asserts `userConfig`'s absence as a tripwire.

## Path exclusions (`isExcludedPath`)

Beyond `node_modules`/`vendor`/`.git`, `isExcludedPath` also skips two Claude-Code-owned subtrees that can land inside `cwd` when a session's working directory is broad (e.g. `$HOME`, or a repo root that nests worktrees under itself): `.claude/worktrees/` (git worktrees the harness creates — gitignored via `.claude/.gitignore`'s `worktrees/` entry — never this session's own project content) and `.claude/agent-memory/` (this repo's own gitignored "Agent runtime artifacts — local only, never pushed" directory; the same class of thing is a reasonable default exclusion for any target repo). Any file whose basename contains the literal substring `.local.` (e.g. `settings.local.json`) is also skipped, matching `.claude/.gitignore`'s own `*.local.*` personal-override convention — checked regardless of directory, not just under `.claude/`.

**Deliberately narrow — not a blanket `.claude/` exclusion.** This repo (and plenty of real projects) tracks legitimate content directly under `.claude/` — `rules/`, `agents/`, `skills/`, `settings.json` — that should keep getting auto-formatted like any other file. Only the two named subtrees are excluded; a `.claude/rules/*.md` edit still triggers `prettier` exactly as before.

**A background-job session's OWN active worktree can hit this exclusion by mistake (0.13.0 fix: `worktree_entered`).** `EnterWorktree` switches such a session's cwd into `.claude/worktrees/<name>/` for every later tool call, but `cwd` on subsequent `PreToolUse`/`PostToolUse` `Write|Edit` calls has been observed (real session transcript: zero `CwdChanged` events across a real `EnterWorktree` call, ever) to keep reporting the PRE-worktree directory. Every file in the session's own worktree then resolves, relative to that stale cwd, as `.claude/worktrees/<name>/...` — indistinguishable from another agent's scratch state — so `isExcludedPath` skips it and formatting silently stops for the rest of the session. `worktree_entered` (`PostToolUse:EnterWorktree`, reading `tool_response.worktreePath` — the same field coding-toolbox's `worktreeRefreshHandler` already prefers over `cwd` for this exact tool) is the fallback signal that actually fires; it raises an override in `handlers.ts`'s `cwdOverrides` map that `formatPre`/`formatPost` resolve through instead of trusting `args.cwd` once it's set for that agent. Do not remove this override on the theory that `CwdChanged` "should" cover it — it doesn't, in this exact scenario, as verified live.

**`cwdOverrides` is a `Map` keyed by `agent_id` (falling back to `session_id`), NEVER a bare global.** This one MCP server process is shared by every subagent running in the session — `ignoreCache`/`projectConfigCache` in `prettier.ts` are cwd-keyed for exactly the same stated reason ("concurrent in-flight hook calls from sub-agents may carry different cwds against this one long-lived server process"). A single mutable `cwdOverride` would let whichever subagent's `EnterWorktree` fires last win the override for EVERY OTHER concurrently running subagent too, silently formatting one agent's files against a sibling agent's worktree. `overrideKey()` in `handlers.ts` derives the key; a hook call with neither field resolves to `""` and is treated as un-keyable (falls through to raw `args.cwd`, i.e. today's pre-fix behavior for that one call — never crashes, never guesses). Pinned by `prettier.test.mjs`'s "concurrent subagents keep independent overrides" test.

**`isExcludedPath` is evaluated on the BASE-relative path, never on the absolute one.** Checking
absolute segments unconditionally would permanently exclude a background session's own worktree
(`<repo>/.claude/worktrees/<name>/…`) — precisely the 0.13.0 bug `worktree_entered` exists to fix.
`node_modules`/`vendor`/`.git`/`*.local.*` are position-independent and still apply on `rel`.

**`isClaudeInternalPath` closes the out-of-cwd gap, gated on `base !== cwd`.** Without it, a file
written by absolute path into a _sibling_ agent's worktree/scratch state would anchor `base` at
that worktree's own root (a worktree's `.git` is a FILE, so the git-root walk stops right there),
erasing `.claude/worktrees` from `rel` and formatting content this agent never entered. `handlers.ts`
checks the file's absolute path for `.claude/worktrees`/`.claude/agent-memory` instead, but ONLY
when `base !== cwd` — when `base === cwd`, the write is inside the session's own acknowledged
project root (including its own entered worktree, via `worktreeEntered`'s override), whose absolute
path legitimately contains `.claude/worktrees/<name>` too, and must keep formatting exactly as the
0.13.0 fix intends.

## YAML/JSON line-length guard (do not "fix" without reading this)

`prettier`'s own default `printWidth` (80) drives real wrapping decisions —
verified empirically: a JSON/YAML array or flow mapping longer than 80
columns gets broken onto multiple lines by default, purely because of this
default, in a project that never asked for an 80-column limit. Unlike the
`ruff`/`black` tools above,
`prettier`'s CLI auto-discovers its **own** project config when invoked bare
("native" strategy) — so a project with a real `.prettierrc`/`printWidth`
setting was always already respected. This guard only changes the _absent_
case: previously, no project config meant prettier's built-in 80-column
default applied unconditionally; now it means no line-length limit at all.

- `shouldOverridePrintWidth(file, cwd)` (used only for `json`/`yaml` inside
  `formatInProcess`; `markdown`/`css`/`scss`/`less`/`html`/`vue`/`graphql`/`jsts`/`shell`/`java`/`php` are untouched) checks the same two
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
- `.scss`'s own printWidth default is also unguarded, same as `css`/`less`/`markdown`/`html`/`vue`/`graphql`/`shell`/`java`/`php`
  — only `json`/`yaml` were reported as having this problem.

## Built artifact (do not edit `mcp/server.mjs`)

`mcp/server.mjs` is **generated**. The source of truth is `src/universal-format-mcp/`:

| File              | Responsibility                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`        | `FormatTool`, `LangEntry`, `EditorConfigProps` (type-only)                                                                                                                                                                                                                                                                                                                                   |
| `util.ts`         | `walkToRoot`, `onPath` + the module-level `probeCache` singleton                                                                                                                                                                                                                                                                                                                             |
| `editorconfig.ts` | `findNativeConfig`, `resolveEditorconfig`, `parseEditorconfig`, `matchGlob`, `MAPPERS`, `buildInvocation`                                                                                                                                                                                                                                                                                    |
| `prettier.ts`     | the bundled prettier and its three bundled plugins (`BUNDLED_PLUGINS`, `asPlugin`), the `unhandledRejection` startup guard, `BUNDLED_PRETTIER_VERSION`, config discovery, `resolveConfigPlugins`, `formatInProcess`, the base-keyed `ignoreCache` behind `isPrettierIgnored`, `primePrettierIgnoreCache`, `clearPrettierIgnoreCache`, `warmPrettierConfigCache`, `clearPrettierConfigCaches` |
| `registry.ts`     | `EXT_MAP`, `PRETTIER_LANGS`, `REGISTRY` (CLI chains only), `resolveInvocation`, `selectFormatter`                                                                                                                                                                                                                                                                                            |
| `handlers.ts`     | `isExcludedPath`/`isClaudeInternalPath`, `resolveBase`/`resolveBaseAndRel`/`findGitRoot`/`relativeIfContains`, `resolveTarget`, `resolveCwd`/`overrideKey`/`cwdOverrides`, `applyEdit`, `CACHE_INVALIDATING_BASENAMES`, `PRETTIER_IGNORE_BASENAMES`, `formatPre`, `formatPost`, `cwdChanged`, `worktreeEntered`                                                                              |
| `server.ts`       | MCP scaffold, `isMainModule`, `detectRuntime` (module-local, non-exported — startup stderr diagnostic only), `SERVER_INFO` (hand-paired with `plugin.json`), and the artifact's 20 public re-exports                                                                                                                                                                                         |
| `build.mjs`       | the build driver (node-runnable; also runs under bun)                                                                                                                                                                                                                                                                                                                                        |

Import graph is acyclic (`types ← util ← editorconfig ← prettier ← registry ← handlers ← server`)
and relative imports use the `./x.js` specifier form, required by the root tsconfig's
`moduleResolution: "NodeNext"`; `bun build` resolves `./x.js` to `x.ts`. Module-level singletons
(`probeCache`) stay single instances — bun emits each module once, so both handlers share them.

```bash
pnpm install --frozen-lockfile      # the bundle embeds THIS prettier
pnpm run build:universal-format-mcp # requires a local bun; CI never runs it
```

The driver writes a 3-line banner then the bundle body: `#!/usr/bin/env node`, the `@ts-nocheck`
"generated bundle" line, and
`// uf-build-fingerprint src=<16hex> body=<16hex> prettier=<v> plugins=<pins> assets=<16hex> bun=<v>`.
`plugins=` is the three exact plugin pins read from the root `package.json` (not `node_modules` —
two of the three do not export `./package.json`); `assets=` is a 16-hex hash over the copied
`.wasm` sidecars as `basename \0 bytes \0`, sorted by basename, which closes the gap that
`hashSourceTree` covers only `src/`.
Freshness is enforced by `test/universal-format/build-artifact.test.mjs` under
`pnpm run test:unit` — it recomputes the source hash and the body hash and compares the bundled
prettier version against the installed one, so CI needs **no bun** and no byte-reproducibility.
`bun=` is provenance only, never asserted: bun is pinned nowhere in this repo and byte-equality
across bun versions is not claimed.

Every flag is load-bearing:

| Flag / setting                                      | Why                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--target=node`                                     | bun's default target is `browser`. With `node`, built-ins stay external imports and no bun shims are emitted — 0 occurrences of `Bun.` and of `import.meta.require`, runs under plain `node`; the no-`Bun.`-token / no-`bun:`-import invariant is now machine-enforced by `test/universal-format/build-artifact.test.mjs`. |
| `--format=esm`                                      | named exports must survive for `node --test`; `import.meta.url` must stay real (`isMainModule` depends on it).                                                                                                                                                                                                             |
| `cwd: repoRoot` on the spawn                        | bun embeds cwd-relative `// <module path>` provenance comments; building from a parent directory changed 20 comment lines. Pinning cwd makes the output caller-independent. Run `pnpm install` in the tree you build from so `node_modules` is local.                                                                      |
| comment canonicalization                            | `node_modules/.pnpm/<pkg>/node_modules/` → `node_modules/` inside `//`-prefixed lines only; hoisted and pnpm-symlinked layouts then produce identical sha256.                                                                                                                                                              |
| banner prepended by the script (not `--banner`)     | the shebang must be byte one and the fingerprint must be computed over the final body.                                                                                                                                                                                                                                     |
| `@ts-nocheck` on line 2                             | the artifact sits under `plugins/**/*.mjs`, which the root `tsconfig.json` `include` glob matches directly; unchecked it reports thousands of `TS7006`-class errors. It also exempts the file from the JSDoc floor (see `.claude/rules/jsdoc-mjs.md`).                                                                     |
| `chmodSync(0o755)`                                  | per `.claude/rules/hooks-executable.md`. The file is already git mode `100755` and `core.fileMode=false`, so a rebuild in place needs no `git update-index --chmod=+x`.                                                                                                                                                    |
| **not** `--minify`                                  | ~8% gzip saving is not worth losing line-numbered stack traces in a fail-open code path.                                                                                                                                                                                                                                   |
| **not** `--reject-unresolved`                       | prettier resolves a project's config file through a runtime `import()` of a computed path, unresolvable at build time _by design_.                                                                                                                                                                                         |
| **not** `--production` / `--bytecode` / `--compile` | `--production` implies minification, `--bytecode` forces CJS, `--compile` emits a standalone bun executable — all three contradict a node-runnable ESM artifact.                                                                                                                                                           |

Measured: ~9.3 MB bundle plus 3,037,240 B of `.wasm` sidecars, `node --check` clean, byte-identical
on repeated builds in one tree, runs under both `node` and `bun`, import ≈246 ms (one-time per
session), warm format ≈1.6–2.0 ms (java 1.8, sh 2.0, php 1.6). The whole prettier package (all 13
parser plugins) is bundled on purpose: prettier delegates embedded `html`/`graphql`/`css` blocks
inside Markdown to those parsers, so trimming would silently break accepted inputs.
`eslint.config.mjs` and `.prettierignore` both exclude the artifact; neither matches `.wasm`, and
`EXT_MAP` has no `.wasm` entry, so nothing ever tries to format a sidecar.

**The artifact is `server.mjs` PLUS three committed `.wasm` sidecars in the same `mcp/` directory**
— `web-tree-sitter.wasm` (201,037 B), `tree-sitter-java_orchard.wasm` (447,925 B) and `main.wasm`
(2,388,278 B, sh-syntax's dormant-by-default parser — see "Three third-party plugins" above), git
mode `100644`, `*.wasm binary` in `.gitattributes`. They live exactly there because
`prettier-plugin-java` and `web-tree-sitter` load their two via `new URL(<name>, import.meta.url)`,
which after bundling resolves to the BUNDLE's own directory — independent of the dependency's
internal layout, and verified relocatable (the whole `mcp/` directory runs from a copy with no
`node_modules` above it, under node and bun; the plugin runs from a versioned plugin-cache copy,
so this matters). `sh-syntax` resolves its `main.wasm` differently — a CJS `__dirname`-relative
lookup, not `new URL` — and bun's bundler hardcodes THAT as the build machine's absolute path
unless corrected; `build.mjs`'s `containShSyntaxDirname` rewrites it to the same
import.meta.url-based resolution, anchored so the lookup still lands next to the bundle. `bun
build` cannot emit any of the three (`--outdir` + `--loader:.wasm=file` emits only the JS: all are
runtime lookups the bundler cannot see), so `build.mjs` copies them by hand — resolving each the
same way its plugin resolves it at runtime, sweeping every other `*.wasm` out of the output
directory first so a plugin bump that renames a grammar cannot leave an orphan, and fingerprinting
them into `assets=`. Never hand-edit the bundle or the sidecars.

Packaging rationale (why this stays bundled and is not un-bundled): the plugin runs from a versioned plugin-cache copy with no ancestor `node_modules`, and `bin/mjs-launch.sh` execs `bun`/`node` with no install step — so `prettier` and its java/php/shell plugins (with their `web-tree-sitter`/`sh-syntax` wasm bindings), which are root devDependencies never present under `plugins/`, are only resolvable at runtime because `bun build` inlines them into this one file. Un-bundling to bare-specifier `.mjs` imports would fail to start for every real consumer; vendoring a full `node_modules` under `mcp/` is larger and more drift-prone than today's one file plus three wasm sidecars; a runtime `pnpm install` step breaks the repo's zero-install single-file launcher convention. The wasm-sidecar copy and the `sh-syntax __dirname` rewrite are consequences of bundling, not independent reasons to un-bundle. Reopen only if Claude Code's plugin-install model ever provisions `node_modules` at runtime.

## Skill design (universal-format)

`skills/universal-format/` adds the user-only `/universal-format:universal-format` command: a
free-text file selector → colocated `format-files.mjs` driver. The driver imports `formatPre`,
`formatPost`, `EXT_MAP`, `PRETTIER_LANGS` from `../../mcp/server.mjs` (the committed bundle —
never hand-edited; namespace cast to `any` for typecheck) and reproduces the plugin's **full**
on-write formatting: Prettier languages via `formatPre` (read content → persist the returned
`updatedInput.content`), the 4 CLI languages via `formatPost` (reformats on disk itself). Per-file
fail-open; always exits 0, the printed summary is the signal. `disable-model-invocation: true`
(user-invoke-only); no `userConfig`. Invocation contract in
`skills/universal-format/format-files.reference.md`.

## Tests

`test/universal-format/` — split into one `.bats` file per language/tool
(`scaffold.bats`, `core.bats`, `go.bats`, `kotlin.bats`, `java.bats`,
`python.bats`, `rust.bats`, `jsts.bats`, `json.bats`, `yaml.bats`, `markdown.bats`,
`css.bats`, `php.bats`, `shell.bats`, `html.bats`, `vue.bats`, `graphql.bats`),
mirroring `test/coding-toolbox/`'s split. `test_helper.bash`
holds what's shared across files (`common_setup`, `rg_or_grep`, `make_stub`,
`rec_stub`, and `_mcp_call` — the single async-safe JSON-RPC driver over the MCP
server, held open via a FIFO and polled for the `"id":2` response, wrapping
`format_file_call`/`pre_tool_use_write_call`/`pre_tool_use_edit_call`). Hermetic:
stub formatters on an isolated `PATH` recording argv, no real network — the
prettier-language suites need **no stubs at all**, since the bundled prettier needs
no network and no PATH entry. The prettier-language `printWidth` policy is asserted
on produced content rather than on a recorded argv. `core.bats`'s guard-clause vehicle
is `.go` + a `gofmt` stub (it used `.sh` + a CLI shell-formatter stub until `.sh` became
a `format_pre` language), and `css.bats` also covers `.less`. Plus
`test/universal-format/*.test.mjs` (`node:test` unit tests for the `.editorconfig`
resolver, registry flag mapping, the in-process prettier contract in
`prettier.test.mjs`, artifact freshness in `build-artifact.test.mjs`, and
`bundled-plugins.test.mjs` — the three bundled plugins and the four newly routed core
languages against the built bundle, plus the structural tripwire that the
`unhandledRejection` guard is armed). Run:

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/universal-format/
pnpm run test:unit
pnpm run typecheck
pnpm run lint
```
