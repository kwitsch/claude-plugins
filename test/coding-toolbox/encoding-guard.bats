#!/usr/bin/env bats

# encoding-guard hook (PreToolUse non-UTF-8 deny gate) — coding-toolbox plugin.

load 'test_helper'

setup() {
  common_setup
}

# ---------------------------------------------------------------------------
# encoding-guard hook — pure-Node PreToolUse deny gate for non-UTF-8 files.
# Fixtures are generated per test with printf byte escapes (hermetic).
# ---------------------------------------------------------------------------

# encoding_guard <tool_name> <file_path> — drive the hook with a file-tool
# input; prints the hook's stdout.
encoding_guard() {
  jq -cn --arg t "$1" --arg f "$2" \
    '{tool_name:$t, tool_input:{file_path:$f}, cwd:"/"}' \
    | "$HOOKS/encoding-guard.mjs" 2>/dev/null
}
make_fixtures() {
  FIX="$BATS_TEST_TMPDIR/fix"
  mkdir -p "$FIX"
  printf 'T\344glich gr\374\337t der B\344r\n'            > "$FIX/legacy.txt"
  printf 'T\303\244glich gr\303\274\303\237t\n'           > "$FIX/utf8.txt"
  printf 'plain ascii\n'                                  > "$FIX/ascii.txt"
  printf '\357\273\277bom utf8\n'                         > "$FIX/utf8bom.txt"
  printf '\377\376h\000i\000\n\000'                       > "$FIX/utf16le.txt"
  printf 'h\000e\000l\000l\000o\000\n\000'                > "$FIX/utf16-nobom.txt"
  printf '\211PNG\r\n\032\n\000\000\000\015IHDR'          > "$FIX/binary.png"
  : > "$FIX/empty.txt"
}
@test "encoding-guard is executable" {
  [ -x "$HOOKS/encoding-guard.mjs" ]
}
@test "encoding-guard allows UTF-8, ASCII, UTF-8-BOM, binary, empty and missing files" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_fixtures
  for f in utf8.txt ascii.txt utf8bom.txt binary.png empty.txt missing.txt; do
    run encoding_guard Read "$FIX/$f"
    assert_success
    [ -z "$output" ] || { echo "unexpected output for $f: $output"; false; }
  done
}
@test "encoding-guard denies Read of a legacy single-byte file with an iconv hint" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_fixtures
  run encoding_guard Read "$FIX/legacy.txt"
  assert_success
  assert_output --partial '"permissionDecision":"deny"'
  assert_output --partial 'ISO-8859-1/Windows-1252'
  assert_output --partial 'iconv -f WINDOWS-1252 -t UTF-8'
}
@test "encoding-guard denies Edit and Write of a legacy file, allows Write to a new path" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_fixtures
  run encoding_guard Edit "$FIX/legacy.txt"
  assert_success
  assert_output --partial '"permissionDecision":"deny"'
  run encoding_guard Write "$FIX/legacy.txt"
  assert_success
  assert_output --partial '"permissionDecision":"deny"'
  run encoding_guard Write "$FIX/brand-new-file.txt"
  assert_success
  [ -z "$output" ]
}
@test "encoding-guard names UTF-16 with and without BOM" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_fixtures
  run encoding_guard Read "$FIX/utf16le.txt"
  assert_success
  assert_output --partial 'UTF-16LE'
  run encoding_guard Read "$FIX/utf16-nobom.txt"
  assert_success
  assert_output --partial 'UTF-16LE (no BOM)'
}
@test "encoding-guard fails open on garbage stdin and unknown tools" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_fixtures
  run bash -c "printf 'not json at all' | '$HOOKS/encoding-guard.mjs' 2>/dev/null"
  assert_success
  [ -z "$output" ]
  run encoding_guard Glob "$FIX/legacy.txt"
  assert_success
  [ -z "$output" ]
}
@test "encoding-guard Bash corpus: every deny/allow case classifies as expected" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local dir="$BATS_TEST_TMPDIR/corpus"
  mkdir -p "$dir"
  printf 'T\344glich gr\374\337t der B\344r\n'  > "$dir/legacy.txt"
  printf 'T\303\244glich gr\303\274\303\237t\n' > "$dir/utf8.txt"
  local failures="" cmd expect json out
  while IFS= read -r case_b64; do
    cmd="$(printf '%s' "$case_b64" | base64 -d | jq -r '.cmd')"
    expect="$(printf '%s' "$case_b64" | base64 -d | jq -r '.expect')"
    json="$(jq -cn --arg c "$cmd" --arg d "$dir" '{tool_name:"Bash", tool_input:{command:$c}, cwd:$d}')"
    out="$(printf '%s' "$json" | "$HOOKS/encoding-guard.mjs" 2>/dev/null)" \
      || { failures+="[exit!=0] $cmd"$'\n'; continue; }
    if [ "$expect" = "deny" ]; then
      [[ "$out" == *'"permissionDecision":"deny"'* ]] \
        || failures+="[expected deny, got allow] $cmd"$'\n'
    else
      [ -z "$out" ] || failures+="[expected allow, got: $out] $cmd"$'\n'
    fi
  done < <(jq -r '.[] | @base64' "$BATS_TEST_DIRNAME/encoding-guard-corpus.json")
  if [ -n "$failures" ]; then
    echo "$failures"
    false
  fi
}
@test "encoding-guard PreToolUse hook wired as a direct .mjs command hook" {
  run jq -e '.hooks.PreToolUse[0]
    | .matcher == "Read|Edit|Write|Bash"
      and (.hooks[0].type == "command")
      and (.hooks[0].command == "${CLAUDE_PLUGIN_ROOT}/hooks/encoding-guard.mjs")
      and (.hooks[0] | has("args") | not)' "$HOOKS/hooks.json"
  assert_success
}
@test "PreToolUse has exactly one hook entry (encoding-guard)" {
  run jq -e '.hooks.PreToolUse | length == 1' "$HOOKS/hooks.json"
  assert_success
}
@test "plugin.json description mentions the encoding guard" {
  run jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json"
  assert_output --partial "non-UTF-8"
}
