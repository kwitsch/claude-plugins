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

make_key() { printf 'dummy-private-key\n' > "$KEY_FILE"; chmod 600 "$KEY_FILE"; }
no_key()   { rm -f "$KEY_FILE"; }
make_real_key()      { rm -f "$KEY_FILE" "$KEY_FILE.pub"; ssh-keygen -q -t ed25519 -N '' -C test -f "$KEY_FILE"; }
make_encrypted_key() { rm -f "$KEY_FILE" "$KEY_FILE.pub"; ssh-keygen -q -t ed25519 -N 'secret-pw' -C test -f "$KEY_FILE"; }

# Prefer ripgrep; fall back to grep if rg isn't installed. rg's -E means
# --encoding=ARG and -r means --replace=ARG (both take a value, neither is
# grep's meaning), and rg has no recursive flag (recursion is its
# default) — so a bundled/bare -E is stripped before delegating to rg
# (its regex syntax is already ERE-equivalent for every pattern used in
# this file); grep gets its original arguments completely untouched.
# Note: bare `rg -c` prints nothing on 0 matches where `grep -c` prints `0`
# (both exit 1) -- no call site here checks that text (only $status or a
# nonzero count), so this divergence is accepted rather than papered over
# with --include-zero, which errors on ripgrep < 12.0.0.
rg_or_grep() {
  if command -v rg >/dev/null 2>&1; then
    local args=() a stripped seen_dashdash=false
    for a in "$@"; do
      if [ "$seen_dashdash" = true ]; then
        args+=("$a")
        continue
      fi
      case "$a" in
        --) seen_dashdash=true; args+=("$a") ;;
        -[A-Za-z]*)
          stripped="${a//E/}"
          [ "$stripped" = "-" ] && continue
          args+=("$stripped")
          ;;
        *) args+=("$a") ;;
      esac
    done
    command rg "${args[@]}"
  else
    command grep "$@"
  fi
}

count_partial() { rg_or_grep -o "$1" <<<"$2" | wc -l | tr -d ' '; }

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
  assert_output "cd /repo && git -c gpg.format=ssh -c gpg.ssh.program=ssh-keygen -c user.signingkey='$KEY_FILE' -c commit.gpgsign=true commit"
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
  count="$(rg_or_grep -o "user.signingkey=" <<<"$output" | wc -l | tr -d ' ')"
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

@test "rewrite injects gpg.ssh.program=ssh-keygen to bypass a custom signer" {
  make_key
  run rewrite "$(make_input 'git commit -m x')"
  assert_success
  assert_output --partial "gpg.ssh.program=ssh-keygen"
}

@test "both commits in a compound command are signed" {
  make_key
  run rewrite "$(make_input 'git commit -m a && git commit -m b')"
  assert_success
  assert_equal "$(count_partial 'user.signingkey=' "$output")" "2"
  assert_output --partial 'commit -m a'
  assert_output --partial 'commit -m b'
}

@test "git -C <path> commit is signed" {
  make_key
  run rewrite "$(make_input 'git -C /repo commit -m x')"
  assert_success
  assert_output --partial "gpg.ssh.program=ssh-keygen"
  assert_output --partial "-C /repo commit -m x"
  run bash -n <<<"$output"
  assert_success
}

@test "git --no-pager commit is signed" {
  make_key
  run rewrite "$(make_input 'git --no-pager commit -m x')"
  assert_success
  assert_output --partial "gpg.format=ssh"
  assert_output --partial "--no-pager commit -m x"
}

@test "commit followed by a semicolon is signed" {
  make_key
  run rewrite "$(make_input 'git commit; echo done')"
  assert_success
  assert_output --partial "gpg.format=ssh"
  assert_output --partial "commit; echo done"
}

@test "commit followed by a newline is signed" {
  make_key
  run rewrite "$(make_input "$(printf 'git commit\necho hi')")"
  assert_success
  assert_output --partial "gpg.format=ssh"
  assert_output --partial "echo hi"
}

@test "quoted 'git commit' in an earlier argument is not mistaken for the real commit" {
  make_key
  run rewrite "$(make_input 'echo "git commit now" && git commit -m x')"
  assert_success
  assert_equal "$(count_partial 'user.signingkey=' "$output")" "1"
  assert_output --partial 'echo "git commit now"'   # the echoed string must stay untouched
  assert_output --partial 'commit -m x'
}

