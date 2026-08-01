# parse-args — script reference

**Invoke:** `bash ${CLAUDE_SKILL_DIR}/parse-args.sh <path-to-file-containing-verbatim-argument-text>`

Read-only (besides the one input-file read): resolves `$ARGUMENTS`' verbatim
text into a `golden_rules`/`tools` yes/no/unset answer pair, exactly
replacing Step 3b's two `AskUserQuestion` answers when a verbatim invocation
is given. Pure string processing — no external CLI.

The argument text is passed as a **file path**, never embedded directly into
the Bash tool call (as a bare shell argument or inside a heredoc). `$ARGUMENTS`
is a pre-injection text substitution — by the time SKILL.md's invoking step is
read, the placeholder has already been replaced with the user's literal,
possibly-adversarial text — and a heredoc's own delimiter can be collided
with adversarial input (a body line matching the delimiter terminates it
early, turning the remaining text into ordinary shell input in the same
command). Writing the raw bytes to a file via the `Write` tool sidesteps this
entirely: no shell ever parses the argument text as syntax, only as file
content — the same pattern this plugin's `finish-pr` already uses for other
free-form text (`apply-pr-update.sh`'s title/body files).

## Parameters

| #   | Name | Format    | Required | Notes                                                                                                                                                                                  |
| --- | ---- | --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | path | file path | yes      | Points at a file holding `$ARGUMENTS`' literal text verbatim (exact bytes, nothing added). Only ever invoked when `$ARGUMENTS` is non-empty; an empty value routes to Step 3b instead. |

## Exit codes

| Code | Meaning                     | Notes                                                                                                                                                                                            |
| ---- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | ok                          | See the printed lines below.                                                                                                                                                                     |
| 2    | no verb matched             | No word equals a Yes-list (`install`/`add`/`enable`/`update`/`refresh`/`yes`) or No-list (`remove`/`uninstall`/`delete`/`disable`/`no`) entry.                                                   |
| 3    | ambiguous verb              | A word matched the No-list AND a (possibly different) word matched the Yes-list.                                                                                                                 |
| 4    | ambiguous target            | Both `tools` and `golden-rules` named, or `both`/`all`/`everything` named alongside either specific target.                                                                                      |
| 5    | destructive verb, no target | A No-list verb resolved with no target named at all — a destructive action is never inferred as "both" from an ambiguous word; an explicit target is required.                                   |
| 6    | usage                       | Missing argument, or the path doesn't point at a readable file — a script-invocation problem, distinct from every code above (all of which mean the script ran fine and rejected the _content_). |

On exit `2`-`5`, stderr carries one complete, non-question sentence ready to
relay verbatim: `Couldn't parse "<input>" -- expected a verb
(install/update/remove) and, for remove, an explicit target
(rules/tools/both). Examples: "install", "update tools rule", "remove
rules", "remove both".` Exit `6`'s stderr is a distinct usage message — do
not relay it as if it were a parse rejection of the user's input.

## Output (stdout, on exit 0)

```text
golden_rules: yes|no|unset
tools: yes|no|unset
```

`unset` means "leave this answer untouched" (mirrors Step 3a item 4's prior
wording) — the caller applies only the fields that aren't `unset` and skips
`AskUserQuestion` entirely.

## Resolution rules

1. **Verb** — lowercase the input, split on whitespace, whole-word match
   only (never substring — `uninstall` never collides with `install`).
2. **Target** — `tool`/`tools`/`tool-routing`/`routing` names **tools**;
   `golden`/`golden-rules` names **golden-rules**; a bare `rule`/`rules` also
   names **golden-rules**, but only when no tool-family word is present
   anywhere in the input (otherwise it's absorbed as filler in a phrase like
   "tools rule"); `both`/`all`/`everything` names **both**.
3. **No target named at all**: verb `Yes` → defaults to `both` (a safe
   default for install/refresh); verb `No` → exit `5` (a destructive action
   never guesses a scope).
