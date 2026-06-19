---
name: configure-superpowers-automation
description: Interactive configurator for superpowers-automation plugin settings — the plans hook. Writes to ~/.claude/settings.json.
argument-hint: ""
allowed-tools: ["AskUserQuestion", "Bash(jq:*)", "Bash(test:*)", "Bash(mkdir:*)", "Bash(mv:*)", "Bash(printf:*)"]
disable-model-invocation: true
---

# Configure superpowers-automation

Interactive wizard that reads current `userConfig` options for the
superpowers-automation plugin, presents questions with current values
embedded, and writes only non-default values back to `~/.claude/settings.json`.
Values equal to the plugin default (`false`) are omitted (clean settings).

> **Ask the user via `AskUserQuestion`.** When this skill needs a decision from
> the user and the answers are a fixed / multiple-choice set, it MUST present the
> question through the `AskUserQuestion` tool — never as plain prose that waits for
> a typed reply. Remote sessions do not reliably surface a plain-text "waiting for
> input" prompt, whereas `AskUserQuestion` raises a notification. Open-ended,
> free-text prompts may be asked inline, but prefer `AskUserQuestion` whenever the
> choices can be enumerated.

## Plugin defaults

| Key | Default |
|---|---|
| `hook_plans` | `false` |

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

## Step 2 — Ask: Hooks

```
AskUserQuestion (1 question):
  Q1: multiSelect: false
      question: "Enable plans hook? Writes to docs/superpowers/plans/*.md will inject an instruction to implement the plan with superpowers:subagent-driven-development (forcing Subagent-Driven)."
      header:   "Plans hook [currently: <on|off>]"
      options:
        - label: "Yes"  description: "force subagent-driven-development on plan file writes"
        - label: "No"   description: "no injection on plan file writes"
```

Store: `$plans_raw` ("Yes"/"No").

## Step 3 — Build new config and compute delta

Resolve values:
- `$hook_plans = ($plans_raw == "Yes")` → boolean true or false

Build delta — include key only when value is `true` (differs from default `false`):
- `hook_plans: true` included iff `$hook_plans == true`

`$delta_json` = JSON object of the delta (e.g. `{"hook_plans":true}` or `{}`).

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

Print using the **new** values (from `$hook_plans`):
```
superpowers-automation configured.
  Plans hook:     <"on" if $hook_plans == true else "off">
```
