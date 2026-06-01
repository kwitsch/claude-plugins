#!/usr/bin/env bats
# Tests for the no-co-authored strip-coauthor hook.

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/plugins/no-co-authored/hooks/strip-coauthor.sh"

  HEREDOC="$(cat <<'CMD'
git commit -m "$(cat <<'EOF'
Add feature X

Implements the thing.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
CMD
)"

  PROSE="$(cat <<'CMD'
git commit -m "$(cat <<'EOF'
Document the footer behavior

We now strip the Generated with [Claude Code] line from messages.
EOF
)"
CMD
)"
}

# Build a PreToolUse payload from a command (+ optional description).
make_input() {
  if [ -n "${2:-}" ]; then
    jq -n --arg cmd "$1" --arg desc "$2" '{tool_name:"Bash",tool_input:{command:$cmd,description:$desc},hook_event_name:"PreToolUse"}'
  else
    jq -n --arg cmd "$1" '{tool_name:"Bash",tool_input:{command:$cmd},hook_event_name:"PreToolUse"}'
  fi
}

# Run the hook, print only the rewritten command.
clean_command() { bash "$HOOK" <<<"$1" | jq -r '.hookSpecificOutput.updatedInput.command'; }

@test "heredoc strips co-author trailer" {
  run clean_command "$(make_input "$HEREDOC")"
  assert_success
  refute_output --partial "Co-Authored-By:"
  assert_output --partial "Add feature X"
}

@test "heredoc strips claude footer" {
  run clean_command "$(make_input "$HEREDOC")"
  assert_success
  refute_output --partial "Generated with [Claude Code]"
  assert_output --partial "Implements the thing."
}

@test "inline -m co-author argument removed" {
  run clean_command "$(make_input 'git commit -m "Fix bug" -m "Co-Authored-By: Claude <noreply@anthropic.com>"')"
  assert_success
  refute_output --partial "Co-Authored-By:"
  assert_output --partial "Fix bug"
}

@test "permissionDecision is allow on rewrite" {
  run bash "$HOOK" <<<"$(make_input "$HEREDOC")"
  assert_success
  assert_equal "$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecision')" "allow"
}

@test "clean commit produces no output" {
  run bash "$HOOK" <<<"$(make_input 'git commit -m "Just a fix"')"
  assert_success
  assert_output ""
}

@test "non-commit command produces no output" {
  run bash "$HOOK" <<<"$(make_input 'ls -la')"
  assert_success
  assert_output ""
}

@test "malformed json fails open" {
  run bash "$HOOK" <<<"not json at all"
  assert_success
  assert_output ""
}

@test "commit mentioning footer text untouched" {
  run bash "$HOOK" <<<"$(make_input 'git commit -m "Document the Generated with [Claude Code] footer"')"
  assert_success
  assert_output ""
}

@test "preserves description field" {
  run bash "$HOOK" <<<"$(make_input "$HEREDOC" "commit the feature")"
  assert_success
  assert_equal "$(echo "$output" | jq -r '.hookSpecificOutput.updatedInput.description')" "commit the feature"
}

@test "multiline -m mid-string co-author fails open" {
  run bash "$HOOK" <<<"$(make_input 'git commit -m "Fix bug

Co-Authored-By: Claude <noreply@anthropic.com>"')"
  assert_success
  assert_output ""
}

@test "amend without message untouched" {
  run bash "$HOOK" <<<"$(make_input 'git commit --amend --no-edit')"
  assert_success
  assert_output ""
}

@test "footer prose without url preserved" {
  run bash "$HOOK" <<<"$(make_input "$PROSE")"
  assert_success
  assert_output ""
}

@test "node fallback rewrites when jq is absent" {
  command -v node >/dev/null || skip "node unavailable"
  bindir="$(mktemp -d)"
  for t in cat sed bash node; do ln -s "$(command -v "$t")" "$bindir/$t"; done
  run env PATH="$bindir" bash "$HOOK" <<<"$(make_input "$HEREDOC")"
  rm -rf "$bindir"
  assert_success
  assert_output --partial '"permissionDecision"'
  assert_output --partial "allow"
  refute_output --partial "Co-Authored-By: Claude"
}

@test "deny when neither jq nor node is present" {
  bindir="$(mktemp -d)"
  for t in cat sed bash; do ln -s "$(command -v "$t")" "$bindir/$t"; done
  run env PATH="$bindir" bash "$HOOK" <<<"$(make_input 'git commit -m "x"')"
  rm -rf "$bindir"
  assert_success
  assert_output --partial '"permissionDecision":"deny"'
  assert_output --partial "Co-Authored-By"
}
