# superpowers-automation

Hook plugin + two forked review skills. `PostToolUse:Write` hook (`hooks/post-write.mjs`) matches the written `file_path`; when the matched toggle is `true`, injects `additionalContext` instructing the main thread to invoke the matching review skill with the file path. Both toggles default **false** (opt-in). Fails open on parse error / missing settings.

## Hooks

| userConfig key | Path pattern | Injected instruction → skill |
|---|---|---|
| `hook_plans` | `(^|\/)docs\/superpowers\/plans\/` | invoke `plan-advisor-review <path>` |
| `hook_specs` | `(^|\/)docs\/superpowers\/specs\/` | invoke `spec-advisor-review <path>` |

Reads options from `~/.claude/settings.json` at `pluginConfigs["superpowers-automation@*"].options`. Supports absolute and relative `file_path` (pattern anchors with `(^|\/)`).

## Skills

- `configure-superpowers-automation` — interactive settings wizard (`disable-model-invocation`).
- `spec-advisor-review` — `context: fork`, `model: claude-haiku-4-5-20251001`. Reads the spec, calls `advisor()` (clean-room; warns + continues if absent), hands off to `superpowers:writing-plans`.
- `plan-advisor-review` — `context: fork`, `model: claude-haiku-4-5-20251001`. Reads the plan, calls `advisor()` (clean-room; warns + continues if absent), hands off to `superpowers:subagent-driven-development`.
- `save-advisor` — `context: fork`, `model: claude-sonnet-4-6`, `disable-model-invocation: true` (user-invoked only — it rewrites a file). Reads the file passed as its argument, calls `advisor()` (clean-room; warns + skips if absent or no file), then revises the file to implement the feedback. No hook, no `userConfig` toggle. Terminal (no handoff).

Forked skills have no conversation history, so they take the file via `$ARGUMENTS` and do not invoke the next skill themselves — they end with a handoff line the main thread acts on (best-effort chaining). Fork mechanism (advisor availability + arg delivery inside a fork) is unverified in-session; verify after 2.0.0 publishes (`/plugin update` then invoke a review skill on a file). If inert, flip both skills to inline.

## Dependency

`superpowers` (`claude-plugins-official`) — provides the `writing-plans` and `subagent-driven-development` skills the review skills hand off to.

## Tests

`test/superpowers-automation/test.bats` — run with:
```bash
BATS_LIB_PATH=/usr/lib/bats bats test/superpowers-automation/
```
