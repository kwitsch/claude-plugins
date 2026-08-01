---
name: create-plugin
description: Use when adding a new plugin to this claude-plugins marketplace - scaffolds plugins/<name>/ with a spec-compliant plugin.json and chosen components (commands, skills, agents, hooks), a README and CLAUDE.md, registers it in .claude-plugin/marketplace.json and the root README plugins table, scaffolds a bats test suite for hooks plugins, and verifies with the same checks the CI runs.
---

# Creating a New Marketplace Plugin

Scaffold new plugin, register in marketplace manifest, pass CI + installable.

## Repository layout (recap)

- `.claude-plugin/marketplace.json` — repo root marketplace manifest. Lists every plugin.
- `plugins/<plugin-name>/.claude-plugin/plugin.json` — per-plugin manifest.
- `plugins/<plugin-name>/{commands,skills,agents,hooks}/` — plugin components at plugin root.
- `plugins/<plugin-name>/README.md` and `plugins/<plugin-name>/CLAUDE.md` — per-plugin docs.
- `test/<plugin-name>/test.bats` — per-plugin bats suite (top-level), run by CI.
- `.github/workflows/ci.yml` — validates `marketplace.json` and each plugin manifest with `jq`.
- `.github/workflows/test.yml` — runs each plugin's `test/<name>/test.bats` via static matrix.

## Checklist

`TaskCreate` one task per step below, then `TaskUpdate` each to `in_progress`/`completed` in order — Task tools are the session default (Claude Code v2.1.142+), superseding `TodoWrite`.

1. **Gather inputs** — ask one at a time.
2. **Validate name** — kebab-case, not already taken.
3. **Scaffold plugin directory** — `plugin.json` + chosen component stubs.
4. **Scaffold docs** — `plugins/<name>/README.md` (minimal) + `plugins/<name>/CLAUDE.md`, add row to root README plugins table.
5. **Scaffold test suite (hooks only)** — `test/<name>/test.bats` + add plugin to `test.yml` matrix.
6. **Register in marketplace.json** — add entry to `plugins` array.
7. **Verify** — run CI checks locally; manifests + bats suite (if scaffolded) must pass.
8. **Report** — list every file created or changed.

## Step 1 — Gather inputs

Ask one at a time. Collect:

