---
name: configure-superpowers-automation
description: Interactive configurator for superpowers-automation plugin settings — plans hook, specs hook, and advisor review gate. Writes to ~/.claude/settings.json.
argument-hint: ""
allowed-tools: ["AskUserQuestion", "Bash(jq:*)", "Bash(test:*)", "Bash(mkdir:*)", "Bash(mv:*)", "Bash(printf:*)"]
disable-model-invocation: true
---

# Configure superpowers-automation

Interactive wizard that reads current `userConfig` options for the
superpowers-automation plugin, presents questions with current values
embedded, and writes only non-default values back to `~/.claude/settings.json`.
Values equal to the plugin default (`false`) are omitted (clean settings).

## Plugin defaults

| Key | Default |
|---|---|
| `hook_plans` | `false` |
| `hook_specs` | `false` |
| `hook_advisor_review` | `false` |

## Step 1 — Read current settings

Settings path: `$settings_path = ~/.claude/settings.json`

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
`"superpowers-automation@"`.
- Found → `$plugin_key = <that key>`, `$stored = pluginConfigs[$plugin_key].options // {}`
- Not found → `$plugin_key = "superpowers-automation@kwitsch-plugins"`, `$stored = {}`

Compute current display values:
- `$cur_plans   = $stored.hook_plans          == true ? "on" : "off"`
- `$cur_specs   = $stored.hook_specs           == true ? "on" : "off"`
- `$cur_advisor = $stored.hook_advisor_review  == true ? "on" : "off"`

## Step 2 — Ask: Hooks

```
AskUserQuestion (3 questions):
  Q1: multiSelect: false
      question: "Enable plans hook? Writes to docs/superpowers/plans/*.md will inject subagent-driven guidance."
      header:   "Plans hook [currently: <on|off>]"
      options:
        - label: "Yes"  description: "inject 'Use approach: 1. Subagent-Driven.' on plan file writes"
        - label: "No"   description: "no injection on plan file writes"

  Q2: multiSelect: false
      question: "Enable specs hook? Writes to docs/superpowers/specs/*.md will inject spec-confirmed message."
      header:   "Specs hook [currently: <on|off>]"
      options:
        - label: "Yes"  description: "inject 'User has reviewed and confirmed the spec. Proceed after self-review.' on spec file writes"
        - label: "No"   description: "no injection on spec file writes"

  Q3: multiSelect: false
      question: "Enable advisor review gate? When active, any firing hook also requires advisor() approval before the model proceeds."
      header:   "Advisor gate [currently: <on|off>]"
      options:
        - label: "Yes"  description: "append advisor gate instruction to active hook messages (skipped if advisor tool unavailable)"
        - label: "No"   description: "no advisor gate — hook messages unchanged"
```

Store: `$plans_raw` ("Yes"/"No"), `$specs_raw` ("Yes"/"No"), `$advisor_raw` ("Yes"/"No").

## Step 3 — Build new config and compute delta

Resolve values:
- `$hook_plans          = ($plans_raw   == "Yes")` → boolean true or false
- `$hook_specs          = ($specs_raw   == "Yes")` → boolean true or false
- `$hook_advisor_review = ($advisor_raw == "Yes")` → boolean true or false

Build delta — include key only when value is `true` (differs from default `false`):
- `hook_plans: true`          included iff `$hook_plans == true`
- `hook_specs: true`          included iff `$hook_specs == true`
- `hook_advisor_review: true` included iff `$hook_advisor_review == true`

`$delta_json` = JSON object of the delta (e.g. `{"hook_plans":true}`, `{}`, or `{"hook_plans":true,"hook_advisor_review":true}`).

## Step 4 — Write settings file

Create parent directory if needed:
```bash
mkdir -p "$(dirname "$settings_path")"
```

Initialise file if absent:
```bash
test -f "$settings_path" || printf '{}' > "$settings_path"
```

**When delta is empty** (all hooks disabled = defaults):
```bash
jq --arg key "$plugin_key" \
  'del(.pluginConfigs[$key].options)
   | if (.pluginConfigs[$key] // {}) == {} then del(.pluginConfigs[$key]) else . end' \
  "$settings_path" > "${settings_path}.tmp" \
  && mv "${settings_path}.tmp" "$settings_path"
```

**When delta is non-empty:**
```bash
jq --arg key "$plugin_key" --argjson opts "$delta_json" \
  '.pluginConfigs[$key].options = $opts' \
  "$settings_path" > "${settings_path}.tmp" \
  && mv "${settings_path}.tmp" "$settings_path"
```

`jq` creates `.pluginConfigs[$key]` automatically if the path is absent.

## Step 5 — Confirm

Print using the **new** values (from `$hook_plans`, `$hook_specs`, `$hook_advisor_review`):
```
superpowers-automation configured.
  Plans hook:     <"on" if $hook_plans == true else "off">
  Specs hook:     <"on" if $hook_specs == true else "off">
  Advisor gate:   <"on" if $hook_advisor_review == true else "off">
```
