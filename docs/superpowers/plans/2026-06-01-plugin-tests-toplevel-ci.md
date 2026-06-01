# Plugin Tests Top-Level Layout + CI Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move per-plugin tests into a top-level `test/<plugin>/test.sh` layout, run them in CI on PRs via a static matrix, and update the `create-plugin` skill to keep new plugins (and the matrix) in sync.

**Architecture:** Relocate the existing `no-co-authored` test script to `test/no-co-authored/test.sh` (adjusting only its path resolution), add a separate `.github/workflows/test.yml` workflow with a static plugin matrix, and teach `.claude/skills/create-plugin/SKILL.md` to scaffold a test stub + matrix entry whenever a `hooks` plugin is created.

**Tech Stack:** Bash test scripts, `jq`, GitHub Actions (matrix strategy). Work happens on the existing `feat/no-co-authored-plugin` branch (folded into PR #4).

---

## File structure

| File | Responsibility |
|------|----------------|
| `test/no-co-authored/test.sh` | The `no-co-authored` test suite (moved from `plugins/no-co-authored/hooks/test/run-tests.sh`), path-adjusted. |
| `.github/workflows/test.yml` | New workflow: runs each plugin's `test/<plugin>/test.sh` via a static matrix on PR / push / dispatch. |
| `.claude/skills/create-plugin/SKILL.md` | Updated: knows the test layout, scaffolds a test stub + matrix entry for hook plugins, verifies and reports them. |
| `plugins/no-co-authored/hooks/test/` (removed) | Old test location; deleted by the move. |

---

## Task 1: Move the test script to the top-level `test/` layout

**Files:**
- Create (via move): `test/no-co-authored/test.sh`
- Delete: `plugins/no-co-authored/hooks/test/run-tests.sh` (the move empties and removes `plugins/no-co-authored/hooks/test/`)

- [ ] **Step 1: Move the file with git (preserves history)**

```bash
mkdir -p test/no-co-authored
git mv plugins/no-co-authored/hooks/test/run-tests.sh test/no-co-authored/test.sh
```

- [ ] **Step 2: Confirm it fails before the path is fixed**

The moved script still points at the old relative hook path (`${HERE}/../strip-coauthor.sh`), which no longer resolves from `test/no-co-authored/`. Run it to see it fail:

Run: `bash test/no-co-authored/test.sh`
Expected: FAIL — the hook isn't found at the old relative path, so `run_hook` produces no output and the rewrite assertions report `FAIL:` (non-zero exit).

- [ ] **Step 3: Adjust the path resolution in `test/no-co-authored/test.sh`**

Replace these two lines near the top (currently lines 5-6):

```bash
HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="${HERE}/../strip-coauthor.sh"
```

with:

```bash
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
HOOK="$REPO_ROOT/plugins/no-co-authored/hooks/strip-coauthor.sh"
```

Everything else in the file (the `make_input`/`run_hook`/`pass`/`fail`/`assert_silent`/`assert_rewritten` helpers, the `HEREDOC` and `PROSE` fixtures, and all 12 assertions) stays exactly as-is.

- [ ] **Step 4: Run the suite to verify it passes from the new location**

Run: `bash test/no-co-authored/test.sh`
Expected: 12 `PASS:` lines, final line `ALL TESTS PASSED`, exit code 0.

- [ ] **Step 5: Confirm the old test directory is gone**

Run: `test -d plugins/no-co-authored/hooks/test && echo "STILL EXISTS" || echo "removed"`
Expected: `removed` (git mv removed the only file, so the directory is no longer tracked).

- [ ] **Step 6: Commit**

```bash
git add -A test/no-co-authored/test.sh plugins/no-co-authored/hooks/test
git commit -m "Move no-co-authored tests to top-level test/ layout"
```

---

## Task 2: Add the `test.yml` CI workflow

**Files:**
- Create: `.github/workflows/test.yml`

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/test.yml`:

```yaml
name: Test

on:
  pull_request:
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    strategy:
      fail-fast: false
      matrix:
        # Add a plugin here when it gains a test/<plugin>/test.sh suite.
        plugin:
          - no-co-authored
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Run ${{ matrix.plugin }} test suite
        run: bash "test/${{ matrix.plugin }}/test.sh"
```

- [ ] **Step 2: Validate the YAML syntax**

Run:
```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/test.yml')); print('YAML OK')"
```
Expected: `YAML OK`
(If `python3`/PyYAML is unavailable, fall back to: `ruby -ryaml -e "YAML.load_file('.github/workflows/test.yml'); puts 'YAML OK'"`.)

- [ ] **Step 3: Reproduce what the CI job will run, for the one matrix entry**

Run: `bash "test/no-co-authored/test.sh"`
Expected: `ALL TESTS PASSED`, exit 0 — this is exactly the command the `no-co-authored` matrix leg executes.

- [ ] **Step 4: Confirm every test directory is represented in the matrix**

This guards against the static matrix drifting from the `test/` tree:

```bash
for d in test/*/; do
  name="$(basename "$d")"
  grep -q "^[[:space:]]*-[[:space:]]*${name}\$" .github/workflows/test.yml \
    || { echo "test/${name}/ is not in the test.yml matrix"; exit 1; }
done
echo "matrix in sync"
```
Expected: `matrix in sync`

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "Add test.yml workflow running plugin suites via matrix"
```

---

## Task 3: Update the `create-plugin` skill

**Files:**
- Modify: `.claude/skills/create-plugin/SKILL.md`

This skill is an instruction document (Markdown), not executable code. Each step below is an exact text replacement; the final step verifies the embedded test stub is syntactically valid shell.

- [ ] **Step 1: Update the "Repository layout (recap)" section**

Replace:

```markdown
- `.claude-plugin/marketplace.json` — marketplace manifest at the repo root. Lists every plugin.
- `plugins/<plugin-name>/.claude-plugin/plugin.json` — per-plugin manifest.
- `plugins/<plugin-name>/{commands,skills,agents,hooks}/` — plugin components at the plugin root.
- `.github/workflows/ci.yml` — validates `marketplace.json` and each plugin manifest with `jq`.
```

with:

```markdown
- `.claude-plugin/marketplace.json` — marketplace manifest at the repo root. Lists every plugin.
- `plugins/<plugin-name>/.claude-plugin/plugin.json` — per-plugin manifest.
- `plugins/<plugin-name>/{commands,skills,agents,hooks}/` — plugin components at the plugin root.
- `test/<plugin-name>/test.sh` — per-plugin test suite (top-level), executed by CI.
- `.github/workflows/ci.yml` — validates `marketplace.json` and each plugin manifest with `jq`.
- `.github/workflows/test.yml` — runs each plugin's `test/<name>/test.sh` via a static matrix.
```

- [ ] **Step 2: Update the Checklist**

Replace:

```markdown
1. **Gather inputs** — ask one question at a time.
2. **Validate the name** — kebab-case and not already taken.
3. **Scaffold the plugin directory** — `plugin.json` + chosen component stubs.
4. **Register in marketplace.json** — add an entry to the `plugins` array.
5. **Verify** — run the CI checks locally; both manifests must pass.
6. **Report** — list every file created or changed.
```

with:

```markdown
1. **Gather inputs** — ask one question at a time.
2. **Validate the name** — kebab-case and not already taken.
3. **Scaffold the plugin directory** — `plugin.json` + chosen component stubs.
4. **Scaffold the test suite (hooks plugins only)** — `test/<name>/test.sh` + add the plugin to the `test.yml` matrix.
5. **Register in marketplace.json** — add an entry to the `plugins` array.
6. **Verify** — run the CI checks locally; both manifests must pass, and the test suite (if scaffolded) must pass.
7. **Report** — list every file created or changed.
```

- [ ] **Step 3: Insert the new "Step 4 — Scaffold the test suite" section**

Immediately before the line `## Step 4 — Register in marketplace.json`, insert this new section:

````markdown
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
          - <existing entries…>
          - <name>
```
````

- [ ] **Step 4: Renumber "Register in marketplace.json" to Step 5**

Replace the heading line:

```markdown
## Step 4 — Register in marketplace.json
```

with:

```markdown
## Step 5 — Register in marketplace.json
```

- [ ] **Step 5: Renumber "Verify" to Step 6 and add the test checks**

Replace:

```markdown
## Step 5 — Verify (mirror the CI)

Run the same checks `.github/workflows/ci.yml` runs, so the PR is green:
```

with:

```markdown
## Step 6 — Verify (mirror the CI)

Run the same checks `.github/workflows/ci.yml` runs, so the PR is green:
```

Then, immediately before the `## Step 6 — Report` heading (which becomes Step 7
in the next step), insert:

````markdown
If a test suite was scaffolded (a hooks plugin), also run it and confirm it is
wired into the matrix:

```bash
# The new suite passes
bash "test/<name>/test.sh"   # must end with: ALL TESTS PASSED

# The plugin is present in the test matrix
grep -q "^[[:space:]]*-[[:space:]]*<name>\$" .github/workflows/test.yml \
  || { echo "Missing test.yml matrix entry for <name>"; exit 1; }
```
````

- [ ] **Step 6: Renumber "Report" to Step 7 and mention the test files**

Replace:

```markdown
## Step 6 — Report

List every file created and the line added to `marketplace.json`, and remind the
user that the plugin can now be committed and installed via
`/plugin install <name>@claude-plugins`.
```

with:

```markdown
## Step 7 — Report

List every file created and the line added to `marketplace.json` (and, for a
hooks plugin, the `test/<name>/test.sh` file plus the `test.yml` matrix entry),
and remind the user that the plugin can now be committed and installed via
`/plugin install <name>@claude-plugins`.
```

- [ ] **Step 7: Verify the embedded test stub is valid shell**

Extract the stub from the skill, substitute a sample name, and syntax-check it:

```bash
awk '/^#!\/usr\/bin\/env bash$/{f=1} f{print} /^exit "\$fails"$/{if(f)exit}' \
  .claude/skills/create-plugin/SKILL.md | sed 's/<name>/sample/g' | bash -n -
echo "stub syntax OK ($?)"
```
Expected: `stub syntax OK (0)` (no syntax errors from `bash -n`).

- [ ] **Step 8: Sanity-check the document still reads in order**

Run:
```bash
grep -nE '^## Step [0-9]' .claude/skills/create-plugin/SKILL.md
```
Expected: Steps 1 through 7 in ascending order, with `Step 4 — Scaffold the test suite (hooks plugins only)` present.

- [ ] **Step 9: Commit**

```bash
git add .claude/skills/create-plugin/SKILL.md
git commit -m "Teach create-plugin skill the test layout and CI matrix"
```

---

## Manual verification (after push)

- On the PR, the new `Test` workflow runs a `no-co-authored` matrix leg that prints `ALL TESTS PASSED`.
- The existing `CI` workflow (marketplace validation) still runs and passes unchanged.

## Out of scope (per spec)

- Shared test helper library; dynamic matrix discovery; testing `example-plugin`; changing plugin code or `ci.yml`.
