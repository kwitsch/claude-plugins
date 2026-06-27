---
name: configure-branch-management
description: Interactive configurator for branch-management plugin settings — review level, CI monitoring. Detects project context and writes to the appropriate settings.json.
argument-hint: ""
allowed-tools: ["AskUserQuestion", "Bash(jq:*)", "Bash(test:*)", "Bash(mkdir:*)", "Bash(mv:*)", "Bash(printf:*)"]
disable-model-invocation: true
---

# Configure branch-management settings

Interactive wizard that reads current `userConfig` options for the
branch-management plugin, presents thematic question groups with current
values embedded, and writes only non-default values back to the selected
settings file. Values equal to the plugin default are omitted (clean settings).

> **Ask the user via `AskUserQuestion`.** When this skill needs a decision from
> the user and the answers are a fixed / multiple-choice set, it MUST present the
> question through the `AskUserQuestion` tool — never as plain prose that waits for
> a typed reply. Remote sessions do not reliably surface a plain-text "waiting for
> input" prompt, whereas `AskUserQuestion` raises a notification. Open-ended,
> free-text prompts may be asked inline, but prefer `AskUserQuestion` whenever the
> choices can be enumerated.

## Plugin defaults

```
review_level: "medium"     review_max_rounds: 3
ci_monitor: true           ci_watch_timeout: 1800
coderabbit_ci_comments: true   delete_branch_on_merge: true
rebase_before_pr: true
```

## Step 1 — Detect project context

```bash
test -d .git || test -d .claude
```

- Exit 0 (found) → proceed to step 2
- Exit non-zero (not found) → set `$settings_path = ~/.claude/settings.json`, skip to step 3

## Step 2 — Select settings scope

```
AskUserQuestion:
  question: "Which settings file should be updated?"
  header:   "Settings scope"
  multiSelect: false
  options:
    - label: "User settings"
      description: "~/.claude/settings.json — applies everywhere"
    - label: "Project settings"
      description: "./.claude/settings.json — this repo, shared with team"
    - label: "Local project settings"
      description: "./.claude/settings.local.json — this repo only, gitignored"
```

Map answer to `$settings_path`:
- "User settings"          → `~/.claude/settings.json`
- "Project settings"       → `./.claude/settings.json`
- "Local project settings" → `./.claude/settings.local.json`

## Step 3 — Read current settings

Check `jq` is available:
```bash
jq --version >/dev/null 2>&1
```
Non-zero → abort: `jq required but not found. Install jq and retry.`

If `$settings_path` does not exist → `$stored = {}`, continue.
Otherwise read:
```bash
jq '.pluginConfigs // {}' "$settings_path"
```
If `jq` exits non-zero → abort: `Cannot parse <path>: <error>. Fix manually before running this skill.`

Find plugin config key: search `pluginConfigs` for any key starting with
`"branch-management@"`.
- Found → `$plugin_key = <that key>`, `$stored = pluginConfigs[$plugin_key].options // {}`
- Not found → `$plugin_key = "branch-management@kwitsch-plugins"`, `$stored = {}`

Merge `$stored` with the defaults table above to produce `$current` (stored
values override defaults for any key present in `$stored`).

## Step 4 — Ask: Review level

Compute current review level from `$current`:
- `review_level` value → `$cur_level` (default `"medium"` if not set)

```
AskUserQuestion (2 questions):
  Q1: multiSelect: false
      question: "What effort level should /code-review use?"
      header:   "Review level [currently: <$cur_level>]"
      options:
        - label: "low"
          description: "fast — high-confidence findings only"
        - label: "medium"
          description: "balanced coverage (default)"
        - label: "high"
          description: "broader — may include uncertain findings"
        - label: "xhigh"
          description: "deeper reasoning"
        - label: "max"
          description: "maximum coverage"

  Q2: multiSelect: false
      question: "Maximum number of iterative review rounds?"
      header:   "Review rounds [currently: <N>]"
      options:
        - label: "1"      description: "single-pass review"
        - label: "2"      description: ""
        - label: "3"      description: "default"
        - label: "5"      description: "thorough"
        - label: "Other"  description: "enter a custom positive integer"
```

Store: `$review_level_raw` (selected label), `$max_rounds_raw` (selected label).

`$review_level = $review_level_raw` (one of: `low`, `medium`, `high`, `xhigh`, `max`).

If `$max_rounds_raw == "Other"` → run numeric validation loop for
`review_max_rounds` (step 6) and store result as `$max_rounds`.
Otherwise `$max_rounds = integer($max_rounds_raw)`.

## Step 5 — Ask: CI

From `$current`:
- `ci_monitor` current value → `$cur_ci_monitor = "on"` if `true` else `"off"`
- `coderabbit_ci_comments` current value → `$cur_cr_comments = "on"` if `true` else `"off"`
- `ci_watch_timeout` current value → `$cur_timeout`
- `delete_branch_on_merge` current value → `$cur_delete_branch = "on"` if `true` else `"off"`
- `rebase_before_pr` current value → `$cur_rebase = "on"` if `true` else `"off"`

