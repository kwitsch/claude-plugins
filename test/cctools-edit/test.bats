#!/usr/bin/env bats
# Tests for cctools-edit: platform→asset mapping (lib.sh / install-cctools.sh),
# the redirect-to-cctools PreToolUse hook, the session-start hook, and the
# guard-bash PreToolUse hook (adversarial corpus + unit cases).
#
# Hermetic — no network: a dummy executable stands in for the cc-tools binary,
# the OS/arch mapping is checked via --print-asset/--print-url with
# CCTOOLS_OS/CCTOOLS_ARCH overrides, and CCTOOLS_SKIP_INSTALL keeps SessionStart
# from attempting a download.

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOKS="$REPO_ROOT/plugins/cctools-edit/hooks"
  INSTALL="$HOOKS/install-cctools.sh"
  REDIRECT="$HOOKS/redirect-to-cctools.sh"
  SESSION="$HOOKS/session-start.sh"
  GUARD="$HOOKS/guard-bash.sh"
  CORPUS="$REPO_ROOT/test/cctools-edit/bash-guard-corpus.json"

  # A stand-in cc-tools binary that answers --version (so the "installed" guard
  # passes) without any download.
  BIN="$BATS_TEST_TMPDIR/cctools"
  cat > "$BIN" <<'EOF'
#!/usr/bin/env bash
[ "$1" = "--version" ] && { echo "cctools version 1.0.0"; exit 0; }
exit 0
EOF
  chmod +x "$BIN"
  export CCTOOLS_BIN="$BIN"

  # Encoding fixtures for the Bash-guard tests. legacy.txt is non-UTF-8
  # (ISO-8859-1, byte 0xe9); utf8.txt is valid UTF-8; a/b.txt are ASCII.
  WORK="$BATS_TEST_TMPDIR/work"
  mkdir -p "$WORK"
  printf 'caf\xe9\n'     > "$WORK/legacy.txt"
  printf 'caf\xc3\xa9\n' > "$WORK/utf8.txt"
  printf 'plain\n'       > "$WORK/a.txt"
  printf 'plain\n'       > "$WORK/b.txt"
}

# Run the Bash guard in stdin (hook) mode from the fixture dir, on a command.
guard_stdin() {
  local payload
  payload=$(jq -nc --arg c "$1" '{tool_name:"Bash",tool_input:{command:$c},hook_event_name:"PreToolUse"}')
  (cd "$WORK" && printf '%s' "$payload" | bash "$GUARD")
}

# PreToolUse payload for a given tool + file path.
make_input() {
  jq -n --arg t "$1" --arg f "$2" \
    '{tool_name:$t,tool_input:{file_path:$f},hook_event_name:"PreToolUse"}'
}
decision() { jq -r '.hookSpecificOutput.permissionDecision'; }
reason()   { jq -r '.hookSpecificOutput.permissionDecisionReason'; }

#
# hooks.json
#

@test "hooks.json is valid JSON" {
  run jq empty "$HOOKS/hooks.json"
  assert_success
}

@test "hooks.json wires SessionStart + PreToolUse(Read|Write|Edit|MultiEdit)" {
  assert_equal "$(jq -r '.hooks.PreToolUse[0].matcher' "$HOOKS/hooks.json")" "Read|Write|Edit|MultiEdit"
  run jq -e '.hooks.SessionStart' "$HOOKS/hooks.json"
  assert_success
}

#
# Platform → release asset mapping (install-cctools.sh --print-asset / --print-url)
#

@test "asset mapping: linux/x86_64 -> cctools_linux_amd64.tar.gz" {
  run env CCTOOLS_OS=Linux CCTOOLS_ARCH=x86_64 bash "$INSTALL" --print-asset
  assert_success
  assert_output "cctools_linux_amd64.tar.gz"
}

@test "asset mapping: Darwin/arm64 -> cctools_darwin_arm64.tar.gz" {
  run env CCTOOLS_OS=Darwin CCTOOLS_ARCH=arm64 bash "$INSTALL" --print-asset
  assert_success
  assert_output "cctools_darwin_arm64.tar.gz"
}

