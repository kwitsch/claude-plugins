#!/usr/bin/env bats
# Tests for the no-co-authored deny-coauthor hook (scan + deny, no rewrite).

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/plugins/no-co-authored/hooks/deny-coauthor.sh"

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

We now block the Generated with [Claude Code] line in messages.
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

decision() { bash "$HOOK" <<<"$1" | jq -r '.hookSpecificOutput.permissionDecision // empty'; }
reason()   { bash "$HOOK" <<<"$1" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty'; }

@test "deny: commit carrying a co-author trailer" {
  assert_equal "$(decision "$(make_input "$HEREDOC")")" "deny"
}

@test "deny: commit carrying the Claude Code footer" {
  cmd='git commit -m "Fix bug" -m "🤖 Generated with [Claude Code](https://claude.com/claude-code)"'
  assert_equal "$(decision "$(make_input "$cmd")")" "deny"
}

@test "deny: inline -m co-author argument" {
  cmd='git commit -m "Fix bug" -m "Co-Authored-By: Claude <noreply@anthropic.com>"'
  assert_equal "$(decision "$(make_input "$cmd")")" "deny"
}

@test "deny reason names the rule and tells Claude to recreate the commit" {
  run reason "$(make_input "$HEREDOC")"
  assert_output --partial "no-co-authored"
  assert_output --partial "Co-Authored-By"
  assert_output --partial "Recreate"
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

@test "commit mentioning footer text (no url) is not blocked" {
  run bash "$HOOK" <<<"$(make_input 'git commit -m "Document the Generated with [Claude Code] footer"')"
  assert_success
  assert_output ""
}

@test "footer prose without url is not blocked" {
  run bash "$HOOK" <<<"$(make_input "$PROSE")"
  assert_success
  assert_output ""
}

@test "amend without message untouched" {
  run bash "$HOOK" <<<"$(make_input 'git commit --amend --no-edit')"
  assert_success
  assert_output ""
}

@test "scan needs no jq/node: dirty commit still denied with only cat+bash" {
  bindir="$BATS_TEST_TMPDIR/bin"; mkdir -p "$bindir"
  for t in cat bash; do ln -s "$(command -v "$t")" "$bindir/$t"; done
  cmd='git commit -m "Fix" -m "Co-Authored-By: Claude <noreply@anthropic.com>"'
  run env PATH="$bindir" bash "$HOOK" <<<"$(make_input "$cmd")"
  assert_success
  assert_output --partial '"permissionDecision":"deny"'
}

@test "scan needs no jq/node: non-commit command left alone with only cat+bash" {
  bindir="$BATS_TEST_TMPDIR/bin"; mkdir -p "$bindir"
  for t in cat bash; do ln -s "$(command -v "$t")" "$bindir/$t"; done
  run env PATH="$bindir" bash "$HOOK" <<<"$(make_input 'ls -la')"
  assert_success
  assert_output ""
}
