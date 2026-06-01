# no-co-authored Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code plugin that registers a PreToolUse hook which strips `Co-Authored-By:` trailers and the Claude Code footer from `git commit` messages before the command runs.

**Architecture:** A single PreToolUse hook matching the `Bash` tool invokes a Bash script. The script reads the planned tool call from stdin, detects `git commit`, removes the offending lines/arguments from the command string, and returns the cleaned command via `updatedInput` with `permissionDecision: "allow"`. It fails open (exits 0 with no output) on any doubt, so it never blocks or corrupts a commit.

**Tech Stack:** Bash, `jq`, `sed`. Plugin packaged in the spec-compliant marketplace layout (`plugins/<name>/`).

---

## File structure

| File | Responsibility |
|------|----------------|
| `plugins/no-co-authored/.claude-plugin/plugin.json` | Plugin manifest (name, version, description, author). |
| `plugins/no-co-authored/hooks/hooks.json` | Registers the PreToolUse hook on the Bash tool. |
| `plugins/no-co-authored/hooks/strip-coauthor.sh` | The rewrite logic (reads stdin JSON, emits decision JSON). |
| `plugins/no-co-authored/hooks/test/run-tests.sh` | Fixture-based test harness (no external test framework). |
| `.claude-plugin/marketplace.json` | Add the `no-co-authored` entry to the `plugins` array. |

### Cleaning rules (the core of the script)

The script removes, from the command string:
1. **Own-line `Co-Authored-By:` trailers** — lines starting (after optional whitespace, case-insensitive) with `Co-Authored-By:`. This is the dominant Claude Code heredoc form. The `git commit` line never starts this way, so it is safe.
2. **Inline `-m "Co-Authored-By: …"` arguments** — both double- and single-quoted, removed in place.
3. **The Claude Code footer line** — any line containing `Generated with [Claude Code]`, **except** a line that also contains `git commit` (guard against deleting the command line itself when the footer text appears inline).

Trailing/collapsed blank lines left behind are NOT cleaned by the script — `git commit -m` uses cleanup mode `strip` by default, which trims leading/trailing empty lines and collapses consecutive ones. Letting git do this keeps the script simple and safe.

---

## Task 1: Plugin manifest and hook configuration

**Files:**
- Create: `plugins/no-co-authored/.claude-plugin/plugin.json`
- Create: `plugins/no-co-authored/hooks/hooks.json`

- [ ] **Step 1: Create the plugin manifest**

Create `plugins/no-co-authored/.claude-plugin/plugin.json`:

```json
{
  "name": "no-co-authored",
  "version": "0.1.0",
  "description": "Strips Co-Authored-By trailers and the Claude Code footer from git commit messages before they run.",
  "author": {
    "name": "Kwitsch"
  }
}
```

- [ ] **Step 2: Create the hook configuration**

Create `plugins/no-co-authored/hooks/hooks.json`. The script is invoked via `bash` explicitly so an unset executable bit (common on Windows-mounted filesystems) cannot break it:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/strip-coauthor.sh\""
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Validate both files are well-formed JSON**

Run:
```bash
jq empty plugins/no-co-authored/.claude-plugin/plugin.json && \
jq empty plugins/no-co-authored/hooks/hooks.json && echo "JSON OK"
```
Expected: `JSON OK`

- [ ] **Step 4: Commit**

```bash
git add plugins/no-co-authored/.claude-plugin/plugin.json plugins/no-co-authored/hooks/hooks.json
git commit -m "Add no-co-authored plugin manifest and hook config"
```

---

## Task 2: Hook script (TDD)

**Files:**
- Create: `plugins/no-co-authored/hooks/test/run-tests.sh`
- Create: `plugins/no-co-authored/hooks/strip-coauthor.sh`

- [ ] **Step 1: Write the failing test harness**

Create `plugins/no-co-authored/hooks/test/run-tests.sh` with the full suite. Fixtures are built with `jq -n` so multi-line commands are JSON-escaped correctly:

