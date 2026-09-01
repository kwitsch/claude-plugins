#!/usr/bin/env bats

# mcp/server.mjs — the cbm proxy MCP server, driven over real stdio in a fixture plugin
# tree. The child is a few-byte fake cbm binary; the "release" is a few-byte tarball served
# by an ephemeral 127.0.0.1 HTTP server. No network, and the real 279.6 MiB binary is never
# downloaded or extracted.

load 'test_helper'

setup() {
  common_setup
  make_cbm_server_fixture "$BATS_TEST_TMPDIR/plugin"
}

teardown() {
  stop_release_server
}

@test "initialize reports the codebase-memory server name and tools capability" {
  warm_cbm_cache
  cbm_rpc 1 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}'
  run jq -e '.serverInfo.name == "codebase-memory" and .capabilities.tools != null and .protocolVersion == "2025-11-25"' <<< "$(cbm_rpc_result 1)"
  assert_success
}

@test "tools/list advertises the four hook tools plus every snapshot tool" {
  warm_cbm_cache
  cbm_rpc 2 \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
  local names
  names="$(cbm_rpc_result 2 | jq -c '[.tools[].name]')"
  for tool in hook_session_context hook_subagent_context hook_symbol_context hook_coverage_context list_projects search_graph; do
    run jq -e --arg t "$tool" 'any(.[]; . == $t)' <<< "$names"
    assert_success
  done
  run jq -e 'length == 6' <<< "$names"
  assert_success
  run jq -e '.tools | all((.name | type == "string") and (.description | type == "string") and (.inputSchema.type == "object"))' <<< "$(cbm_rpc_result 2)"
  assert_success
}

@test "a passthrough tools/call reaches the child and its result is returned unchanged" {
  warm_cbm_cache
  cbm_call query_graph '{"project":"app","query":"MATCH (n) RETURN n"}'
  run jq -e '.structuredContent.echo == "query_graph" and .isError == false and (.content[0].text | test("query_graph"))' <<< "$(cbm_rpc_result 2)"
  assert_success
  run grep -c '"name":"query_graph"' "$FAKE_LOG"
  assert_output '1'
}

@test "a passthrough call whose child is unreachable answers isError instead of silence" {
  # No warm cache and an unreachable download base: ensureBinary can never succeed.
  cbm_call query_graph '{}'
  run jq -e '.isError == true and (.content[0].text | test("codebase-memory unavailable"))' <<< "$(cbm_rpc_result 2)"
  assert_success
}

@test "an unknown method with an id gets -32601 and never touches stdout otherwise" {
  warm_cbm_cache
  cbm_rpc 2 \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
    '{"jsonrpc":"2.0","id":2,"method":"resources/list","params":{}}'
  run jq -e 'select(.id == 2) | .error.code == -32601' <<< "$CBM_RPC_STDOUT"
  assert_success
  # Every stdout line must be a JSON-RPC frame. Checked in THIS shell, one line at a time:
  # CBM_RPC_STDOUT is not exported, so a `bash -c` subshell would see it empty and the
  # assertion would pass vacuously.
  local line
  while read -r line; do
    run jq -e 'has("jsonrpc")' <<< "$line"
    assert_success
  done <<< "$CBM_RPC_STDOUT"
}

@test "a non-JSON line is ignored with a stderr note, ping is answered" {
  warm_cbm_cache
  cbm_rpc 2 \
    'this is not json' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
    '{"jsonrpc":"2.0","id":2,"method":"ping","params":{}}'
  run jq -e '. == {}' <<< "$(cbm_rpc_result 2)"
  assert_success
  assert_regex "$CBM_RPC_STDERR" 'non-JSON line ignored'
}

@test "a warm cache is reused without re-downloading the asset" {
  warm_cbm_cache
  start_release_server
  cbm_call list_projects '{}'
  run jq -e '.structuredContent.echo == "list_projects"' <<< "$(cbm_rpc_result 2)"
  assert_success
  # checksums.txt may be fetched to derive the key, but the asset tarball must not be.
  run bash -c "grep -F '/releases/latest/download/$FIXTURE_ASSET' '$RELEASE_LOG' | grep -c . || true"
  assert_output '0'
}

@test "a cold cache downloads, verifies and extracts into the content-addressed cache" {
  start_release_server
  cbm_rpc 2 \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
  run jq -e '(.tools | length) == 6' <<< "$(cbm_rpc_result 2)"
  assert_success
  # The download is fired without awaiting, so poll for the cached binary.
  local target="$CBM_CACHE/${ASSET_SHA:0:16}/codebase-memory-mcp"
  for _ in $(seq 1 50); do
    [ -x "$target" ] && break
    sleep 0.1
  done
  [ -x "$target" ]
  run bash -c "sha256sum < '$target' | cut -d' ' -f1"
  assert_output "$FAKE_BIN_SHA"
  run grep -F "/releases/latest/download/checksums.txt" "$RELEASE_LOG"
  assert_success
  run grep -F "/releases/latest/download/$FIXTURE_ASSET" "$RELEASE_LOG"
  assert_success
  run bash -c "find '$CBM_CACHE' -maxdepth 1 -name '.tmp.*' | grep -c . || true"
  assert_output '0'
}