@test "asset mapping: linux/aarch64 -> cctools_linux_arm64.tar.gz" {
  run env CCTOOLS_OS=Linux CCTOOLS_ARCH=aarch64 bash "$INSTALL" --print-asset
  assert_success
  assert_output "cctools_linux_arm64.tar.gz"
}

@test "asset mapping: MINGW64/x86_64 -> cctools_windows_amd64.zip" {
  run env CCTOOLS_OS=MINGW64_NT-10.0 CCTOOLS_ARCH=x86_64 bash "$INSTALL" --print-asset
  assert_success
  assert_output "cctools_windows_amd64.zip"
}

@test "asset mapping: i686 normalises to 386" {
  run env CCTOOLS_OS=Linux CCTOOLS_ARCH=i686 bash "$INSTALL" --print-asset
  assert_success
  assert_output "cctools_linux_386.tar.gz"
}

@test "download URL embeds the pinned tag and the asset" {
  run env CCTOOLS_OS=Linux CCTOOLS_ARCH=x86_64 bash "$INSTALL" --print-url
  assert_success
  assert_output "https://github.com/devslimbr/cc-tools/releases/download/v1.0.0.0/cctools_linux_amd64.tar.gz"
}

@test "CCTOOLS_VERSION overrides the tag in the URL" {
  run env CCTOOLS_VERSION=v9.9.9 CCTOOLS_OS=Linux CCTOOLS_ARCH=x86_64 bash "$INSTALL" --print-url
  assert_success
  assert_output --partial "/download/v9.9.9/"
}

@test "windows binary path gets the .exe suffix" {
  run env CCTOOLS_BIN= CCTOOLS_HOME=/opt/cc CCTOOLS_OS=Windows CCTOOLS_ARCH=amd64 bash "$INSTALL" --print-bin
  assert_success
  assert_output "/opt/cc/cctools.exe"
}

#
# install-cctools.sh — guards (no network)
#

@test "install is a no-op when a runnable binary is already present" {
  # CCTOOLS_BIN points at our dummy -> the present-and-runnable guard returns
  # before any download is attempted.
  run bash "$INSTALL"
  assert_success
}

@test "CCTOOLS_SKIP_INSTALL short-circuits install" {
  run env CCTOOLS_SKIP_INSTALL=1 CCTOOLS_BIN=/nonexistent/cctools bash "$INSTALL"
  assert_success
  assert_output ""
}

#
# redirect-to-cctools.sh — PreToolUse
#

@test "fails open (exit 0, no output) when the binary is absent" {
  run env CCTOOLS_BIN=/nonexistent/cctools bash "$REDIRECT" <<<"$(make_input Edit /tmp/a.txt)"
  assert_success
  assert_output ""
}

@test "denies Edit and points at cctools edit" {
  run bash "$REDIRECT" <<<"$(make_input Edit /work/legacy.pas)"
  assert_success
  assert_equal "$(echo "$output" | decision)" "deny"
  echo "$output" | reason | grep -q "cctools" || { echo "no cctools in reason"; return 1; }
  echo "$output" | reason | grep -q "edit --file '/work/legacy.pas'"
}

@test "denies Read and points at read --detect-encoding" {
  run bash "$REDIRECT" <<<"$(make_input Read /work/legacy.pas)"
  assert_success
  assert_equal "$(echo "$output" | decision)" "deny"
  echo "$output" | reason | grep -q "read --file '/work/legacy.pas' --detect-encoding"
}

@test "denies Write and points at write --stdin" {
  run bash "$REDIRECT" <<<"$(make_input Write /work/new.txt)"
  assert_success
  assert_equal "$(echo "$output" | decision)" "deny"
  echo "$output" | reason | grep -q "write --file '/work/new.txt' --stdin"
}

@test "denies MultiEdit and points at multiedit --edits-file" {
  run bash "$REDIRECT" <<<"$(make_input MultiEdit /work/cfg.ini)"
  assert_success
  assert_equal "$(echo "$output" | decision)" "deny"
  echo "$output" | reason | grep -q "multiedit --edits-file"
}

@test "deny output is valid JSON with the PreToolUse event name" {
  out="$(bash "$REDIRECT" <<<"$(make_input Edit /tmp/a.txt)")"
  run jq empty <<<"$out"
  assert_success
  assert_equal "$(jq -r '.hookSpecificOutput.hookEventName' <<<"$out")" "PreToolUse"
}