```bash
#!/usr/bin/env bash
# Fixture-based tests for strip-coauthor.sh. No external test framework.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="${HERE}/../strip-coauthor.sh"
fails=0

# Build a PreToolUse stdin payload from a command string (and optional description).
make_input() {
  jq -n --arg cmd "$1" --arg desc "${2-}" \
    'if $desc == "" then
       {tool_name:"Bash", tool_input:{command:$cmd}, hook_event_name:"PreToolUse"}
     else
       {tool_name:"Bash", tool_input:{command:$cmd, description:$desc}, hook_event_name:"PreToolUse"}
     end'
}

run_hook() { printf '%s' "$1" | bash "$HOOK"; }

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1 — $2"; fails=$((fails+1)); }

# Assert the hook produced NO output (fail-open / no change).
assert_silent() {
  local name="$1" input out
  input=$(make_input "$2" "${3-}")
  out=$(run_hook "$input")
  [ -z "$out" ] && pass "$name" || fail "$name" "expected no output, got: $out"
}

# Assert the hook rewrote the command, that it is allowed, that $absent is gone
# and $present is still there.
assert_rewritten() {
  local name="$1" cmdstr="$2" absent="$3" present="$4"
  local input out decision cmd ok=1
  input=$(make_input "$cmdstr")
  out=$(run_hook "$input")
  if [ -z "$out" ]; then fail "$name" "expected rewrite, got no output"; return; fi
  decision=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision')
  cmd=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.updatedInput.command')
  [ "$decision" = "allow" ] || { fail "$name" "decision '$decision' != allow"; ok=0; }
  if printf '%s' "$cmd" | grep -qF "$absent"; then fail "$name" "'$absent' still present in: $cmd"; ok=0; fi
  printf '%s' "$cmd" | grep -qF "$present" || { fail "$name" "'$present' missing from: $cmd"; ok=0; }
  [ "$ok" -eq 1 ] && pass "$name"
}

# --- Fixtures ---

HEREDOC=$(cat <<'CMD'
git commit -m "$(cat <<'EOF'
Add feature X

Implements the thing.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
CMD
)

# 1. Heredoc commit with footer + co-author -> both removed, real content kept.
assert_rewritten "heredoc strips co-author" "$HEREDOC" "Co-Authored-By:" "Add feature X"
assert_rewritten "heredoc strips footer" "$HEREDOC" "Generated with [Claude Code]" "Implements the thing."

# 2. Inline -m co-author argument -> argument removed, real message kept.
assert_rewritten "inline -m co-author removed" \
  'git commit -m "Fix bug" -m "Co-Authored-By: Claude <noreply@anthropic.com>"' \
  "Co-Authored-By:" "Fix bug"

# 3. Clean commit -> no output (must not auto-approve clean commits).
assert_silent "clean commit untouched" 'git commit -m "Just a fix"'

# 4. Non-commit Bash command -> no output.
assert_silent "non-commit untouched" 'ls -la'

# 5. Malformed JSON on stdin -> fail-open, no output.
out=$(printf '%s' 'not json at all' | bash "$HOOK")
[ -z "$out" ] && pass "malformed json fail-open" || fail "malformed json fail-open" "got: $out"

# 6. git commit line that merely MENTIONS the footer text -> must NOT be deleted.
assert_silent "commit mentioning footer text untouched" \
  'git commit -m "Document the Generated with [Claude Code] footer"'

# 7. Preserves other tool_input fields (description) when rewriting.
desc_input=$(make_input "$HEREDOC" "commit the feature")
desc_out=$(run_hook "$desc_input")
desc_kept=$(printf '%s' "$desc_out" | jq -r '.hookSpecificOutput.updatedInput.description')
[ "$desc_kept" = "commit the feature" ] \
  && pass "preserves description field" \
  || fail "preserves description field" "got: '$desc_kept'"

# 8. Simulated missing jq -> fail-open. Resolve bash's absolute path FIRST (under
#    the normal PATH), then run the hook with a PATH that contains no jq. The
#    script's `command -v jq || exit 0` fires before any external tool is needed.
BASH_BIN=$(command -v bash)
out=$(PATH="/nonexistent" "$BASH_BIN" "$HOOK" </dev/null)
[ -z "$out" ] && pass "missing jq fail-open" || fail "missing jq fail-open" "got: $out"

echo "----"
if [ "$fails" -eq 0 ]; then echo "ALL TESTS PASSED"; else echo "$fails TEST(S) FAILED"; fi
exit "$fails"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
bash plugins/no-co-authored/hooks/test/run-tests.sh
```
Expected: FAIL — the script does not exist yet, so `bash "$HOOK"` errors and assertions report failures (non-zero exit).

- [ ] **Step 3: Write the hook script**

Create `plugins/no-co-authored/hooks/strip-coauthor.sh`:

