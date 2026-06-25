# cave-context

Unifies caveman + context-mode into one non-competing MCP server: proxies context-mode's `ctx_*` tools and aggregates both plugins' hooks into a single handler set.

## Install

```
/plugin install cave-context@kwitsch-plugins
```

> **Before installing:** uninstall both `caveman` and `context-mode` first.
> Running cave-context alongside either plugin re-creates hook competition (duplicate PreToolUse/PostToolUse matchers) and spawns a second context-mode MCP server.

## What it does

cave-context replaces the caveman and context-mode plugins with a single component:

- **`ctx_*` tools in-process** (`mcp/server.mjs` + `mcp/embed.mjs`): serves the vendored context-mode's `ctx_*` tools in-process (imports `bin/context-mode/server.bundle.mjs` with `CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS=1`; no child-spawn), minus `ctx_stats`, `ctx_doctor`, and `ctx_upgrade` (filtered from `tools/list` and rejected on call).
- **Branch-change auto-reindex**: on every `PostToolUse`, checks the git branch of the working directory and, when it changes (the first check after startup counts), asynchronously re-runs `ctx_index` on the repo root (`source: project:<basename>`, like `init-branch`) — keeping the knowledge index current across `git checkout` / worktree switches. Fire-and-forget (never blocks the hook), single-flighted per repo root, and gated by the `branch_reindex` userConfig (default on; set to `false` to disable).
- **`compress` tool** (`mcp/compress.mjs`): a model-driven caveman compressor — string in, compressed string out. It shells to the `claude --print` CLI in an isolated session (no MCP servers, no plugins/hooks, neutral cwd), preserves frontmatter and verbatim regions (code, URLs, paths, numbers, headings), and validates the result with up to two cherry-pick-fix retries. Requires the `claude` CLI on `PATH`.
- **Aggregated hooks** (`hooks/hooks.json`): mid-session UserPromptSubmit, PreToolUse, PostToolUse, and PreCompact are `mcp_tool` hooks that delegate to `hook_*` tools on the same server. SessionStart has three `command` hooks (all `command` because SessionStart is **pre-connect** — the MCP server is not up on first run, so `mcp_tool` would fail open): (1) `bin/bnx.sh` running `hooks/sessionresume.mjs`, **matched `resume|compact`** (SessionStart matchers filter on the session source) so it fires only on resume/compact — does **not** emit the caveman ruleset; it only delegates to context-mode to restore prior-session continuity (context-mode's routing block is stripped so there is no double-injection). context-mode's storage root is set to `${CLAUDE_PLUGIN_DATA}/context-mode` (persistent — survives plugin updates) for both the upstream MCP server and the hook delegate, so its data no longer churns across versioned cache dirs. On resume/compact its `additionalContext` carries the restored continuity payload; when context-mode returns no continuity the hook omits the `hookSpecificOutput` envelope entirely and emits `{}` — it never emits `additionalContext: null` (which fails Claude Code's output-schema validation). (2) `bin/bnx.sh` running `hooks/sessionstartup.mjs`, **matched `startup`** so it fires only on a fresh start — delegates to context-mode purely for its startup-only side-effects (CLAUDE.md-capture, old-session GC, the `session_start` lifecycle anchor), injecting no continuity and always emitting `{}` (context-mode's routing block discarded), which preserves parity with context-mode's session model; mid-session capture (PostToolUse/UserPromptSubmit/PreCompact) `ensureSession`s on its own, independent of SessionStart. (3) a `cat` of `hooks/SessionStart.md` — the **sole source** of the caveman ruleset plus cave-context-adapted context-mode routing rules, injected on every source (no matcher). PreCompact is `mcp_tool` → `hook_precompact` (mid-session, server connected) — delegates context-mode's pre-context-loss resume snapshot; **best-effort**: fails open if the server is momentarily down at compact time (an accepted tradeoff — the delegated snapshot is not a hard gate). UserPromptSubmit re-emits the per-turn full reminder (its `hook_userpromptsubmit` is `mcp_tool` — a deliberate trade of a per-prompt MCP round-trip + a first-prompt connect race for one fewer shim file). **caveman reimplemented** in `mcp/caveman.mjs` — fixed at the `full` compression level (no level switching, no off switch, no runtime state).

Hook matchers exclude `hook_` tools to prevent reentrancy.

## Skills

| Skill | What it does |
|---|---|
| `cave-compress` | Compress one Markdown file in place using the caveman terse-encoding ruleset — cuts prose tokens while preserving every fact and verbatim region (code, paths, URLs, numbers, frontmatter). Model- and user-invocable (`/cave-compress <path/to/file.md>`); its `description`/`when_to_use` hint the eligible paths so the model knows when to apply it. Auto-allows `**/CLAUDE.md`, `docs/**/*.md`, `plan/**/*.md`; any other `.md` requires explicit confirmation, and the file must have a git restore point before the lossy overwrite. Now backed by the `compress` MCP tool (the tool performs the rewrite in an isolated `claude` process); the skill handles the gates and file I/O. |

## Runtime launcher

All `.mjs` scripts (the MCP server and the two SessionStart command hooks) are launched through `bin/bnx.sh`, a **node-only** bash launcher:

- Prepends `${HOME}/.local/bin` to `PATH` (non-interactive shells often miss this).
- Always uses `node` — no bun detection, no npm-package launch (context-mode is vendored and run in-process).

context-mode v1.0.162 is vendored at `bin/context-mode/` and runs in-process: `ctx_*` tools + mid-session hooks import the vendored `server.bundle.mjs`; SessionStart spawns the vendored `hooks/sessionstart.mjs`. No network access or external package download is required at runtime.

**Runtime requirement:** Node ≥ 22.5 with FTS5-capable `node:sqlite`. The vendored context-mode copy is pure-JS (no `better-sqlite3` binary). On a non-FTS5 node the hooks fail open (emit `{}` with a stderr diagnostic).

caveman compression is fixed at the `full` level — there is no `userConfig` to set and no runtime level switching.

## License & attribution

cave-context itself is licensed under the repository's MIT license (© 2026 Kwitsch).

It is a derivative/integration of two upstream plugins:

- **caveman** ([JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman)) — MIT, © 2026 Julius Brussee. cave-context's caveman ruleset (`mcp/caveman.mjs`) is adapted from caveman; its MIT notice is reproduced in [`NOTICE`](NOTICE).
- **context-mode** ([mksglu/context-mode](https://github.com/mksglu/context-mode)) — Elastic License 2.0, © 2026 Mert Koseoglu. cave-context **vendors** context-mode v1.0.162 under `bin/context-mode/` (imported in-process for `ctx_*` tools + mid-session hooks; SessionStart spawns the vendored hook script). That subtree is **ELv2-licensed** (see `bin/context-mode/LICENSE` + `bin/context-mode/NOTICE`), not MIT; ELv2 permits this redistribution + derivative use subject to shipping its LICENSE/notices, which cave-context does.
