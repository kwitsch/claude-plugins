---
name: create-plugin
description: Use when adding a new plugin to this claude-plugins marketplace - scaffolds plugins/<name>/ with a spec-compliant plugin.json and chosen components (commands, skills, agents, hooks), then registers the plugin in .claude-plugin/marketplace.json and verifies both manifests with the same checks the CI runs.
---

# Creating a New Marketplace Plugin

Scaffold a new plugin in this repository and register it in the marketplace
manifest, so that it passes CI and is installable via the marketplace.

## Repository layout (recap)

- `.claude-plugin/marketplace.json` — marketplace manifest at the repo root. Lists every plugin.
- `plugins/<plugin-name>/.claude-plugin/plugin.json` — per-plugin manifest.
- `plugins/<plugin-name>/{commands,skills,agents,hooks}/` — plugin components at the plugin root.
- `test/<plugin-name>/test.sh` — per-plugin test suite (top-level), executed by CI.
- `.github/workflows/ci.yml` — validates `marketplace.json` and each plugin manifest with `jq`.
- `.github/workflows/test.yml` — runs each plugin's `test/<name>/test.sh` via a static matrix.

## Checklist

Create a TodoWrite todo for each step and complete them in order.

1. **Gather inputs** — ask one question at a time.
2. **Validate the name** — kebab-case and not already taken.
3. **Scaffold the plugin directory** — `plugin.json` + chosen component stubs.
4. **Scaffold the test suite (hooks plugins only)** — `test/<name>/test.sh` + add the plugin to the `test.yml` matrix.
5. **Register in marketplace.json** — add an entry to the `plugins` array.
6. **Verify** — run the CI checks locally; both manifests must pass, and the test suite (if scaffolded) must pass.
7. **Report** — list every file created or changed.

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

Only create the directories for components the user actually chose.

## Step 4 — Scaffold the test suite (hooks plugins only)

Only when the user chose the `hooks` component, scaffold a test suite so the
plugin is exercised in CI. Prompt-only plugins (commands/skills/agents) have
nothing executable to test — skip this step for them.

Create `test/<name>/test.sh` with a runnable smoke test that already passes, so
the plugin is green in CI from the start and there is a clear place to add real
tests:

```bash
#!/usr/bin/env bash
# Tests for the <name> plugin. Run: bash test/<name>/test.sh
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
PLUGIN="$REPO_ROOT/plugins/<name>"
fails=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1 — $2"; fails=$((fails+1)); }

# Smoke test: the hook configuration is valid JSON.
if jq empty "$PLUGIN/hooks/hooks.json" 2>/dev/null; then
  pass "hooks.json is valid JSON"
else
  fail "hooks.json is valid JSON" "invalid or missing"
fi

# TODO: add behavioral tests for this plugin's hooks here.

echo "----"
if [ "$fails" -eq 0 ]; then echo "ALL TESTS PASSED"; else echo "$fails TEST(S) FAILED"; fi
exit "$fails"
```

Then wire the plugin into CI: in `.github/workflows/test.yml`, append a new list
item `- <name>` under the `plugin:` key, preserving the existing entries and
valid YAML:

```yaml
      matrix:
        plugin:
          - no-co-authored   # existing entry — keep it
          - <name>           # the new plugin
```

## Step 5 — Register in marketplace.json

Add an entry to the `plugins` array in `.claude-plugin/marketplace.json`. Keep
the existing entries and valid JSON (no trailing commas):

```json
{
  "name": "<name>",
  "source": "./plugins/<name>",
  "description": "<description>",
  "version": "<version>",
  "author": {
    "name": "<author>"
  },
  "category": "<category>",
  "tags": ["<tag1>", "<tag2>"]
}
```

Omit `category`/`tags` if the user did not provide them. `name` and `source` are
the only required fields per the marketplace spec.

## Step 6 — Verify (mirror the CI)

Run the same checks `.github/workflows/ci.yml` runs, so the PR is green:

```bash
manifest=".claude-plugin/marketplace.json"

# marketplace.json is valid JSON
jq empty "$manifest"

# Required top-level fields
jq -e '.name and .owner and (.plugins | type == "array")' "$manifest" >/dev/null

# Every plugin entry has name + source
jq -e 'all(.plugins[]; .name and .source)' "$manifest" >/dev/null

# Every local plugin source exists and its manifest is valid JSON
jq -r '.plugins[].source' "$manifest" | while IFS= read -r src; do
  case "$src" in
    ./*)
      test -d "$src" || { echo "Missing source dir: $src"; exit 1; }
      pm="$src/.claude-plugin/plugin.json"
      [ -f "$pm" ] && jq empty "$pm"
      ;;
  esac
done
```

All commands must succeed with no error output. Fix any failure before reporting done.

If a test suite was scaffolded (a hooks plugin), also run it and confirm it is
wired into the matrix:

```bash
# The new suite passes
bash "test/<name>/test.sh"   # must end with: ALL TESTS PASSED

# The plugin is present in the test matrix (\$ is grep's end-of-line anchor)
grep -q "^[[:space:]]*-[[:space:]]*<name>\$" .github/workflows/test.yml \
  || { echo "Missing test.yml matrix entry for <name>"; exit 1; }
```

## Step 7 — Report

List every file created and the line added to `marketplace.json` (and, for a
hooks plugin, the `test/<name>/test.sh` file plus the `test.yml` matrix entry),
and remind the user that the plugin can now be committed and installed via
`/plugin install <name>@claude-plugins`.