```bash
#!/usr/bin/env bash
# PreToolUse hook: strip Co-Authored-By trailers and the Claude Code footer
# from git commit messages before the command runs.
#
# Reads the PreToolUse JSON payload on stdin. Fail-open: on any doubt it exits 0
# with no output so the original command runs unchanged (never block/corrupt a
# commit).
set -u

# Fail-open if jq is unavailable.
command -v jq >/dev/null 2>&1 || exit 0

input=$(cat)

# Extract the planned Bash command; bail if absent or unparseable.
command_str=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$command_str" ] || exit 0

# Only act on git commits (literal "git commit" sequence; exotic forms like
# "git -c x=y commit" are out of scope and pass through unchanged).
case "$command_str" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

# Clean the command string:
#  1. own-line Co-Authored-By trailers (heredoc form)
#  2. inline -m "Co-Authored-By: ..." arguments (double- and single-quoted)
#  3. the Claude Code footer line, but never a line that is the commit command
#     itself (guards against deleting `git commit ...` if footer text is inline)
cleaned=$(printf '%s' "$command_str" | sed -E \
  -e '/^[[:space:]]*[Cc]o-[Aa]uthored-[Bb]y:/d' \
  -e 's/[[:space:]]*-m[[:space:]]+"[[:space:]]*[Cc]o-[Aa]uthored-[Bb]y:[^"]*"//g' \
  -e "s/[[:space:]]*-m[[:space:]]+'[[:space:]]*[Cc]o-[Aa]uthored-[Bb]y:[^']*'//g" \
  -e '/Generated with \[Claude Code\]/{/git[[:space:]]+commit/!d;}')

# Nothing removed -> stay silent so clean commits are not auto-approved.
[ "$cleaned" = "$command_str" ] && exit 0

# Emit the rewritten command, preserving the other tool_input fields.
printf '%s' "$input" | jq --arg cmd "$cleaned" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    updatedInput: (.tool_input + { command: $cmd }),
    additionalContext: "no-co-authored: removed Co-Authored-By / Claude Code footer lines from the commit message before running."
  }
}'
exit 0
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
bash plugins/no-co-authored/hooks/test/run-tests.sh
```
Expected: every line `PASS: …`, final line `ALL TESTS PASSED`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add plugins/no-co-authored/hooks/strip-coauthor.sh plugins/no-co-authored/hooks/test/run-tests.sh
git commit -m "Add strip-coauthor hook script with tests"
```

---

## Task 3: Register the plugin in the marketplace

**Files:**
- Modify: `.claude-plugin/marketplace.json` (the `plugins` array)

- [ ] **Step 1: Add the marketplace entry**

In `.claude-plugin/marketplace.json`, the `plugins` array currently holds only `example-plugin`. Replace the array so it reads exactly:

```json
  "plugins": [
    {
      "name": "example-plugin",
      "source": "./plugins/example-plugin",
      "description": "Example plugin demonstrating the spec-compliant marketplace layout.",
      "version": "0.1.0",
      "author": {
        "name": "Kwitsch"
      },
      "category": "example",
      "tags": ["example", "scaffold"]
    },
    {
      "name": "no-co-authored",
      "source": "./plugins/no-co-authored",
      "description": "Strips Co-Authored-By trailers and the Claude Code footer from git commit messages before they run.",
      "version": "0.1.0",
      "author": {
        "name": "Kwitsch"
      },
      "category": "git",
      "tags": ["git", "hooks", "commit"]
    }
  ]
```

- [ ] **Step 2: Reproduce the CI validation locally**

Run the same checks `.github/workflows/ci.yml` performs:

```bash
manifest=".claude-plugin/marketplace.json"
jq empty "$manifest" && \
jq -e '.name and .owner and (.plugins | type == "array")' "$manifest" >/dev/null && \
jq -e 'all(.plugins[]; .name and .source)' "$manifest" >/dev/null && \
test -d plugins/no-co-authored && \
jq empty plugins/no-co-authored/.claude-plugin/plugin.json && \
echo "MARKETPLACE OK"
```
Expected: `MARKETPLACE OK`

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/marketplace.json
git commit -m "Register no-co-authored plugin in marketplace"
```

---

## Task 4: End-to-end sanity check

**Files:** none (verification only)

- [ ] **Step 1: Pipe a realistic Claude Code commit through the hook**

Run (this reproduces the exact heredoc form Claude Code emits). Build the command
string with a literal heredoc, then wrap it as a payload with `jq`:

```bash
cmd=$(cat <<'CMD'
git commit -m "$(cat <<'EOF'
Real commit title

Body paragraph.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
CMD
)
jq -n --arg cmd "$cmd" '{tool_name:"Bash",tool_input:{command:$cmd},hook_event_name:"PreToolUse"}' \
  | bash plugins/no-co-authored/hooks/strip-coauthor.sh \
  | jq -r '.hookSpecificOutput.updatedInput.command'
```

Expected: the printed command keeps `Real commit title` and `Body paragraph.` but contains **neither** `Co-Authored-By:` **nor** `Generated with [Claude Code]`.

- [ ] **Step 2: Confirm the full suite is green**

Run:
```bash
bash plugins/no-co-authored/hooks/test/run-tests.sh
```
Expected: `ALL TESTS PASSED`.

---

## Manual verification (after merge / install)

These cannot be scripted in this repo and are for the user to confirm in a live Claude Code session:

1. Install: `/plugin marketplace add kwitsch/claude-plugins` then `/plugin install no-co-authored@claude-plugins`.
2. Ask Claude to make a commit; observe that the executed `git commit` carries no `Co-Authored-By:` line and no Claude Code footer.
3. Inspect `git log -1 --format=%B` to confirm the stored message is clean.

## Out of scope (documented limitations)

- `git commit` without `-m` (opens an editor) and `git commit -F <file>`: the message is not in the command string, so it is passed through unchanged.
- Exotic invocations such as `git -c key=val commit`: not detected; passed through unchanged.
- Inline `-m` carrying the footer text (rather than `Co-Authored-By:`) is not stripped, but is protected from corruption by the `git commit` guard on rule 3.
