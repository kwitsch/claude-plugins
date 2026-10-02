# CLAUDE.md — universal-format

Auto-formatter plugin backed by a plugin-local MCP stdio server, launched via the optional bun-preferred `bin/mjs-launch.sh`. `mcp/server.mjs` is a generated bundle; sources, internals and build mechanics live in `src/universal-format-mcp/` — read its `CLAUDE.md` before changing formatter behavior.

## Hooks

Four `mcp_tool` hooks on one server (`hooks/hooks.json`):

- **PreToolUse `format_pre`** (`Write|Edit`): formats the thirteen prettier languages (JS/TS, JSON, YAML, Markdown, CSS, SCSS, LESS, HTML, Vue, GraphQL, Shell, Java, PHP) in-process BEFORE the write via `hookSpecificOutput.updatedInput`, always with the prettier bundled into the server.
- **PostToolUse `format_post`** (`Write|Edit`): formats Kotlin/Python/Go/Rust on disk after the write via each tool's CLI; returns `{}` for every prettier language.
- **CwdChanged `cwd_changed`**: formats nothing — drops the old directory's cached ignore state and primes the new one's.
- **PostToolUse:EnterWorktree `worktree_entered`** (matcher `EnterWorktree`): same cache priming as `cwd_changed`, plus a session-lifetime cwd override — `CwdChanged` never fires when `EnterWorktree` moves a background-job session's cwd into a worktree (verified live). Do not remove the override on the theory that `CwdChanged` covers it.

No `userConfig` — the hooks ARE the plugin (see "No toggle").

## Architecture (do not "fix" without reading this)

- **Explicit hook `input` field, one per `mcp_tool` hook — REQUIRED, not decorative.**
  - An omitted `input` delivers a literal `arguments: {}`, not the full hook JSON (live-verified on Claude Code 2.1.226): every handler silently no-ops.
  - Each hook reconstructs exactly the fields its handler reads via `${...}` placeholders in `hooks/hooks.json`; add a placeholder there whenever a handler starts reading a new field. Apply the same to every new `mcp_tool` hook (`.claude/rules/hooks-mcp-tool-event-matrix.md`, `GLOBAL_MECHANICS`).
  - Substitution is string-only: a boolean source field (`tool_input.replace_all`, `tool_response.success`) arrives as the STRING `"true"`/`"false"`. `formatPre`/`formatPost` compare both forms (`=== true || === "true"`, `=== false || === "false"`) — do not "simplify" to a bare boolean comparison.
  - Pinned by `scaffold.bats`: "every mcp_tool hook declares an explicit input field" plus one shape-assertion test per hook.
- **One MCP server, four tools.**
  - `.mcp.json` registers `universal-format-hooks` (`command: ${CLAUDE_PLUGIN_ROOT}/bin/mjs-launch.sh`, `args: ["${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs"]`, no `env`).
  - Hooks reference the runtime-namespaced `plugin:universal-format:universal-format-hooks`, NOT the bare `.mcp.json` key (that fails to connect).
  - Every hook: `timeout: 60`, no `async`, no `if`. `CwdChanged` carries no `matcher` (the event ignores one); `worktree_entered`'s matcher is the literal tool name `EnterWorktree`.
  - All logic lives in `mcp/server.mjs`; the plugin writes nothing outside the project (`${CLAUDE_PLUGIN_DATA}` unused).
- **`bin/mjs-launch.sh` ships for repo parity, NOT for speed.**
  - bun is not meaningfully faster than node here (benchmarked). The bar for any bun-specific work: bun warm p50 ≥ 20% lower AND bun first format ≤ node's.
  - Do not "restore" a direct-`.mjs` invocation on performance grounds; do not claim bun is faster, and do not add a `Bun.*` fast path or a second runtime-optimized bundle, without a new benchmark clearing that bar.
  - The wrapper uses the APPEND-PATH form (inherited PATH wins over `~/.local/bin`/`~/.bun/bin`) so a stale user-dir binary cannot shadow a system tool.
  - The source detects its runtime (`process.versions.bun`) for a startup stderr diagnostic ONLY; it never branches behavior.
