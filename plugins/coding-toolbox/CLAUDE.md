# CLAUDE.md — coding-toolbox

- Mechanically enforces "golden behavior rules" via three hooks: a `PreToolUse` command hook (`encoding-guard.mjs`), a `Stop` `mcp_tool` hook (`interaction_gate`), and a `PostToolUse` `mcp_tool` hook (`worktree_refresh`) — the two `mcp_tool` hooks are backed by a self-contained, stateless MCP server (`mcp/server.mjs`). See `plugins/coding-toolbox/hooks/CLAUDE.md` for the Stop gate and encoding-guard design, and `plugins/coding-toolbox/mcp/CLAUDE.md` for the MCP server and `worktree_refresh` design.
- The full golden-rules document lives, unwired, at `skills/setup-rules/references/golden-rules.md` (there is no `SessionStart` hook); `setup-rules` is the only way to get it onto a machine (user-level, every project you open there), opt-in.
- The plugin's `userConfig` entry is `worktree_refresh` (fail-open, default `true`) gating the `worktree_refresh` hook — the Stop gate and encoding guard have no toggle of their own.
- The `npm-ci-on-worktree` hook lives in the `npm-automations` plugin, not here.

## Hooks

- `interaction_gate` (Stop) and `encoding-guard.mjs` (PreToolUse): `plugins/coding-toolbox/hooks/CLAUDE.md`.
- `worktree_refresh` (PostToolUse/EnterWorktree) and the MCP server launcher: `plugins/coding-toolbox/mcp/CLAUDE.md`.

## Skills

Each `skills/<name>/` has its own `CLAUDE.md` with that skill's design detail, loaded on demand when Claude reads files there.

`SKILL.md` files in this plugin must capture `$CLAUDE_PLUGIN_ROOT` via bare `${CLAUDE_PLUGIN_ROOT}` substitution, never a `!`-injected shell command — see `.claude/rules/coding-toolbox-skill-plugin-root.md`.

`fresh-pr` and `feature-development` dispatch async subagents and must carry the subagent reconciliation gate (canonical gate block, harness facts, per-skill placement) — see `.claude/rules/coding-toolbox-subagent-reconciliation.md`.

## Tests

See `test/coding-toolbox/CLAUDE.md` for the suite layout and coverage.