@test "a checksums entry that mismatches the asset leaves the cache untouched" {
  start_release_server
  write_cbm_checksums "0000000000000000000000000000000000000000000000000000000000000000  $FIXTURE_ASSET"
  cbm_call list_projects '{}'
  assert_regex "$CBM_RPC_STDERR" 'sha256 mismatch'
  run bash -c "find '$CBM_CACHE' -type f | grep -c . || true"
  assert_output '0'
}

@test "checksums unreachable but a cached binary exists: newest is reused" {
  warm_cbm_cache # places a valid binary under $CBM_CACHE/${ASSET_SHA:0:16}
  # No start_release_server: CBM_DOWNLOAD_BASE_URL points at an unreachable port.
  cbm_call list_projects '{}'
  run jq -e '.structuredContent.echo == "list_projects"' <<< "$(cbm_rpc_result 2)"
  assert_success
  assert_regex "$CBM_RPC_STDERR" 'latest unresolved'
}

@test "a corrupt archive and an archive with zero or two binaries all fail closed" {
  start_release_server
  local asset="$RELEASE_DIR/$FIXTURE_ASSET"

  printf 'not a tarball\n' > "$asset"
  refresh_asset_sha
  cbm_call list_projects '{}'
  run bash -c "find '$CBM_CACHE' -type f | grep -c . || true"
  assert_output '0'

  rm -f "$asset"
  tar -czf "$asset" -C "$BATS_TEST_TMPDIR/pack" install.sh
  refresh_asset_sha
  cbm_call list_projects '{}'
  assert_regex "$CBM_RPC_STDERR" 'found 0'
  run bash -c "find '$CBM_CACHE' -type f | grep -c . || true"
  assert_output '0'

  mkdir -p "$BATS_TEST_TMPDIR/pack/nested"
  cp "$FAKE_BIN" "$BATS_TEST_TMPDIR/pack/nested/codebase-memory-mcp"
  rm -f "$asset"
  tar -czf "$asset" -C "$BATS_TEST_TMPDIR/pack" codebase-memory-mcp nested/codebase-memory-mcp
  refresh_asset_sha
  cbm_call list_projects '{}'
  assert_regex "$CBM_RPC_STDERR" 'found 2'
  run bash -c "find '$CBM_CACHE' -type f | grep -c . || true"
  assert_output '0'
  run bash -c "find '$CBM_CACHE' -maxdepth 1 -name '.tmp.*' | grep -c . || true"
  assert_output '0'
}

@test "cbm_enabled=false exits 0 without answering or touching the cache" {
  warm_cbm_cache
  CBM_RPC_ENV=(CLAUDE_PLUGIN_OPTION_CBM_ENABLED=false)
  cbm_rpc 1 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
  assert_equal "$CBM_RPC_STDOUT" ''
  assert_regex "$CBM_RPC_STDERR" 'disabled by the cbm_enabled plugin option'
  run bash -c "find '$CBM_CACHE/project-cache' -type f 2>/dev/null | grep -c . || true"
  assert_output '0'
}

@test "an unreadable or malformed cbm-tools.json degrades to the four hook tools only" {
  warm_cbm_cache
  printf 'not json at all\n' > "$BATS_TEST_TMPDIR/plugin/cbm-tools.json"
  cbm_rpc 2 \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
  run jq -e '[.tools[].name] | length == 4 and all(startswith("hook_"))' <<< "$(cbm_rpc_result 2)"
  assert_success
  assert_regex "$CBM_RPC_STDERR" 'cbm-tools.json'
  cbm_call query_graph '{}'
  run jq -e '.structuredContent.echo == "query_graph"' <<< "$(cbm_rpc_result 2)"
  assert_success
}

@test "the Linux x86_64 guard's precondition holds on this host" {
  # The guard reads os.platform()/os.arch(), NOT the uname binary, so a uname stub cannot
  # simulate a foreign host: assert the guard's own precondition instead — on a Linux x64
  # host the server speaks, elsewhere the case is skipped.
  [ "$(uname -s)" = "Linux" ] || skip "not a Linux host"
  [ "$(uname -m)" = "x86_64" ] || skip "not an x86_64 host"
  warm_cbm_cache
  cbm_rpc 1 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
  run jq -e '.serverInfo.name == "codebase-memory"' <<< "$(cbm_rpc_result 1)"
  assert_success
}
