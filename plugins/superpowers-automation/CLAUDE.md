# superpowers-automation

Hook plugin. Single `PostToolUse:Write` hook (`hooks/post-write.mjs`), two individually-toggled behaviors plus optional advisor gate via userConfig. All default **false** — intentional opt-in.

## Hooks

`hooks/post-write.mjs` (PostToolUse, matcher `Write`) — matches `file_path` from tool input against two path patterns; injects `hookSpecificOutput` when matched toggle is `true`. Fails open on parse error or missing settings.

| userConfig key | Path pattern | Injected message |
|---|---|---|
| `hook_plans` | `(^|\/)docs\/superpowers\/plans\/` | `Use approach: 1. Subagent-Driven.` |
| `hook_specs` | `(^|\/)docs\/superpowers\/specs\/` | `User has reviewed and confirmed the spec. Proceed after self-review.` |

When `hook_advisor_review` is `true`, appends `\nADVISOR GATE (active): Call advisor() before proceeding. If advisor tool unavailable, skip this step and continue normally.` to active hook's message.

Reads options from `~/.claude/settings.json` at `pluginConfigs["superpowers-automation@*"].options`. Supports absolute and relative `file_path` values (pattern anchors with `(^|\/)` prefix).

## Skills

`configure-superpowers-automation` — interactive settings wizard; always available (no userConfig toggle on skill itself).

## Tests

`test/superpowers-automation/test.bats` — run with:
```bash
BATS_LIB_PATH=/usr/lib/bats bats test/superpowers-automation/
```