#!/usr/bin/env bats

# bin/cbm-launch.sh — toggle gate, platform guard, cache resolution, verified lazy
# extraction and exec. Runs a COPY of the launcher inside a fabricated fixture plugin
# tree whose tarball holds a few-byte stub binary; the real 279.6 MiB binary is never
# extracted here.

load 'test_helper'

setup() {
  common_setup
  FIXTURE="$BATS_TEST_TMPDIR/plugin"
  make_cbm_fixture "$FIXTURE"
  FIXTURE_TAR="$FIXTURE/bin/codebase-memory-mcp-linux-amd64-portable.tar.gz"
  FIXTURE_SUMS="$FIXTURE/bin/cbm-checksums.txt"
  CACHE="$BATS_TEST_TMPDIR/cache"
  BIN_SHA="$(awk '$2 == "codebase-memory-mcp" { print $1 }' "$FIXTURE_SUMS")"
  CACHE_BIN="$CACHE/${BIN_SHA:0:16}/codebase-memory-mcp"
}

# launch_run [VAR=VALUE ...] -- [launcher args ...]
# `--separate-stderr` is load-bearing: stdout is the launcher's MCP JSON-RPC channel and
# every assertion here is about stdout alone, while diagnostics legitimately go to stderr
# (asserted separately via $stderr).
launch_run() {
  local envs=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
    envs+=("$1")
    shift
  done
  [ "${1:-}" = "--" ] && shift
  run --separate-stderr env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" \
    CBM_BUNDLE_CACHE="$CACHE" "${envs[@]}" bash "$FIXTURE/bin/cbm-launch.sh" "$@"
}

@test "toggle false disables: exit 0, no stdout, no cache" {
  launch_run CLAUDE_PLUGIN_OPTION_CBM_ENABLED=false
  assert_success
  assert_output ''
  [ ! -d "$CACHE" ]
}

@test "toggle false with surrounding whitespace still disables" {
  launch_run 'CLAUDE_PLUGIN_OPTION_CBM_ENABLED=  false  '
  assert_success
  assert_output ''
  [ ! -d "$CACHE" ]
}

@test "the disabled diagnostic names the toggle and goes to stderr" {
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" \
    CBM_BUNDLE_CACHE="$CACHE" CLAUDE_PLUGIN_OPTION_CBM_ENABLED=false \
    bash -c "bash '$FIXTURE/bin/cbm-launch.sh' 2>&1 1>/dev/null"
  assert_success
  assert_output --partial 'cbm_enabled'
}

@test "fail-open: unset, empty, true, FALSE, a placeholder and junk all extract and exec" {
  for value in __UNSET__ '' true FALSE '${user_config.cbm_enabled}' maybe; do
    rm -rf "$CACHE"
    if [ "$value" = "__UNSET__" ]; then
      launch_run
    else
      launch_run "CLAUDE_PLUGIN_OPTION_CBM_ENABLED=$value"
    fi
    assert_success
    assert_output 'CBM-STUB '
    [ -x "$CACHE_BIN" ]
  done
}

@test "warm cache is used even after the tarball is deleted" {
  launch_run
  assert_success
  rm -f "$FIXTURE_TAR"
  launch_run
  assert_success
  assert_output 'CBM-STUB '
}

@test "CBM_NO_EXTRACT on a cold cache is silence, on a warm cache it still runs" {
  launch_run CBM_NO_EXTRACT=1
  assert_success
  assert_output ''
  [ ! -d "$CACHE" ]
  launch_run
  assert_success
  launch_run CBM_NO_EXTRACT=1
  assert_success
  assert_output 'CBM-STUB '
}

@test "a corrupted tarball fails closed before extraction" {
  printf 'x' >> "$FIXTURE_TAR"
  launch_run
  assert_failure
  assert_output ''
  [[ "$stderr" == *checksum* ]]
  [ ! -e "$CACHE_BIN" ]
}

@test "a duplicated or missing binary entry in the sidecar fails closed" {
  local line
  line="$(awk '$2 == "codebase-memory-mcp"' "$FIXTURE_SUMS")"
  printf '%s\n' "$line" >> "$FIXTURE_SUMS"
  launch_run
  assert_failure
  [ ! -e "$CACHE_BIN" ]
  grep -v '  codebase-memory-mcp$' "$FIXTURE_SUMS" > "$FIXTURE_SUMS.new"
  mv -f "$FIXTURE_SUMS.new" "$FIXTURE_SUMS"
  launch_run
  assert_failure
}

@test "a tarball whose binary hashes differently never enters the cache" {
  mkdir -p "$BATS_TEST_TMPDIR/pack2"
  make_stub_in "$BATS_TEST_TMPDIR/pack2" codebase-memory-mcp 'printf "OTHER\n"'
  tar -czf "$FIXTURE_TAR" -C "$BATS_TEST_TMPDIR/pack2" codebase-memory-mcp
  local new_asset
  new_asset="$(sha256sum < "$FIXTURE_TAR" | cut -d' ' -f1)"
  {
    printf '%s  codebase-memory-mcp-linux-amd64-portable.tar.gz\n' "$new_asset"
    printf '%s  codebase-memory-mcp\n' "$BIN_SHA"
  } > "$FIXTURE_SUMS"
  launch_run
  assert_failure
  [ ! -e "$CACHE_BIN" ]
}

@test "an uninterpolated CBM_BUNDLE_CACHE falls back to TMPDIR and creates no literal dir" {
  run --separate-stderr env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" \
    CBM_BUNDLE_CACHE='${CLAUDE_PLUGIN_DATA}/cbm' bash "$FIXTURE/bin/cbm-launch.sh"
  assert_success
  assert_output 'CBM-STUB '
  run bash -c "find '$BATS_TEST_TMPDIR' -maxdepth 4 -name '\${CLAUDE_PLUGIN_DATA}' | grep -c . || true"
  assert_output '0'
  [ ! -d "$BATS_TEST_TMPDIR/\${CLAUDE_PLUGIN_DATA}" ]
  run bash -c "ls -d '$BATS_TEST_TMPDIR'/claude-cbm-* >/dev/null 2>&1 && echo found"
  assert_output 'found'
}

@test "an empty CBM_BUNDLE_CACHE falls back to TMPDIR" {
  run --separate-stderr env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" \
    CBM_BUNDLE_CACHE= bash "$FIXTURE/bin/cbm-launch.sh"
  assert_success
  assert_output 'CBM-STUB '
}

@test "a non-Linux host is a silent no-op" {
  make_stub uname 'printf "Darwin\n"'
  launch_run
  assert_success
  assert_output ''
  [ ! -d "$CACHE" ]
}

@test "a non-x86_64 host is a silent no-op" {
  make_stub uname 'if [ "${1:-}" = "-m" ]; then printf "aarch64\n"; else printf "Linux\n"; fi'
  launch_run
  assert_success
  assert_output ''
  [ ! -d "$CACHE" ]
}

@test "arguments are forwarded verbatim to the extracted binary" {
  launch_run -- cli search_graph --project p --json
  assert_success
  assert_output 'CBM-STUB cli search_graph --project p --json'
}

@test "extraction leaves no .tmp residue in the cache root" {
  launch_run
  assert_success
  run bash -c "find '$CACHE' -maxdepth 1 -name '.tmp.*' | grep -c . || true"
  assert_output '0'
}
