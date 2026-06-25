---
paths:
  - "plugins/cave-context/bin/context-mode/**"
---

# Rule: `bin/context-mode/` is a prepared VENDORED copy — do not hand-edit

`plugins/cave-context/bin/context-mode/` is a **vendored, stripped** copy of the
upstream `context-mode` npm package (Elastic License 2.0, © 2026 Mert Koseoglu,
https://github.com/mksglu/context-mode). cave-context runs it **in-process** (the
embedded `server.bundle.mjs` for `ctx_*` tools + the `hooks/*.bundle.mjs` work
functions for the mid-session hooks) and by spawning the vendored
`hooks/sessionstart.mjs`.

## Do not hand-edit

Treat every file under this path as third-party and immutable. Bug fixes and
upstream changes are applied by **re-vendoring** (below), never by editing in place.
Editing a vendored file also violates the ELv2 obligation to mark modified copies —
so don't. (Tests in `test/cave-context/vendor.test.mjs` + `test/cave-context/test.bats`
pin the tree shape; CodeRabbit review is excluded for this path via `.coderabbit.yaml`.)

## Re-vendor procedure (apply the SAME strip set on every update)

1. `npm pack context-mode@<ver>` → tarball; record its **sha256** (verify reproducibility).
2. Extract into `plugins/cave-context/bin/context-mode/`, replacing the contents.
3. **Strip — keep only what Claude Code needs at runtime.** Remove:
   - **Foreign-platform hook adapters** — `hooks/{gemini-cli,cursor,vscode-copilot,codex,kimi,kiro,jetbrains-copilot}`.
   - **Packaging / host-integration metadata** — `.claude-plugin/`, `.codex-plugin/`, `.openclaw-plugin/`, `openclaw.plugin.json`, `skills/`, `hooks/hooks.json` (avoids Claude Code discovering nested manifests/skills).
   - **`build/` (entire tree)** — the tsc dev-output. ALL non-Claude-Code platform adapters live under `build/adapters/`. The runtime is **bundle-first** (`hooks/*.bundle.mjs`, `server.bundle.mjs`, `hooks/security.bundle.mjs`) and never falls into `build/`; upstream itself excludes `build/` from marketplace installs.
   - **`configs/*` except `configs/claude-code`** — per-platform install configs.
   - **`start.mjs`, `scripts/`, `bin/`, `README.md`** — npm-package launcher / install-heal scripts / CLI shim / upstream docs (none run: import + direct hook-script spawn only). Removing `bin/` also drops `bin/statusline.mjs`.
   - **`cli.bundle.mjs`, `insight/`** — the CLI bundle (which is where the `context-mode statusline` subcommand + ctx_insight's upgrade-hint live) and the ctx_insight localhost-dashboard sources. cave-context **denies `ctx_insight`** (a web UI superfluous for headless context routing) so its handler is never reachable, and it never spawns the CLI. **When re-vendoring, also re-add `ctx_insight` to `DENIED_UPSTREAM_TOOLS` in `mcp/server.mjs`** — the upstream bundle always registers it, so the denylist is what keeps the removed `insight/`/`cli.bundle.mjs` unreachable.
4. **Keep:** `server.bundle.mjs`, `hooks/` (the Claude Code hook scripts + `hooks/core/`, `hooks/formatters/`, the `*.bundle.mjs` work modules + shared `*.mjs`), `configs/claude-code`, `package.json` (provenance), `LICENSE`, `NOTICE`.
5. Update `bin/context-mode/NOTICE` to list every removed dir/file (ELv2 modification record) and re-state "all retained files are byte-for-byte unmodified."
6. Bump `plugins/cave-context/.claude-plugin/plugin.json` `version`.
7. **Verify before commit** (the suite alone is insufficient — exercise the dynamic-spawn tools):
   - `node --test test/cave-context/*.test.mjs` + `BATS_LIB_PATH=/usr/lib/bats bats test/cave-context/` green.
   - Embedded round-trip: `CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS=1` import of `server.bundle.mjs` → `ctx_index`→`ctx_search`, and `ctx_execute` (sandbox spawn).
   - `initSecurity` fallback fires the bundle, not `build/`: an in-process `delegateHook("PreToolUse", {tool_name:"Bash", tool_input:{command:"curl …"}})` returns a `deny`/redirect with **no** `failed to load security bundle` stderr warning.
   - Lifecycle: importing the embedded bundle adds no SIGINT/SIGTERM/uncaughtException/stdin listeners (only benign exit-time WAL-checkpoint handlers).

## Why `node:sqlite` / FTS5 (do not re-add `better-sqlite3`)

The vendored copy is pure-JS — no native `better-sqlite3` binary ships. Requires **Node ≥ 22.5** with FTS5-capable `node:sqlite`; on a non-FTS5 node the hooks fail open (`{}`) with a stderr diagnostic. Do not vendor `node_modules/` or a native addon.

## Pinned

v1.0.162, tarball sha256 `f8996a8eec4c84bcac549f343682444fc968357eec0a04980808f1dce73148a0`.
