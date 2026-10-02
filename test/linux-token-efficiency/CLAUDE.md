# CLAUDE.md — test/linux-token-efficiency

## Tests

- **Run:** `BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/linux-token-efficiency/` plus `pnpm run test:unit` for the `*.test.mjs` suites.
- Hermetic by construction; conventions in `.claude/rules/test-conventions.md`.

### Fixtures

- Every fixture is fabricated and a few bytes. The real 279.6 MiB cbm binary is never downloaded or extracted; no test reaches the network.
  - Releases: an ephemeral 127.0.0.1 server (`RTK_DOWNLOAD_BASE_URL` / `RTK_RELEASE_BASE_URL` / `CBM_DOWNLOAD_BASE_URL` point at it) or a stubbed `curl`.
  - cbm: a fake MCP-speaking binary in a fixture plugin tree.
  - Hooks: a copy of the hook in a fake plugin tree with a stub `rtk`.
  - Launcher: stubbed `bunx`/`npx` on an isolated `PATH`; the real runners and the npm registry are never touched.

### Tripwires — do not "fix" by editing the test

- `output-style.bats`'s ≤ 40-line cap on `output-styles/terse.md`: raising it is a design decision, not a test fix.
- `context-mode.bats` pins the `hooks.json` shape: `PreToolUse` matchers exactly `["Bash","Grep|Glob","WebFetch"]`, `PostToolUse` length 1, every `mcp_tool` handler on the namespaced cbm server, no `context_guidance` literal; plus byte-for-byte guards on `hooks/SessionStart.md` (`.prettierignore` / `.coderabbit.yaml`).
- `cbm-hooks.bats` pins the cbm hook wiring (`mcp_tool` on the namespaced server with explicit `input`, `SessionStart` as a `command` hook) and that the `rtk` Bash entry stays a `command` hook.
- `docs.bats` pins headings and literals of this plugin's `CLAUDE.md` files and `hooks.json`'s `description` (including the "Nine hooks total." count tied to the actual hook count) — update the doc and the pin together.
- Executable-bit assertions read the git **index** (`git ls-files -s`), not the working tree: the suite runs before the adding commit exists.
