# CLAUDE.md — universal-format

Auto-formatter plugin backed by a self-contained zero-dep MCP stdio server
(`mcp/server.mjs`), launched via a bun-preferred `bin/mjs-launch.sh` wrapper. Two
`mcp_tool` hooks on `Write|Edit`: **PreToolUse `format_pre`** formats prettier
languages (JS/TS, JSON, YAML, Markdown, CSS, SCSS) in-process BEFORE the write via
`hookSpecificOutput.updatedInput`; **PostToolUse `format_post`** formats the
remaining languages (Shell/Java/Kotlin/Python/Go/PHP) on disk after the write via
each tool's CLI, and also covers prettier languages when no in-process prettier is
available. No `userConfig` — the hooks ARE the plugin (see "No toggle").

## Architecture (do not "fix" without reading this)

- **One MCP server, two tools.** `.mcp.json` registers `universal-format-hooks`
  (`command: ${CLAUDE_PLUGIN_ROOT}/bin/mjs-launch.sh`, `args:
["${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs"]`, `env.CLAUDE_PLUGIN_DATA`). Both hooks
  reference the runtime-namespaced `plugin:universal-format:universal-format-hooks`
  (NOT the bare `.mcp.json` key — that fails to connect). `timeout: 60`, no `async`,
  no `if` on either. All logic lives in `mcp/server.mjs`; the old
  `hooks/format-file.mjs` command hook is deleted.
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

## Prettier resolution — shared 3-tier resolver + npx safety net (do not "fix" without reading this)

`resolvePrettierSource(cwd)` is a pure predicate both handlers call so exactly one
formats each prettier file (no cross-call signaling). A project's own prettier ALWAYS
wins; the managed copy is NEVER preferred over PATH prettier; npx is only ever the
final resort:

1. **project-local importable** — `createRequire(join(cwd,"package.json")).resolve("prettier")` → `in-process` (PreToolUse, warm import).
2. **else prettier on PATH** — `onPath("prettier")` → `path-subprocess` (PostToolUse, direct binary; `guardPrintWidthArgv` for json/yaml).
3. **else managed copy** under `${CLAUDE_PLUGIN_DATA}/prettier/current` → `in-process` (PreToolUse, warm import).
4. **else `npx --yes prettier`** — the retained final safety net, reached in
   `format_post`'s existing chain on the `none` case. This is NOT a resolver kind.

Tiers 1/2 are cached per `cwd` for the server lifetime; tier 3 is re-checked live so a
just-completed lazy install is picked up on the next Write. `format_pre` handles only
tiers 1/3 (in-process); on tier 2 or non-prettier it returns `{}`; on `none` it fires
the lazy install out of band and returns `{}`. `format_post` returns `{}` for a
prettier language on tier 1/3 (already handled), fires the lazy install on `none` and
falls through to the existing chain (→ npx), and runs the direct binary on tier 2.
`prettier.clearConfigCache()` is called before every `resolveConfig` so a mid-session
`.prettierrc*`/`.editorconfig`/`package.json` prettier change is honored. In-process
json/yaml sets `printWidth = 99999` iff `shouldOverridePrintWidth(file,cwd)` (the
in-process mirror of the subprocess `guardPrintWidthArgv`).

**The `npx --yes prettier` fallback is RETAINED and LIVE** (do not remove):
`PRETTIER_NATIVE`/`PRETTIER_LINE_LENGTH_GUARDED` keep `npmSpec: "prettier"`;
`NPX_SPAWN_TIMEOUT_MS` (55 s) is retained; `isToolAvailable`/`selectFormatter`'s npx
pass and `format_post`'s npx else-branch all move verbatim and stay reachable. The
managed copy replaces npx only as the NORMAL path for prettier-less projects (tier-3
in-process), not by removing it.

## Managed prettier copy under `${CLAUDE_PLUGIN_DATA}` (do not "fix" without reading this)