@test "unrecognised tool fails open" {
  run bash "$REDIRECT" <<<"$(make_input Bash /tmp/a.txt)"
  assert_success
  assert_output ""
}

@test "malformed JSON fails open" {
  run bash "$REDIRECT" <<<"not json at all"
  assert_success
  assert_output ""
}

@test "file path with spaces survives into the reason" {
  run bash "$REDIRECT" <<<"$(make_input Edit '/work/my file.pas')"
  assert_success
  echo "$output" | reason | grep -q "edit --file '/work/my file.pas'"
}

@test "node fallback denies when jq is absent" {
  command -v node >/dev/null || skip "node unavailable"
  bindir="$BATS_TEST_TMPDIR/bin"; mkdir -p "$bindir"
  for t in cat bash node dirname find head printf; do
    src="$(command -v "$t")" && [ -n "$src" ] && ln -sf "$src" "$bindir/$t"
  done
  run env PATH="$bindir" CCTOOLS_BIN="$BIN" bash "$REDIRECT" <<<"$(make_input Edit /work/legacy.pas)"
  assert_success
  assert_output --partial '"permissionDecision"'
  assert_output --partial "deny"
  assert_output --partial "edit --file '/work/legacy.pas'"
}

#
# session-start.sh — SessionStart
#

@test "SessionStart primes the model when the binary is present (no user warning)" {
  out="$(CCTOOLS_SKIP_INSTALL=1 bash "$SESSION")"
  run jq empty <<<"$out"
  assert_success
  assert_equal "$(jq -r '.hookSpecificOutput.hookEventName' <<<"$out")" "SessionStart"
  ctx="$(jq -r '.hookSpecificOutput.additionalContext' <<<"$out")"
  grep -q "cctools-edit active" <<<"$ctx"
  grep -q "read --file" <<<"$ctx"
  grep -q "multiedit --edits-file" <<<"$ctx"
  # No user-facing warning while the plugin is active.
  assert_equal "$(jq -r '.systemMessage // "null"' <<<"$out")" "null"
}

@test "SessionStart priming asserts cc-tools precedence over sandbox/ctx tools for legacy files" {
  out="$(CCTOOLS_SKIP_INSTALL=1 bash "$SESSION")"
  ctx="$(jq -r '.hookSpecificOutput.additionalContext' <<<"$out")"
  # When another plugin (e.g. context-mode) routes file reads through a sandbox
  # tool (ctx_execute_file/...), that path UTF-8-decodes and corrupts non-UTF-8
  # bytes AND bypasses cctools-edit's matchers. The priming must tell the model
  # cc-tools takes precedence for non-UTF-8 files.
  grep -q "context-mode" <<<"$ctx"
  grep -q "ctx_execute" <<<"$ctx"
  grep -q "precedence" <<<"$ctx"
}

@test "SessionStart shows a user-facing warning when the binary is absent" {
  out="$(CCTOOLS_SKIP_INSTALL=1 CCTOOLS_BIN=/nonexistent/cctools bash "$SESSION")"
  run jq empty <<<"$out"
  assert_success
  # systemMessage is surfaced directly to the user.
  msg="$(jq -r '.systemMessage // ""' <<<"$out")"
  grep -q "INACTIVE" <<<"$msg"
  grep -q "cctools-edit" <<<"$msg"
  # additionalContext still informs Claude.
  ctx="$(jq -r '.hookSpecificOutput.additionalContext' <<<"$out")"
  grep -q "not installed" <<<"$ctx"
  grep -q "cc-tools/releases" <<<"$ctx"
}

#
# guard-bash.sh — PreToolUse Bash guard
#

@test "bash guard: full adversarial corpus (deny vs allow), 0 mismatches" {
  local n i cmd exp got fails=0 msg=""
  n=$(jq 'length' "$CORPUS")
  for ((i = 0; i < n; i++)); do
    cmd=$(jq -r ".[$i].cmd" "$CORPUS")
    exp=$(jq -r ".[$i].expect | map(sub(\".*/\"; \"\")) | unique | join(\",\")" "$CORPUS")
    got=$(cd "$WORK" && bash "$GUARD" --check "$cmd" 2>/dev/null | sed 's#.*/##' | sort -u | paste -sd, -)
    if [ "$got" != "$exp" ]; then
      fails=$((fails + 1))
      msg="$msg"$'\n'"case #$i: cmd=[$cmd] expected=[$exp] got=[$got]"
    fi
  done
  [ "$fails" -eq 0 ] || { echo "$msg"; false; }
}

