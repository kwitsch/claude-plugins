# claude-code-knowledge — dev notes

## Components
- `bin/session-cache` — SessionStart command hook: version-scoped doc cache
  manager (purge stale `cache-*`, ensure current, announce path). Never `rm`
  without a guarded `${CLAUDE_PLUGIN_DATA}`.
- `bin/redirect-guide` — PreToolUse(`Agent|Task`) command hook: reroutes
  `claude-code-guide` → `claude-code-knowledge:cc-knowledge` via `updatedInput`
  (never exit-2; that path is buggy for Agent/Task).
- `agents/cc-knowledge.md` — inherits all tools (needs Bash/curl + Read/Write +
  WebFetch). Live-docs-grounded, citation-first, never training memory.
- `skills/cck-*` — thin wrappers over `references/cck-workflow.md` +
  `references/components/<type>.md`; delegate current rules to `cc-knowledge`.

## Tests
- `test/claude-code-knowledge/test.bats` — manifest, both hooks, agent, refs,
  skills, harness selftest. Hermetic: stub `claude`, redirect `$HOME` and
  `$CLAUDE_PLUGIN_DATA`, no network.
  Run: `BATS_LIB_PATH=/usr/lib/bats bats test/claude-code-knowledge/`.

## Harness (dev-only, not shipped)
`test/claude-code-knowledge/harness/mcp-tool-hook-harness/` validates the
mcp_tool hook event-matrix knowledge encoded in `/cck-hook` and `cc-knowledge`.
- Hermetic, no Claude: `node scripts/selftest-mock.mjs` (run in CI via bats).
- Full matrix (drives real `claude -p`, dev machine only):
  `scripts/run-all.sh` (see `--dry-run` / `--include-semi`). Env overrides:
  `CLAUDE_BIN`, `CLAUDE_PERM_MODE`, `CLAUDE_MAX_TURNS`, `CLAUDE_EXTRA_FLAGS`.

## Open verification items (from the design spec §7)
Confirm against a live install before relying on them: `${CLAUDE_PLUGIN_DATA}`
export + path + update-survival; `claude`/`curl` on the hook/agent PATH; the
redirect target name (`claude-code-knowledge:cc-knowledge`); the doc URL scheme
and `llms.txt` index; that the inherit-all agent can actually write the cache;
and the `updatedInput`/`permissionDecision:"allow"` hook schema.
