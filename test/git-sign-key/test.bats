#!/usr/bin/env bats
# Tests for git-sign-key: the sign-commits PreToolUse hook and the
# check-sign-key SessionStart hook.

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SIGN_HOOK="$REPO_ROOT/plugins/git-sign-key/hooks/sign-commits.sh"
  CHECK_HOOK="$REPO_ROOT/plugins/git-sign-key/hooks/check-sign-key.sh"

  # Isolated HOME so ~/.claude/sign.key is under our control.
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME/.claude"
  KEY_FILE="$HOME/.claude/sign.key"
}

make_key() { printf 'dummy-private-key\n' > "$KEY_FILE"; }
no_key()   { rm -f "$KEY_FILE"; }

# Build a PreToolUse payload from a command (+ optional description).
make_input() {
  if [ -n "${2:-}" ]; then
    jq -n --arg cmd "$1" --arg desc "$2" '{tool_name:"Bash",tool_input:{command:$cmd,description:$desc},hook_event_name:"PreToolUse"}'
  else
    jq -n --arg cmd "$1" '{tool_name:"Bash",tool_input:{command:$cmd},hook_event_name:"PreToolUse"}'
  fi
}

# Run the sign hook, print the rewritten command.
rewrite() { bash "$SIGN_HOOK" <<<"$1" | jq -r '.hookSpecificOutput.updatedInput.command'; }

#
# sign-commits.sh — PreToolUse
#

@test "rewrites git commit when key present" {
  make_key
  run rewrite "$(make_input 'git commit -m "Fix bug"')"
  assert_success
  assert_output --partial "gpg.format=ssh"
  assert_output --partial "user.signingkey='$HOME/.claude/sign.key'"
  assert_output --partial "commit.gpgsign=true"
  assert_output --partial 'commit -m "Fix bug"'
}

@test "permissionDecision is allow on rewrite" {
  make_key
  run bash "$SIGN_HOOK" <<<"$(make_input 'git commit -m x')"
  assert_success
  assert_equal "$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecision')" "allow"
}

@test "no rewrite when key absent" {
  no_key
  run bash "$SIGN_HOOK" <<<"$(make_input 'git commit -m x')"
  assert_success
  assert_output ""
}

@test "non-commit command untouched (key present)" {
  make_key
  run bash "$SIGN_HOOK" <<<"$(make_input 'ls -la')"
  assert_success
  assert_output ""
}

@test "commit whose message mentions the key path is still signed" {
  make_key
  run rewrite "$(make_input "git commit -m 'update $KEY_FILE docs'")"
  assert_success
  assert_output --partial "gpg.format=ssh"
  assert_output --partial "update $KEY_FILE docs"
}

@test "non-commit git subcommand starting with 'commit' is untouched" {
  make_key
  run bash "$SIGN_HOOK" <<<"$(make_input 'git commit-tree -p HEAD')"
  assert_success
  assert_output ""
}

@test "bare 'git commit' at end of string is rewritten" {
  make_key
  run rewrite "$(make_input 'cd /repo && git commit')"
  assert_success
  assert_output "cd /repo && git -c gpg.format=ssh -c user.signingkey='$KEY_FILE' -c commit.gpgsign=true commit"
}

@test "ampersand in \$HOME stays literal in the injected key path" {
  export HOME="$BATS_TEST_TMPDIR/a&b"
  mkdir -p "$HOME/.claude"
  KEY_FILE="$HOME/.claude/sign.key"
  make_key
  run rewrite "$(make_input 'git commit -m x')"
  assert_success
  assert_output --partial "user.signingkey='$HOME/.claude/sign.key'"
  refute_output --partial "git commitb"
}

@test "preserves other tool_input fields" {
  make_key
  run bash "$SIGN_HOOK" <<<"$(make_input 'git commit -m x' 'commit the fix')"
  assert_success
  assert_equal "$(echo "$output" | jq -r '.hookSpecificOutput.updatedInput.description')" "commit the fix"
}

@test "malformed json fails open" {
  make_key
  run bash "$SIGN_HOOK" <<<"not json at all"
  assert_success
  assert_output ""
}

@test "injects signing config exactly once when message contains 'git commit'" {
  make_key
  run rewrite "$(make_input 'git commit -m "fix the git commit flow"')"
  assert_success
  count="$(grep -o "user.signingkey=" <<<"$output" | wc -l | tr -d ' ')"
  assert_equal "$count" "1"
  assert_output --partial 'fix the git commit flow'
}

@test "rewritten command is valid shell" {
  make_key
  run rewrite "$(make_input 'git commit -m "Fix bug"')"
  assert_success
  assert_output --partial "gpg.format=ssh"   # guard against a fail-open empty pass
  run bash -n <<<"$output"
  assert_success
}

@test "heredoc commit message is signed and preserved" {
  make_key
  heredoc="$(cat <<'CMD'
git commit -m "$(cat <<'EOF'
Add feature

Body line.
EOF
)"
CMD
)"
  run rewrite "$(make_input "$heredoc")"
  assert_success
  assert_output --partial "gpg.format=ssh"
  assert_output --partial "Add feature"
  assert_output --partial "Body line."
}

@test "node fallback rewrites when jq is absent" {
  command -v node >/dev/null || skip "node unavailable"
  make_key
  bindir="$BATS_TEST_TMPDIR/bin"; mkdir -p "$bindir"
  for t in cat bash node grep printf; do
    src="$(command -v "$t")" && [ -n "$src" ] && ln -s "$src" "$bindir/$t"
  done
  run env PATH="$bindir" HOME="$HOME" bash "$SIGN_HOOK" <<<"$(make_input 'git commit -m x')"
  assert_success
  assert_output --partial '"permissionDecision"'
  assert_output --partial "allow"
  assert_output --partial "gpg.format=ssh"
}

@test "fails open (exit 0, no output) when neither jq nor node is present" {
  make_key
  bindir="$BATS_TEST_TMPDIR/bin"; mkdir -p "$bindir"
  for t in cat bash; do ln -s "$(command -v "$t")" "$bindir/$t"; done
  run env PATH="$bindir" HOME="$HOME" bash "$SIGN_HOOK" <<<"$(make_input 'git commit -m x')"
  assert_success
  assert_output ""
}

#
# check-sign-key.sh — SessionStart
#

@test "SessionStart warns when key is missing" {
  no_key
  run bash "$CHECK_HOOK"
  assert_success
  assert_output --partial "sign.key"
  assert_output --partial "ssh-keygen"
}

@test "SessionStart is silent when key exists" {
  make_key
  run bash "$CHECK_HOOK"
  assert_success
  assert_output ""
}

@test "SessionStart warning is valid JSON with additionalContext" {
  no_key
  out="$(bash "$CHECK_HOOK")"
  run jq empty <<<"$out"
  assert_success
  assert_equal "$(jq -r '.hookSpecificOutput.hookEventName' <<<"$out")" "SessionStart"
  run jq -e '.hookSpecificOutput.additionalContext' <<<"$out"
  assert_success
}