@test "bash guard: denies an in-place edit of a legacy file (valid deny JSON)" {
  run guard_stdin "sed -i 's/a/b/' legacy.txt"
  assert_success
  assert_equal "$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecision')" "deny"
  echo "$output" | jq -r '.hookSpecificOutput.permissionDecisionReason' | grep -q "legacy.txt"
  echo "$output" | jq -r '.hookSpecificOutput.permissionDecisionReason' | grep -q "cc-tools"
}

@test "bash guard: allows reading/writing a UTF-8 file" {
  run guard_stdin "cat utf8.txt"
  assert_success
  assert_output ""
  run guard_stdin "echo hi > utf8.txt"
  assert_success
  assert_output ""
}

@test "bash guard: fails open when the cc-tools binary is absent" {
  run env CCTOOLS_BIN=/nonexistent/cctools bash -c "cd '$WORK' && printf '%s' '$(jq -nc '{tool_name:"Bash",tool_input:{command:"sed -i s/a/b/ legacy.txt"}}')' | bash '$GUARD'"
  assert_success
  assert_output ""
}

@test "bash guard: non-Bash tool falls open" {
  local payload
  payload=$(jq -nc '{tool_name:"Read",tool_input:{command:"cat legacy.txt"}}')
  run bash -c "cd '$WORK' && printf '%s' '$payload' | bash '$GUARD'"
  assert_success
  assert_output ""
}

@test "bash guard: --strip removes operators inside quotes" {
  run bash "$GUARD" --strip "echo '> legacy.txt'"
  assert_success
  refute_output --partial ">"
}

@test "bash guard: node fallback denies when jq is absent" {
  command -v node >/dev/null || skip "node unavailable"
  bindir="$BATS_TEST_TMPDIR/bin"; mkdir -p "$bindir"
  for t in cat bash node dirname find head printf sed tr file base64 sort; do
    src="$(command -v "$t")" && [ -n "$src" ] && ln -sf "$src" "$bindir/$t"
  done
  payload=$(jq -nc --arg c "sed -i s/a/b/ legacy.txt" '{tool_name:"Bash",tool_input:{command:$c}}')
  run env PATH="$bindir" CCTOOLS_BIN="$BIN" bash -c "cd '$WORK' && printf '%s' '$payload' | bash '$GUARD'"
  assert_success
  assert_output --partial '"permissionDecision"'
  assert_output --partial "deny"
  assert_output --partial "legacy.txt"
}

@test "bash guard: classifier forks file(1) at most once per distinct path" {
  # Stub `file` to count invocations and always report a legacy encoding. A
  # command that mentions the SAME legacy file four times must fork `file` only
  # ONCE (per-run encoding memo) — the fork dominates this hook's latency.
  local sbin="$BATS_TEST_TMPDIR/sbin"; mkdir -p "$sbin"
  local cnt="$BATS_TEST_TMPDIR/file-call-count"; : > "$cnt"
  cat > "$sbin/file" <<EOF
#!/usr/bin/env bash
printf 'x' >> "$cnt"
echo "iso-8859-1"
EOF
  chmod +x "$sbin/file"
  local cmd="echo a > legacy.txt; echo b > legacy.txt; echo c > legacy.txt; echo d > legacy.txt"
  ( cd "$WORK" && PATH="$sbin:$PATH" bash "$GUARD" --check "$cmd" >/dev/null )
  assert_equal "$(wc -c < "$cnt" | tr -d ' ')" "1"
}

# --check from the fixture dir so the existing-legacy-file gate can see legacy.txt.
guard_check() { (cd "$WORK" && bash "$GUARD" --check "$1"); }

@test "bash guard: input redirect into a processor is allowed; cat read is denied" {
  # A processing command reading via `< legacy.txt` returns processed output, not
  # raw bytes, and never mutates the file -> ALLOW. A bare `cat` view dumps raw
  # bytes -> DENY (both `cat < f` and `cat f`). Guards the false-positive fix.
  run guard_check "grep -c x < legacy.txt"
  assert_success
  assert_output ""
  run guard_check "wc -l < legacy.txt"
  assert_success
  assert_output ""
  run guard_check "cat < legacy.txt"
  assert_success
  assert_output --partial "legacy.txt"
}