```
AskUserQuestion (4 questions):
  Q1: multiSelect: false
      question: "Enable CI monitoring after the PR/MR is opened?"
      header:   "CI monitoring [currently: <on|off>]"
      options:
        - label: "Yes"  description: "watch CI results and loop until green"
        - label: "No"   description: "stop after opening the PR/MR"

  Q2: multiSelect: false
      question: "CI watch timeout — how long to wait before giving up?"
      header:   "CI timeout [currently: <N>s]"
      options:
        - label: "10 min (600s)"   description: ""
        - label: "30 min (1800s)"  description: "default"
        - label: "1 hr (3600s)"    description: ""
        - label: "Other"           description: "enter custom seconds (positive integer)"

  Q3: multiSelect: false
      question: "Track and address CodeRabbit bot comments during CI watch?"
      header:   "CodeRabbit CI comments [currently: <on|off>]"
      options:
        - label: "Yes"  description: "collect open CodeRabbit threads and pass to review-fixer"
        - label: "No"   description: "ignore CodeRabbit bot comments"

  Q4: multiSelect: false
      question: "Automatically delete the branch when the PR/MR merges?"
      header:   "Delete branch on merge [currently: <on|off>]"
      options:
        - label: "Yes"  description: "GitHub: set repo delete_branch_on_merge (needs admin); GitLab: --remove-source-branch"
        - label: "No"   description: "leave branch-deletion settings untouched"

  Q5: multiSelect: false
      question: "Rebase the work branch onto its base before opening the PR/MR?"
      header:   "Rebase before PR [currently: <on|off>]"
      options:
        - label: "Yes"  description: "when the base (usually main) gained new commits, rebase onto origin/<base> before submitting (force-with-lease push)"
        - label: "No"   description: "open the PR/MR without rebasing onto the latest base"
```

Store: `$ci_monitor_raw`, `$ci_timeout_raw`, `$ci_comments_raw`, `$delete_branch_raw`, `$rebase_before_pr_raw`.

If `$ci_timeout_raw == "Other"` → run numeric validation loop for
`ci_watch_timeout` (step 6) and store result as `$ci_timeout`.
Otherwise extract the integer from the preset label (e.g. `"30 min (1800s)"` →
`1800`): match the number inside the trailing parentheses and store as `$ci_timeout`.

## Step 6 — Numeric validation loop

Used when "Other" is selected for a numeric field. Set `$field_label` to the
human-readable field name ("Max review rounds" or "CI watch timeout") before
entering the loop.

```
attempt = 1
prev_val = ""
loop:
  AskUserQuestion (1 question):
    multiSelect: false
    question:   "Enter a value for <field_label> (positive integer):"
    header:     "<field_label>[invalid: <prev_val>]"   ← include "[invalid: X]" only on retries
    options:
      - label: "Other"  description: "type your custom value in the notes field"

  Extract text from the user-provided notes on the "Other" option.
  Validate: value matches /^[0-9]+$/ AND integer(value) >= 1
    PASS → return integer(value), exit loop
    FAIL →
      prev_val = value
      attempt += 1
      if attempt > 3:
        abort "Invalid value after 3 attempts. No changes written."
      else:
        continue loop
```

## Step 7 — Build new config and compute delta

Map all collected answers to config key values:

```
review_level           = $review_level_raw      [string]
review_max_rounds      = $max_rounds            [integer]
ci_monitor             = ($ci_monitor_raw == "Yes")
ci_watch_timeout       = $ci_timeout            [integer]
coderabbit_ci_comments = ($ci_comments_raw == "Yes")
delete_branch_on_merge = ($delete_branch_raw == "Yes")
rebase_before_pr       = ($rebase_before_pr_raw == "Yes")
```

Compute delta (keys where `new_value != default`):

```
defaults = {
  review_level: "medium",   review_max_rounds: 3,
  ci_monitor: true,         ci_watch_timeout: 1800,
  coderabbit_ci_comments: true, delete_branch_on_merge: true,
  rebase_before_pr: true
}
delta = { key: new_value[key] for each key where new_value[key] != defaults[key] }
```

## Step 8 — Write settings file

Create parent directory if needed:
```bash
mkdir -p "$(dirname "$settings_path")"
```

If `$settings_path` does not exist, initialise it:
```bash
test -f "$settings_path" || printf '{}' > "$settings_path"
```

**When delta is empty** — remove options key (and the parent entry if it
becomes empty):
```bash
jq --arg key "$plugin_key" \
  'del(.pluginConfigs[$key].options)
   | if (.pluginConfigs[$key] // {}) == {} then del(.pluginConfigs[$key]) else . end' \
  "$settings_path" > "${settings_path}.tmp" \
  && mv "${settings_path}.tmp" "$settings_path"
```

**When delta is non-empty** — write delta as the options object.
Build `$delta_json` as a JSON object from the delta map, then:
```bash
jq --arg key "$plugin_key" --argjson opts "$delta_json" \
  '.pluginConfigs[$key].options = $opts' \
  "$settings_path" > "${settings_path}.tmp" \
  && mv "${settings_path}.tmp" "$settings_path"
```

`jq` creates `.pluginConfigs[$key]` automatically if the path is absent.

## Step 9 — Confirm

Print exactly:
```
Settings written to <settings_path>. Restart Claude Code to apply changes.
```
