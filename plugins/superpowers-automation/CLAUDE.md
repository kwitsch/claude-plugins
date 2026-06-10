# superpowers-automation

Hook plugin. Single `PostToolUse:Write` hook (`hooks/post-write.mjs`), two individually-toggled behaviors via userConfig. Both default **false** — intentional opt-in (unlike standard fail-open default).

## Hooks

`hooks/post-write.mjs` (PostToolUse, matcher `Write`) — matches `file_path` from tool input against two path patterns; injects `hookSpecificOutput` when matched toggle is `true`. Fails open on parse error or missing settings.

| userConfig key | Path pattern | Injected message |
|---|---|---|
| `hook_plans` | `(^|\/)docs\/superpowers\/plans\/` | `Use approach: 1. Subagent-Driven.` |
| `hook_specs` | `(^|\/)docs\/superpowers\/specs\/` | `User has reviewed and confirmed the spec. Proceed after self-review.` |

Reads options from `~/.claude/settings.json` at `pluginConfigs["superpowers-automation@*"].options`. Supports absolute and relative `file_path` values (pattern anchors with `(^|\/)` prefix).

## Skills

`configure-superpowers-automation` — interactive settings wizard; always available (no userConfig toggle on the skill itself).