#
# bun runtime fallback — context-mode brings bun; cctools-edit must not silently
# disable when only bun (no jq, no node) is available.
#

@test "redirect: bun fallback denies when jq and node are absent" {
  command -v bun >/dev/null || skip "bun unavailable"
  bindir="$BATS_TEST_TMPDIR/bunbin1"; mkdir -p "$bindir"
  for t in bash bun cat dirname printf; do
    src="$(command -v "$t")" && [ -n "$src" ] && ln -sf "$src" "$bindir/$t"
  done
  run env PATH="$bindir" CCTOOLS_BIN="$BIN" bash "$REDIRECT" <<<"$(make_input Edit /work/legacy.pas)"
  assert_success
  assert_output --partial '"permissionDecision"'
  assert_output --partial "deny"
  assert_output --partial "edit --file '/work/legacy.pas'"
}

@test "bash guard: bun fallback denies when jq and node are absent" {
  command -v bun >/dev/null || skip "bun unavailable"
  bindir="$BATS_TEST_TMPDIR/bunbin2"; mkdir -p "$bindir"
  for t in cat bash bun dirname find head printf sed tr file base64 sort; do
    src="$(command -v "$t")" && [ -n "$src" ] && ln -sf "$src" "$bindir/$t"
  done
  payload=$(jq -nc --arg c "sed -i s/a/b/ legacy.txt" '{tool_name:"Bash",tool_input:{command:$c}}')
  run env PATH="$bindir" CCTOOLS_BIN="$BIN" bash -c "cd '$WORK' && printf '%s' '$payload' | bash '$GUARD'"
  assert_success
  assert_output --partial "deny"
  assert_output --partial "legacy.txt"
}

@test "SessionStart primes via bun when jq and node are absent" {
  command -v bun >/dev/null || skip "bun unavailable"
  bindir="$BATS_TEST_TMPDIR/bunbin3"; mkdir -p "$bindir"
  for t in bash bun cat dirname printf head tr uname mktemp; do
    src="$(command -v "$t")" && [ -n "$src" ] && ln -sf "$src" "$bindir/$t"
  done
  out="$(env PATH="$bindir" CCTOOLS_SKIP_INSTALL=1 CCTOOLS_BIN="$BIN" bash "$SESSION")"
  grep -q "cctools-edit active" <<<"$out"
  grep -q "read --file" <<<"$out"
}

@test "bash guard: JS fallback fails open cleanly on a non-string command (no NUL warning)" {
  command -v node >/dev/null || skip "node unavailable"
  bindir="$BATS_TEST_TMPDIR/arrbin"; mkdir -p "$bindir"
  for t in cat bash node dirname find head printf sed tr file base64 sort; do
    src="$(command -v "$t")" && [ -n "$src" ] && ln -sf "$src" "$bindir/$t"
  done
  # command as a JSON array (malformed) — must fail open: exit 0, no deny, and no
  # "ignored null byte" warning leaking from the base64-carry command substitution.
  payload='{"tool_name":"Bash","tool_input":{"command":["sed","-i","legacy.txt"]}}'
  run env PATH="$bindir" CCTOOLS_BIN="$BIN" bash -c "cd '$WORK' && printf '%s' '$payload' | bash '$GUARD'"
  assert_success
  assert_output ""
  refute_output --partial "null byte"
}

@test "SessionStart warns when no JSON runtime (jq/node/bun) is available" {
  bindir="$BATS_TEST_TMPDIR/nort"; mkdir -p "$bindir"
  for t in bash cat dirname printf head tr uname mktemp; do
    src="$(command -v "$t")" && [ -n "$src" ] && ln -sf "$src" "$bindir/$t"
  done
  out="$(env PATH="$bindir" CCTOOLS_SKIP_INSTALL=1 CCTOOLS_BIN="$BIN" bash "$SESSION")"
  grep -q "INACTIVE" <<<"$out"
  grep -q "no jq, node, or bun" <<<"$out"
}
