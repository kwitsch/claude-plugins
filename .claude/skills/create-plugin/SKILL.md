---
name: create-plugin
description: Use when adding a new plugin to this claude-plugins marketplace - scaffolds plugins/<name>/ with a spec-compliant plugin.json and chosen components (commands, skills, agents, hooks), a README and CLAUDE.md, registers it in .claude-plugin/marketplace.json and the root README plugins table, scaffolds a bats test suite for hooks plugins, and verifies with the same checks the CI runs.
---

# Creating a New Marketplace Plugin

Scaffold a new plugin in this repository and register it in the marketplace
manifest, so that it passes CI and is installable via the marketplace.

## Repository layout (recap)

- `.claude-plugin/marketplace.json` — marketplace manifest at the repo root. Lists every plugin.
- `plugins/<plugin-name>/.claude-plugin/plugin.json` — per-plugin manifest.
- `plugins/<plugin-name>/{commands,skills,agents,hooks}/` — plugin components at the plugin root.
- `plugins/<plugin-name>/README.md` and `plugins/<plugin-name>/CLAUDE.md` — per-plugin docs.
- `test/<plugin-name>/test.bats` — per-plugin bats suite (top-level), executed by CI.
- `package.json` — bats + bats-support + bats-assert devDependencies (run with `BATS_LIB_PATH="$PWD/node_modules" npx bats`).
- `.github/workflows/ci.yml` — validates `marketplace.json` and each plugin manifest with `jq`.
- `.github/workflows/test.yml` — runs each plugin's `test/<name>/test.bats` via a static matrix.

## Checklist

Create a TodoWrite todo for each step and complete them in order.

1. **Gather inputs** — ask one question at a time.
2. **Validate the name** — kebab-case and not already taken.
3. **Scaffold the plugin directory** — `plugin.json` + chosen component stubs.
4. **Scaffold docs** — `plugins/<name>/README.md` (minimal) + `plugins/<name>/CLAUDE.md`, and add a row to the root README plugins table.
5. **Scaffold the test suite (hooks plugins only)** — `test/<name>/test.bats` + add the plugin to the `test.yml` matrix.
6. **Register in marketplace.json** — add an entry to the `plugins` array.
7. **Verify** — run the CI checks locally; manifests must pass and the bats suite (if scaffolded) must pass.
8. **Report** — list every file created or changed.

## Step 1 — Gather inputs

Ask one question at a time. Collect:

- **name** — kebab-case (lowercase letters, digits, hyphens), e.g. `my-plugin`. This is the directory name and the manifest `name`.
- **description** — one sentence describing what the plugin does.
- **author** — default to the marketplace owner (`Kwitsch`) unless told otherwise.
- **version** — default `0.1.0`.
- **category** — single string, e.g. `productivity`, `example` (optional).
- **tags** — array of short keywords (optional).
- **components** — which of `commands`, `skills`, `agents`, `hooks` to scaffold. At least one; `commands` is the common default.

## Step 2 — Validate the name

- Confirm the name matches `^[a-z0-9]+(-[a-z0-9]+)*$`.
- Confirm `plugins/<name>/` does not already exist.
- Confirm no entry in `.claude-plugin/marketplace.json` already uses that `name`.

If any check fails, report the conflict and ask for a different name. Do not overwrite an existing plugin.

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

Then scaffold a stub for each chosen component so the plugin is functional out of the box:

- **commands** → `plugins/<name>/commands/<name>.md`:

  ```markdown
  ---
  description: <short description of what this command does>
  ---

  Describe here what Claude should do when this command runs.
  ```

- **skills** → `plugins/<name>/skills/<name>/SKILL.md`:

  ```markdown
  ---
  name: <name>
  description: Use when <trigger condition> - <what the skill does>.
  ---

  # <Human-readable title>

  Step-by-step instructions for the skill go here.
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
`test/<name>/test.bats` (bats). Run: `BATS_LIB_PATH="$PWD/node_modules" npx bats test/<name>/`.
```

Add a row to the `## Plugins` table in the root `README.md`, preserving existing rows:

```markdown
| [<name>](plugins/<name>/README.md) | <description> |
```

## Step 5 — Scaffold the test suite (hooks plugins only)

Only when the user chose the `hooks` component, scaffold a bats suite so the
plugin is exercised in CI. Prompt-only plugins (commands/skills/agents) have
nothing executable to test — skip this step for them.

Create `test/<name>/test.bats` with a smoke test that already passes:

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

Then wire the plugin into CI: in `.github/workflows/test.yml`, append `- <name>`
under the `plugin:` key, preserving the existing entries and valid YAML:

```yaml
      matrix:
        plugin:
          - no-co-authored   # existing entry — keep it
          - <name>           # the new plugin
```

## Step 6 — Register in marketplace.json

Add an entry to the `plugins` array in `.claude-plugin/marketplace.json`. Keep
the existing entries and valid JSON (no trailing commas):

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

Use the full `./plugins/<name>` path — `metadata.pluginRoot` is documented but
broken in Claude Code (anthropics/claude-code#61224/#64431); reintroduce only
after the upstream fix. Do NOT add a `version` field — the plugin's own
plugin.json is the single source of truth (CI fails when a marketplace entry
declares one). Omit `category`/`tags` if the user did not provide them. `name`
and `source` are the only required fields per the marketplace spec.

## Step 7 — Verify (mirror the CI)

Run the same checks `.github/workflows/ci.yml` runs, so the PR is green:

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

All commands must succeed with no error output. Fix any failure before reporting done.

If a test suite was scaffolded (a hooks plugin), also run it and confirm it is
wired into the matrix:

```bash
# The new bats suite passes
BATS_LIB_PATH="$PWD/node_modules" npx bats "test/<name>/"

# The plugin is present in the test matrix ($ is grep's end-of-line anchor)
grep -q "^[[:space:]]*-[[:space:]]*<name>\$" .github/workflows/test.yml \
  || { echo "Missing test.yml matrix entry for <name>"; exit 1; }
```

## Step 8 — Report

List every file created — `plugin.json`, the chosen component stubs, `README.md`,
`CLAUDE.md`, the `marketplace.json` entry, and (for a hooks plugin)
`test/<name>/test.bats` plus the `test.yml` matrix entry — and remind the user
that the plugin can now be committed and installed via
`/plugin install <name>@kwitsch-plugins`.
