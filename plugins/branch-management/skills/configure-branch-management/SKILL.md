---
name: configure-branch-management
description: Interactive configurator for branch-management plugin settings — reviewers, CI monitoring, graphify options. Detects project context and writes to the appropriate settings.json.
argument-hint: ""
allowed-tools: ["AskUserQuestion", "Bash(jq:*)", "Bash(test:*)", "Bash(mkdir:*)", "Bash(mv:*)", "Bash(printf:*)"]
disable-model-invocation: true
---

# Configure branch-management settings

Interactive wizard that reads current `userConfig` options for the
branch-management plugin, presents thematic question groups with current
values embedded, and writes only non-default values back to the selected
settings file. Values equal to the plugin default are omitted (clean settings).

## Plugin defaults

```
review_claude: true        review_codex: true
review_copilot: true       review_coderabbit: true
review_max_rounds: 3       ci_monitor: true
ci_watch_timeout: 1800     coderabbit_ci_comments: true
context_index: true        graphify_branch_update: true
graphify_pr_update: true   graphify_pr_commit: true
graphify_force_create: false   graphify_user_files: false
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

## Step 4 — Ask: Reviewers

Compute currently-enabled reviewers from `$current`:
- `review_claude == true` → "Claude"
- `review_codex == true` → "Codex"
- `review_copilot == true` → "Copilot"
- `review_coderabbit == true` → "CodeRabbit"

```
AskUserQuestion (2 questions):
  Q1: multiSelect: true
      question: "Which reviewers should be enabled?"
      header:   "Reviewers [currently: <comma-list or none>]"
      options:
        - label: "Claude"
          description: "claude-reviewer subagent (opus)"
        - label: "Codex"
          description: "codex-reviewer — requires codex CLI login"
        - label: "Copilot"
          description: "copilot-reviewer — requires copilot CLI login"
        - label: "CodeRabbit"
          description: "coderabbit-reviewer — requires coderabbit CLI login, rate-limited (3/h free tier)"

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

Store: `$reviewers` (list of selected labels), `$max_rounds_raw` (selected label).

If `$max_rounds_raw == "Other"` → run numeric validation loop for
`review_max_rounds` (step 7) and store result as `$max_rounds`.
Otherwise `$max_rounds = integer($max_rounds_raw)`.

## Step 5 — Ask: CI

From `$current`:
- `ci_monitor` current value → `$cur_ci_monitor = "on"` if `true` else `"off"`
- `coderabbit_ci_comments` current value → `$cur_cr_comments = "on"` if `true` else `"off"`
- `ci_watch_timeout` current value → `$cur_timeout`

```
AskUserQuestion (3 questions):
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
```

Store: `$ci_monitor_raw`, `$ci_timeout_raw`, `$ci_comments_raw`.

If `$ci_timeout_raw == "Other"` → run numeric validation loop for
`ci_watch_timeout` (step 7) and store result as `$ci_timeout`.
Otherwise extract the integer from the preset label (e.g. `"30 min (1800s)"` →
`1800`): match the number inside the trailing parentheses and store as `$ci_timeout`.

## Step 6 — Ask: Graphify + Context

Compute currently-enabled graphify triggers from `$current`:
- `graphify_branch_update == true` → "on new branch"
- `graphify_pr_update == true`     → "before PR push"
- `graphify_pr_commit == true`     → "separate PR commit"

Compute currently-enabled graphify extras:
- `graphify_force_create == true` → "force-create missing folder"
- `graphify_user_files == true`   → "keep human-only outputs"

```
AskUserQuestion (3 questions):
  Q1: multiSelect: true
      question: "Which graphify update triggers should be active?"
      header:   "Graphify triggers [currently: <list or none>]"
      options:
        - label: "on new branch"
          description: "refresh graphify output after new-branch (graphify_branch_update)"
        - label: "before PR push"
          description: "refresh graphify output before pushing in new-pr (graphify_pr_update)"
        - label: "separate PR commit"
          description: "commit refreshed graphify-out as a separate commit in new-pr (graphify_pr_commit)"

  Q2: multiSelect: true
      question: "Which graphify extras should be enabled? (both are fail-closed — off by default)"
      header:   "Graphify extras [currently: <list or none>]"
      options:
        - label: "force-create missing folder"
          description: "create graphify-out/ if absent instead of skipping (graphify_force_create)"
        - label: "keep human-only outputs"
          description: "retain graph.html and other human-only files after refresh (graphify_user_files)"

  Q3: multiSelect: false
      question: "Enable context-mode indexing when a new branch is created?"
      header:   "context-mode indexing [currently: <on|off>]"
      options:
        - label: "Yes"  description: "refresh the context-mode index after new-branch"
        - label: "No"   description: "skip the index refresh"
```

Store: `$graphify_triggers` (list), `$graphify_extras` (list), `$ctx_index_raw`.

## Step 7 — Numeric validation loop

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

## Step 8 — Build new config and compute delta

Map all collected answers to config key values:

```
review_claude          = ("Claude"     is in $reviewers)
review_codex           = ("Codex"      is in $reviewers)
review_copilot         = ("Copilot"    is in $reviewers)
review_coderabbit      = ("CodeRabbit" is in $reviewers)
review_max_rounds      = $max_rounds            [integer]
ci_monitor             = ($ci_monitor_raw == "Yes")
ci_watch_timeout       = $ci_timeout            [integer]
coderabbit_ci_comments = ($ci_comments_raw == "Yes")
graphify_branch_update = ("on new branch"               is in $graphify_triggers)
graphify_pr_update     = ("before PR push"              is in $graphify_triggers)
graphify_pr_commit     = ("separate PR commit"          is in $graphify_triggers)
graphify_force_create  = ("force-create missing folder" is in $graphify_extras)
graphify_user_files    = ("keep human-only outputs"     is in $graphify_extras)
context_index          = ($ctx_index_raw == "Yes")
```

Compute delta (keys where `new_value != default`):

```
defaults = {
  review_claude: true,      review_codex: true,
  review_copilot: true,     review_coderabbit: true,
  review_max_rounds: 3,     ci_monitor: true,
  ci_watch_timeout: 1800,   coderabbit_ci_comments: true,
  context_index: true,      graphify_branch_update: true,
  graphify_pr_update: true, graphify_pr_commit: true,
  graphify_force_create: false, graphify_user_files: false
}
delta = { key: new_value[key] for each key where new_value[key] != defaults[key] }
```

## Step 9 — Write settings file

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

## Step 10 — Confirm

Print exactly:
```
Settings written to <settings_path>. Restart Claude Code to apply changes.
```