- **`format_pre` never sets `permissionDecision`.** Only `updatedInput` (+ the `additionalContext` reformat notice): `"allow"` would auto-approve every Write/Edit, `"defer"` would drop the mutation.
  - For Edit it emits a WHOLE-FILE SWAP: `updatedInput = { file_path, old_string: <entire pre-edit file>, new_string: <formatted whole file>, replace_all: false }`. Formatting only the Edit fragment is broken.
  - `applyEdit` mirrors Claude Code's Edit contract (not-found / non-unique → `null` → return `{}` so the original Edit proceeds/errs).
- **Hooks stay synchronous.** The reformat must land, and Claude must see the "re-read before further edits" notice, before its next tool call touches the file. The notice text is identical across both events (only `hookEventName` differs).
- **Success is decided by CONTENT DIFF, never exit codes.** Every error or guard failure returns `{}` (silent fail open).

### Scope rules (do not restore what was removed)

- **`cwd` is a hint, never a gate; `resolveBase` is the anchor.**
  - There is no outside-cwd guard: a Write/Edit to any path is formatted, even a file in no project.
  - `resolveBase` picks `cwd` when it contains the file, else the nearest ancestor holding a `.git` entry (file or directory; stops at `$HOME`), else the file's own directory. Everything project-scoped anchors on that base, so an out-of-cwd file is formatted against its own project's config.
  - Do not re-add a project-membership gate, and do not "simplify" `relativeIfContains` to a `startsWith` prefix test (it rejected every file when the directory had a trailing separator or was `/`).
  - Mechanics: `src/universal-format-mcp/CLAUDE.md`.
- **`.gitignore` is NOT an ignore source.** The one source is `<base>/.prettierignore` — deliberately not CLI parity: "not tracked by git" and "must not be reformatted" are different questions. Do not restore `.gitignore`.
- **One bundled prettier; no resolver.**
  - Every project is formatted by the bundled version, never the project's own or one on `PATH`; `.prettierignore` is the escape hatch. Do not re-add project-local / PATH / plugin-data / `npx` tiers.
  - Project-level prettier CONFIG discovery is unchanged (`.prettierrc*`, `prettier.config.*`, `package.json` `"prettier"` key, `.editorconfig`).
  - Shell/Java/PHP use bundled prettier plugins with NO CLI fallback: a plugin that cannot parse a file throws, the handler returns `{}`, the write proceeds unformatted. Kotlin/Python/Go/Rust stay on CLIs because no viable prettier plugin exists for them.
- **No second prettier-config store.** Config discovery is prettier's own `resolveConfig`; caches are invalidated by events (Write/Edit of a config file, `cwd_changed`), never per format.
- **Never set a prettier plugin OPTION from this code** (in particular never `experimentalWasm`): the project's prettier config is the only knob.

## No toggle (do not "fix" without reading this)

This plugin declares no `userConfig` — see `.claude/rules/plugin-userconfig.md`'s exception list. Auto-formatting IS the entire plugin; disabling it is equivalent to uninstalling. The bats suite asserts `userConfig`'s absence as a tripwire.

## Built artifact (do not edit `mcp/server.mjs`)

- `mcp/server.mjs` and the three `.wasm` sidecars next to it (`web-tree-sitter.wasm`, `tree-sitter-java_orchard.wasm`, `main.wasm`) are GENERATED. Never hand-edit them; rebuild with `pnpm run build:universal-format-mcp` (needs a local bun; CI never runs it).
- After editing anything under `src/universal-format-mcp/`, rebuild before commit — `test/universal-format/build-artifact.test.mjs` (under `pnpm run test:unit`) fails on a stale bundle.
- **Deliberate exception to the zero-dep single-file `mcp/server.mjs` convention** (`plugins/CLAUDE.md`, `.claude/rules/hooks-mcp-server.md`): a committed `bun build` bundle (prettier plus its java/php/shell plugins inlined) PLUS three committed `.wasm` sidecars in `mcp/`, launched via the optional bun-preferred `bin/mjs-launch.sh`.
  - It stays bundled because the plugin runs from a versioned cache copy with no `node_modules` and no install step. Rationale and build mechanics: `src/universal-format-mcp/CLAUDE.md`.

## Related docs

- Source internals, caching, path exclusions, build: `src/universal-format-mcp/CLAUDE.md`.
- `/universal-format:universal-format` command design: `plugins/universal-format/skills/universal-format/CLAUDE.md`.
- Suite layout and run commands: `test/universal-format/CLAUDE.md`.
