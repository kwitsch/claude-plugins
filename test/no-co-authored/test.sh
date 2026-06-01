#!/usr/bin/env bash
# Fixture-based tests for strip-coauthor.sh. No external test framework.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
HOOK="$REPO_ROOT/plugins/no-co-authored/hooks/strip-coauthor.sh"
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

PROSE=$(cat <<'CMD'
git commit -m "$(cat <<'EOF'
Document the footer behavior

We now strip the Generated with [Claude Code] line from messages.
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
out=$(run_hook 'not json at all')
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

# 9. Co-author embedded mid-string in a multiline -m arg: stripping the trailer
#    line would orphan the closing quote, so the cleaned command would be broken
#    -> fail-open (no output), original runs untouched.
assert_silent "multiline -m mid-string co-author fails open" \
  'git commit -m "Fix bug

Co-Authored-By: Claude <noreply@anthropic.com>"'

# 10. git commit --amend with no message flags -> nothing to strip, no output.
assert_silent "amend without message untouched" 'git commit --amend --no-edit'

# 11. Body prose that mentions the footer NAME but not its URL must be preserved
#     (the footer rule only matches the full "[Claude Code](http..." signature).
assert_silent "footer prose without url preserved" "$PROSE"

echo "----"
if [ "$fails" -eq 0 ]; then echo "ALL TESTS PASSED"; else echo "$fails TEST(S) FAILED"; fi
exit "$fails"
