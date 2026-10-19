# CLAUDE.md — coding-toolbox

- Mechanically enforces "golden behavior rules" via one in-process mods hooks module (`hooks/register.ts` + pure `hooks/policy.mjs`): an encoding guard (`tool.call` on `Read|Edit|Write|Bash`), a worktree refresh (`tool.call` on `EnterWorktree`) and an interaction gate (`turn.start` + `turn.complete`). No command hook, no MCP server. See `plugins/coding-toolbox/hooks/CLAUDE.md` for all three designs and the module layout.
- The full golden-rules document lives, unwired, at `skills/setup-rules/references/golden-rules.md` (there is no `SessionStart` hook); `setup-rules` is the only way to get it onto a machine (user-level, every project you open there), opt-in.
- The plugin's `userConfig` entry is `worktree_refresh` (fail-open, default `true`), read from the module's `options`; the interaction gate and encoding guard have no toggle of their own.
- `bin/ci-watch.sh` is the only `bin/` executable (used by the `ci-watcher` agent).
- The `npm-ci-on-worktree` hook lives in the `npm-automations` plugin, not here.

## Skills

Each `skills/<name>/` has its own `CLAUDE.md` with that skill's design detail, loaded on demand when Claude reads files there.

`SKILL.md` files in this plugin must capture `$CLAUDE_PLUGIN_ROOT` via bare `${CLAUDE_PLUGIN_ROOT}` substitution, never a `!`-injected shell command — see `.claude/rules/coding-toolbox-skill-plugin-root.md`.

`fresh-pr` and `feature-development` dispatch async subagents and must carry the subagent reconciliation gate (canonical gate block, harness facts, per-skill placement) — see `.claude/rules/coding-toolbox-subagent-reconciliation.md`.

## Tests

See `test/coding-toolbox/CLAUDE.md` for the suite layout and coverage.
