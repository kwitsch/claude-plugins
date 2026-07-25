# superpowers-automation

`new-work` pipeline orchestrator + `file-advisor-improver` reviser + one opt-in `PostToolUse:Write` hook. The hook (`hooks/post-write.mjs`) matches a written plan `file_path`; when `hook_plans` is `true`, injects `additionalContext` telling the main thread to implement the plan with `superpowers:subagent-driven-development` (forcing Subagent-Driven in the native flow). Toggle defaults **false** (opt-in). Fails open on parse error / missing settings.

## Hooks

| userConfig key | Path pattern                        | Injected instruction                                         |
| -------------- | ----------------------------------- | ------------------------------------------------------------ |
| `hook_plans`   | `(^\|\/)docs\/superpowers\/plans\/` | implement plan via `superpowers:subagent-driven-development` |

Reads options from `~/.claude/settings.json` at `pluginConfigs["superpowers-automation@*"].options`. Supports absolute and relative `file_path` (pattern anchors with `(^|\/)`).

## Skills

- `configure-superpowers-automation` — interactive settings wizard (`disable-model-invocation`).
- `new-work` — inline (not forked) pipeline orchestrator. Step 1 classifies the description as feature/fix/refactor, setting the branch prefix (`feature/`, `fix/`, `refactor/`) and the process skill. feature/refactor: brainstorming -> `file-advisor-improver` (spec) -> writing-plans -> `file-advisor-improver` (plan) -> subagent-driven-development. fix: `systematic-debugging` to completion (no spec/plan; the reviser/plan steps are brainstorming-path-only). Carries explicit suppression instructions so the downstream skills' auto-handoffs don't skip the reviser steps. A prominent top rule requires sub-skill-created tasks to be inserted under their parent step and numbered `Step N.x`. Model + user invocable.
- `file-advisor-improver` — `context: fork`, `model: claude-sonnet-4-6`. Reads the file passed as its argument, calls `advisor()` (clean-room; warns + skips if absent or no file), then revises the file in place. Terminal (no handoff). Unlocked (model + user invocable).

Forked skills have no conversation history, so `file-advisor-improver` takes the file via `$ARGUMENTS`. Fork mechanism (advisor availability + arg delivery inside a fork) and the `new-work` live orchestration are unverified in-session; verify after publish (`/plugin update`, then run `new-work` on a description).

## Dependency

`superpowers` (`claude-plugins-official`) — provides the `brainstorming`, `systematic-debugging`, `writing-plans`, and `subagent-driven-development` skills the `new-work` pipeline invokes.

## Tests

`test/superpowers-automation/test.bats` — run with:

```bash
BATS_LIB_PATH="$PWD/node_modules" npx bats test/superpowers-automation/
```