- **name** — kebab-case (lowercase, digits, hyphens), e.g. `my-plugin`. Directory name and manifest `name`.
- **description** — one sentence, what plugin does.
- **author** — default `Kwitsch` unless told otherwise.
- **version** — default `0.1.0`.
- **category** — single string, e.g. `productivity`, `example` (optional).
- **tags** — short keywords array (optional).
- **components** — which of `skills`, `agents`, `hooks`, `commands` (legacy) to scaffold. Min one; `skills` is default. For `hooks`, also pick the **hook kind** (see `.claude/rules/hooks-mcp-server.md` decision tree):
  - **command** — required only for: pre-connect events (`SessionStart`/`Setup`), fail-closed hard gates (need exit 2), or fail-open-sensitive side-effects that must reliably fire (e.g. `PreCompact` snapshot, a state-write other hooks read). Also the default for latency-sensitive high-frequency events (`MessageDisplay`; `UserPromptSubmit` is a latency/cost trade-off where `mcp_tool` is also viable — see the matrix) → a `.mjs`/`.sh` command hook.
  - **mcp** — otherwise, non-blocking mid-session hooks (`PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, `PreCompact`/`ConfigChange` when no must-fire side-effect, …) → an `mcp_tool` hook backed by a self-contained plugin-local MCP server (preferred). See the per-event `hooks-mcp-tool-event-matrix`.

## Step 2 — Validate the name

- Confirm name matches `^[a-z0-9]+(-[a-z0-9]+)*$`.
- Confirm `plugins/<name>/` doesn't exist.
- Confirm no entry in `.claude-plugin/marketplace.json` uses that `name`.

Fail: report conflict, ask for different name. Never overwrite existing plugin.

## Step 3 — Scaffold the plugin directory

Create `plugins/<name>/.claude-plugin/plugin.json`:

```json
{
  "name": "<name>",
  "version": "<version>",
  "description": "<description>",
  "author": {
    "name": "<author>"
  }
}
```

**Important**: Component dirs at plugin root. Never put `skills/`, `commands/`, `agents/`, or `hooks/` inside `.claude-plugin/` — only `plugin.json` there.

Stub each chosen component:

- **skills** → `plugins/<name>/skills/<name>/SKILL.md`:

  ```markdown
  ---
  name: <name>
  description: Use when <trigger condition> - <what the skill does>.
  ---

  # <Human-readable title>

  Step-by-step instructions for the skill go here.
  ```

- **commands** (legacy — prefer `skills/` for new plugins) → `plugins/<name>/commands/<name>.md`:

  ```markdown
  ---
  description: <short description of what this command does>
  ---

  Describe here what Claude should do when this command runs.
  ```

- **agents** → `plugins/<name>/agents/<name>.md`:

  ```markdown
  ---
  name: <name>
  description: <when this subagent should be used>
  ---

  System prompt / instructions for the subagent.
  ```

- **hooks** → `plugins/<name>/hooks/hooks.json`:

  ```json
  {
    "hooks": {}
  }
  ```

  The empty `{}` registers no behavior — populate it with real hook entries
  (e.g. a `PreToolUse`/`PostToolUse` matcher) and add the referenced script under
  `plugins/<name>/hooks/`, then cover it with behavioral tests in Step 5.

- **hooks (mcp kind)** → scaffold three files (see `.claude/rules/hooks-mcp-server.md` for the full reference content):
  - `plugins/<name>/mcp/server.mjs` — the self-contained zero-dep MCP stdio server (set `SERVER_NAME = "<name>-hooks"`). Copy it verbatim from the hooks-mcp-server rule, then `chmod +x plugins/<name>/mcp/server.mjs`.
  - `plugins/<name>/.mcp.json` — registers `"<name>-hooks"` → `${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs`.
  - `plugins/<name>/hooks/hooks.json` — a `PostToolUse` `mcp_tool` handler (`server: "<name>-hooks"`, `tool: "example_context"`).

Only create the directories for components the user actually chose.

## Step 4 — Scaffold docs

Create `plugins/<name>/README.md` (minimal):

````markdown
# <name>

<description>

## Install

```
/plugin install <name>@kwitsch-plugins
```

## What it does

<one short paragraph describing the plugin's behavior>
````

Create `plugins/<name>/CLAUDE.md` (short, project-specific context):

```markdown
# CLAUDE.md — <name>

<one or two lines on what the plugin is and its main component>.

## Behavior
<what the plugin's component(s) do at runtime — key rules, guards, edge cases>.

## Tests
`test/<name>/test.bats` (bats). Run: `BATS_LIB_PATH=/usr/lib/bats bats test/<name>/`.
```

Add row to `## Plugins` table in root `README.md`, preserve existing rows:

```markdown
| [<name>](plugins/<name>/README.md) | <description> |
```

## Step 5 — Scaffold the test suite (hooks plugins only)

Only for `hooks` component. Prompt-only plugins (commands/skills/agents) have nothing to test — skip.

Create `test/<name>/test.bats` with passing smoke test:

```bash
#!/usr/bin/env bats

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOKS="$REPO_ROOT/plugins/<name>/hooks/hooks.json"
}

@test "hooks.json is valid JSON" {
  run jq empty "$HOOKS"
  assert_success
}

# TODO: add behavioral tests for this plugin's hooks here.
```

For an **mcp-kind** hooks plugin, scaffold `test/<name>/test.bats` with:

```bash
#!/usr/bin/env bats

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/<name>"
  MCP_JSON="$PLUGIN/.mcp.json"
  HOOKS="$PLUGIN/hooks/hooks.json"
  SERVER="$PLUGIN/mcp/server.mjs"
}

@test ".mcp.json is valid JSON" {
  run jq empty "$MCP_JSON"
  assert_success
}

@test "hooks.json is valid JSON" {
  run jq empty "$HOOKS"
  assert_success
}

@test "every mcp_tool hook references a configured server" {
  run bash -c '
    set -e
    for s in $(jq -r "[.hooks[][].hooks[] | select(.type==\"mcp_tool\") | .server] | unique[]" "'"$HOOKS"'"); do
      jq -e --arg s "$s" ".mcpServers[\$s]" "'"$MCP_JSON"'" >/dev/null \
        || { echo "server not configured: $s" >&2; exit 1; }
    done
  '
  assert_success
}

@test "every mcp_tool hook names a non-empty tool" {
  run jq -e '[.hooks[][].hooks[] | select(.type=="mcp_tool")] | all(.tool | type=="string" and length>0)' "$HOOKS"
  assert_success
}

@test "server.mjs is executable" {
  [ -x "$SERVER" ]
}

@test "server.mjs has a node shebang" {
  run head -n1 "$SERVER"
  assert_output '#!/usr/bin/env node'
}

@test "server.mjs passes node --check" {
  run node --check "$SERVER"
  assert_success
}

@test "server lists its tool over stdio" {
  # Runs under node; if bun is installed the shim re-execs transparently — same output.
  run bash -c '
    printf "%s\n%s\n" \
      "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}" \
      "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}" \
      | node "'"$SERVER"'"
  '
  assert_success
  assert_output --partial '"example_context"'
}
```

Wire into CI: in `.github/workflows/test.yml`, append `- <name>` under `plugin:`, preserve existing entries + valid YAML:

```yaml
      matrix:
        plugin:
          - no-co-authored   # existing entry — keep it
          - <name>           # the new plugin
```

## Step 6 — Register in marketplace.json

Add entry to `plugins` array in `.claude-plugin/marketplace.json`. Preserve existing entries + valid JSON (no trailing commas):

```json
{
  "name": "<name>",
  "source": "./plugins/<name>",
  "description": "<description>",
  "author": {
    "name": "<author>"
  },
  "category": "<category>",
  "tags": ["<tag1>", "<tag2>"]
}
```

Use full `./plugins/<name>` path — `metadata.pluginRoot` documented but broken in Claude Code (anthropics/claude-code#61224/#64431); reintroduce after upstream fix. No `version` field — `plugin.json` is single source of truth (CI fails if marketplace entry declares one). Omit `category`/`tags` if not provided. `name` and `source` only required fields.

## Step 7 — Verify (mirror the CI)

Run same checks as `.github/workflows/ci.yml`:

```bash
manifest=".claude-plugin/marketplace.json"
test -f "$manifest" || { echo "Missing $manifest"; exit 1; }

# marketplace.json is valid JSON
jq empty "$manifest"

# Required top-level fields
jq -e '.name and .owner and (.plugins | type == "array")' "$manifest" >/dev/null

# Every plugin entry has name + source
jq -e 'all(.plugins[]; .name and .source)' "$manifest" >/dev/null

# No marketplace entry carries a version (plugin.json is the single source)
jq -e 'all(.plugins[]; has("version") | not)' "$manifest" >/dev/null

# Every local plugin source (a full ./plugins/<name> path from the marketplace
# root) exists, its manifest is valid JSON and declares a version. The
# metadata.pluginRoot fallback is kept forward-compatible pending
# anthropics/claude-code#61224; pluginRoot is intentionally unused for now.
root="$(jq -r '.metadata.pluginRoot // "."' "$manifest")"
jq -r '.plugins[].source | if type == "string" then . else "remote" end' "$manifest" | while IFS= read -r src; do
  case "$src" in
    remote) ;;
    *)
      dir="$root/$src"
      test -d "$dir" || { echo "Missing source dir: $dir"; exit 1; }
      pm="$dir/.claude-plugin/plugin.json"
      [ -f "$pm" ] || { echo "Missing plugin manifest: $pm"; exit 1; }
      jq empty "$pm"
      jq -e '.version' "$pm" >/dev/null || { echo "$pm declares no version"; exit 1; }
      ;;
  esac
done
```

All commands must succeed with no error output. Fix before reporting done.

For hooks plugin, also run suite + confirm matrix wiring:

```bash
# The new bats suite passes
BATS_LIB_PATH=/usr/lib/bats bats "test/<name>/"

# The plugin is present in the test matrix ($ is grep's end-of-line anchor)
grep -q "^[[:space:]]*-[[:space:]]*<name>\$" .github/workflows/test.yml \
  || { echo "Missing test.yml matrix entry for <name>"; exit 1; }
```

For an **mcp-kind** plugin the same bats suite also exercises the server: executable bit + node shebang, `node --check`, and a live `initialize`+`tools/list` over stdio must pass. `node` is the CI baseline (bun optional; the shim falls back to node when bun is absent).

## Step 8 — Report

List every file created: `plugin.json`, component stubs, `README.md`, `CLAUDE.md`, `marketplace.json` entry, and (hooks plugin) `test/<name>/test.bats` + `test.yml` matrix entry. Remind: commit and install via `/plugin install <name>@kwitsch-plugins`.