@test "already-wired command is left untouched (idempotent)" {
  make_key
  wired="git -c gpg.format=ssh -c gpg.ssh.program=ssh-keygen -c user.signingkey='$KEY_FILE' -c commit.gpgsign=true commit -m x"
  run bash "$SIGN_HOOK" <<<"$(make_input "$wired")"
  assert_success
  assert_output ""
}

@test "a separator inside the commit message does not corrupt the message" {
  make_key
  run rewrite "$(make_input 'git commit -m "fix; git commit later"')"
  assert_success
  assert_equal "$(count_partial 'user.signingkey=' "$output")" "1"
  assert_output --partial '-m "fix; git commit later"'   # message must be byte-for-byte intact
}

@test "parenthesised 'git commit' inside the message does not corrupt the message" {
  make_key
  run rewrite "$(make_input 'git commit -m "see (git commit) here"')"
  assert_success
  assert_equal "$(count_partial 'user.signingkey=' "$output")" "1"
  assert_output --partial 'see (git commit) here'
}

@test "separator + 'git commit' inside a quoted argument is left untouched" {
  make_key
  run rewrite "$(make_input 'echo "x; git commit" && git commit -m x')"
  assert_success
  assert_equal "$(count_partial 'user.signingkey=' "$output")" "1"
  assert_output --partial 'echo "x; git commit"'   # quoted literal untouched
  assert_output --partial 'commit -m x'
}

@test "real 'git commit' inside \$(...) substitution is still signed (refactor guard)" {
  make_key
  run rewrite "$(make_input 'out=$(git commit -m x)')"
  assert_success
  assert_output --partial "gpg.format=ssh"
  assert_output --partial 'commit -m x)'
}

@test "real 'git commit' inside backticks is signed" {
  make_key
  run rewrite "$(make_input 'out=`git commit`')"
  assert_success
  assert_output --partial "gpg.format=ssh"
}

@test "a user-pinned gpg.ssh.program alone does not suppress key injection" {
  make_key
  run rewrite "$(make_input 'git -c gpg.ssh.program=ssh-keygen commit -m x')"
  assert_success
  assert_output --partial "user.signingkey="
}

@test "degenerate 'git -- commit' is not treated as a commit invocation" {
  make_key
  run bash "$SIGN_HOOK" <<<"$(make_input 'git -- commit')"
  assert_success
  assert_output ""
}

@test "env-var assignment prefix before git commit is still signed" {
  make_key
  run rewrite "$(make_input 'GIT_COMMITTER_DATE="2020-01-01 00:00:00" git commit -m x')"
  assert_success
  assert_output --partial "gpg.format=ssh"
  assert_output --partial 'commit -m x'
}

@test "assignment-looking token as a command argument is not a commit position" {
  make_key
  run bash "$SIGN_HOOK" <<<"$(make_input 'make FOO=bar')"
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

@test "SessionStart warns when key is passphrase-encrypted" {
  command -v ssh-keygen >/dev/null || skip "ssh-keygen unavailable"
  make_encrypted_key
  run bash "$CHECK_HOOK"
  assert_success
  assert_output --partial "encrypted"
  run jq -e '.hookSpecificOutput.additionalContext' <<<"$output"
  assert_success
}

@test "SessionStart is silent for a valid unencrypted key" {
  command -v ssh-keygen >/dev/null || skip "ssh-keygen unavailable"
  make_real_key
  run bash "$CHECK_HOOK"
  assert_success
  assert_output ""
}

@test "SessionStart warns when an encrypted key also has loose permissions" {
  command -v ssh-keygen >/dev/null || skip "ssh-keygen unavailable"
  make_encrypted_key
  chmod 644 "$KEY_FILE"   # ssh-keygen reports 'bad permissions' before it ever reaches the decrypt step
  run bash "$CHECK_HOOK"
  assert_success
  assert_output --partial "sign.key"
  run jq -e '.hookSpecificOutput.additionalContext' <<<"$output"
  assert_success
}

@test "plugin.json is valid JSON with name and version 1.1.0" {
  run jq -e '.name == "git-sign-key" and .version == "1.1.0"' \
    "$REPO_ROOT/plugins/git-sign-key/.claude-plugin/plugin.json"
  assert_success
}