Pinned to `MANAGED_PRETTIER_VERSION = "3.9.6"` (aligned with the repo's `prettier`
devDependency). Layout: `versions/<pin>-<rand>/node_modules/prettier` (npm `--prefix`
target), `current` (symlink, atomically flipped, only ever points at a COMPLETE tree),
`.last-check` (daily marker).

- **Lazy install (first tier-none miss, non-blocking).** A module-level state machine
  (`idle → installing → done|failed`) fires `spawn npm install --no-save
--no-package-lock --no-audit --no-fund --loglevel=error --prefix <staging>
prettier@<pin>` with `cwd` inside `${CLAUDE_PLUGIN_DATA}` — async `spawn`, NEVER
  awaited, `INSTALL_TIMEOUT_MS = 120000`. The hook returns `{}` immediately. On clean
  `exit(0)` AND a version sanity check, it publishes via a temp symlink + `rename()`
  onto `current` (atomic on POSIX), then GCs other versions. A reader never sees a
  half-installed tree. One attempt per server lifetime after a failure.
- **Race-safe / fail-open.** Concurrent sessions each stage into a unique dir and each
  atomically flip `current`; last flip wins, all point at a complete pinned tree. Every
  failure (no npm / no network / disk full / non-zero exit / timeout / wrong version /
  `${CLAUDE_PLUGIN_DATA}` unset) is a silent no-op that leaves `current` untouched; the
  npx net keeps formatting prettier files meanwhile — a failed/absent install is never
  a formatting regression.
- **Daily reconcile-to-pin (at server start, fire-and-forget, never awaited).** Rate-
  limited to at most 1 per 24 h via `.last-check` (written FIRST, claiming the window,
  so a failed/offline check still counts and rapid restarts do at most one). Only if a
  managed copy EXISTS and its version differs from the pin does it reinstall (local
  version-string compare — NO npm-registry query; npm shelled out only to reinstall),
  using the same staging + atomic-flip mechanism. Never eager-installs when no copy
  exists. Only ever touches the managed copy — never a project's prettier or a PATH
  prettier. An already-imported in-memory prettier is NOT re-imported; a new version
  takes effect only on the next server start.

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

- `guardPrintWidthArgv` (used only by `json`/`yaml`'s prettier entry,
  `PRETTIER_LINE_LENGTH_GUARDED` — `markdown`/`css`/`scss`/`jsts` keep plain
  `PRETTIER_NATIVE`, untouched) checks two things in order: (1)
  `hasPrettierProjectConfig`, existence-only over prettier's own bundled
  `CONFIG_FILES` list (`.prettierrc*`/`prettier.config.*`) plus a top-level
  `"prettier"` key in `package.json` (parsed as JSON, `Object.hasOwn` on the
  top-level key only — a `"prettier"` entry under `devDependencies` does
  **not** count) or `package.yaml` (pnpm's `package.json` equivalent; existence-
  checked via an anchored top-level-only regex, since this file has no bundled
  YAML parser) — verified against prettier 3.9.6's own source
  (`loadConfigFromPackageJson`/`loadConfigFromPackageYaml`); (2) if that finds
  nothing, `resolveEditorconfig` (the same resolver `ruff`/`black`
  already use) — prettier already reads `.editorconfig`'s `max_line_length`
  natively when run bare (verified empirically), so a project that set it
  there is also left alone. One wrinkle: `normalizeProps` drops an explicit
  `max_line_length = off` entirely (treated the same as "not set" — see its
  own comment), so a project that deliberately turned the limit _off_ via
  `.editorconfig` still falls through to `--print-width` below. Same net
  effect either way (no line-length limit), so this isn't a behavior bug —
  just worth knowing so "off" isn't mistaken for a case this guard skips.
  Only when **both** checks come up empty (or resolve to "off") does
  `--print-width 99999` get appended — a value large enough that no real line
  ever triggers wrapping, without passing a literal `Infinity` (prettier's CLI
  argument parser rejects that).
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

`prettier` additionally falls back to `npx --yes prettier ...` when absent
from `PATH` (a verified-official npm package; `npx` itself is assumed
present since the plugin's own hook script already requires node/npm — no
separate onboarding step). No other chain tool gets an npx fallback: `npm
view` shows their same-named npm packages are either non-existent, unrelated
projects (name collisions), or unofficial/unverifiable wrappers with no repo
and near-zero downloads — adding a fallback for those would silently run
the wrong or unvetted code.

`php` is a chain of one: `php-cs-fixer`, `native` strategy (always bare, aside from `--using-cache=no`) — no `.editorconfig` mapping, no `MAPPERS` entry. Its own docs state that a bare `fix` with no `--config`/`--rules` already defaults to `@PSR12` when no `.php-cs-fixer.php`/`.dist.php` is found, and auto-discovers a project's own config when one exists. Since format success here is always judged by content diff (never exit code), its exit-code contract doesn't matter. `--using-cache=no` is required: `php-cs-fixer` caches by default, and without this flag it writes a `.php-cs-fixer.cache` file into the project root on every PHP format — the one cwd-relative side effect this plugin would otherwise have (contrast `universal-lint`'s own `tsc` cache, deliberately routed to `${CLAUDE_PLUGIN_DATA}` to avoid exactly this). `php-cs-fixer` gets no `npmSpec`: Composer-distributed, not npm-distributed. Known limitation (confirmed with the user at this feature's design stage): PATH-only detection — unlike `universal-lint`'s own `tsc` special case (`node_modules/.bin/tsc`), no `vendor/bin/php-cs-fixer` discovery exists, even though most real PHP projects install it as a local Composer dev-dependency rather than globally.

**PHP_CodeSniffer's `phpcbf` was deliberately NOT added as a fallback** (do not re-add without reading this): its bare-invocation default standard is version-dependent — PSR-12 only on the brand-new PHP_CodeSniffer 4.0.x, PEAR on the still-dominant 3.x line (confirmed against PHP_CodeSniffer's own source for both versions). Pinning an explicit `--standard=PSR12` to force determinism was considered and rejected: PHP_CodeSniffer only auto-discovers a project's own `phpcs.xml`/`.phpcs.xml`(`.dist`) ruleset when NO `--standard` is given, so an explicit flag would silently defeat that discovery — trading one wrong behavior (an unpredictable PEAR/PSR-12 default) for another (ignoring a project's real ruleset). A one-tool chain was judged the honest answer, matching the existing `shell`/`scss`/`yaml`/`markdown` chain-of-one precedent.

## Tests

`test/universal-format/` — split into one `.bats` file per language/tool
(`scaffold.bats`, `core.bats`, `go.bats`, `kotlin.bats`, `java.bats`,
`python.bats`, `jsts.bats`, `json.bats`, `yaml.bats`, `markdown.bats`,
`css.bats`, `php.bats`, `managed-prettier.bats`), mirroring `test/coding-toolbox/`'s
split. `test_helper.bash` holds what's shared across files (`common_setup`,
`rg_or_grep`, `make_stub`, `rec_stub`, a JSON-RPC driver over the MCP server —
`format_file_call`/`pre_tool_use_write_call`/`pre_tool_use_edit_call`). Hermetic:
stub formatters (and, for `managed-prettier.bats`, a stub `npm`) on an isolated
`PATH` recording argv, no real network. `managed-prettier.bats` drives the
lazy-install/daily-check state machine end to end over JSON-RPC with a per-test
`${CLAUDE_PLUGIN_DATA}`. Plus `test/universal-format/*.test.mjs` (`node:test` unit
tests for the `.editorconfig` resolver, registry flag mapping, and the in-process
prettier contract in `prettier.test.mjs`). Run:

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/universal-format/
pnpm run test:unit
pnpm run typecheck
```
