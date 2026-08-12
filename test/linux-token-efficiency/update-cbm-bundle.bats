#!/usr/bin/env bats

# update-cbm-bundle.sh — hermetic exit-code contract. No network: `curl` is a stub
# serving canned files from $BATS_TEST_TMPDIR through file:// base URLs. The fixture
# tarball is a few bytes; the real 279.6 MiB binary is never downloaded or extracted.

load 'test_helper'

setup() {
  common_setup
  SCRIPT="$SKILL_DIR/update-cbm-bundle.sh"
  ASSET="codebase-memory-mcp-linux-amd64-portable.tar.gz"

  FIXTURE_ROOT="$BATS_TEST_TMPDIR/repo"
  FIXTURE_PLUGIN="$FIXTURE_ROOT/plugins/linux-token-efficiency"
  mkdir -p "$FIXTURE_PLUGIN/bin"
  printf 'RTK-SENTINEL\n' > "$FIXTURE_PLUGIN/bin/rtk"
  cat > "$FIXTURE_PLUGIN/cbm-bundle.json" << EOF
{
  "cbmVersion": "0.10.1",
  "upstreamRepo": "DeusData/codebase-memory-mcp",
  "releaseTag": "v0.10.1",
  "binaries": [
    {
      "asset": "$ASSET",
      "assetSha256": "0000000000000000000000000000000000000000000000000000000000000000",
      "binarySha256": "0000000000000000000000000000000000000000000000000000000000000000"
    }
  ]
}
EOF
  printf '%s\n' '{"cbmVersion":"0.10.1","tools":[{"name":"stale_tool","description":"stale","inputSchema":{"type":"object"}}]}' \
    > "$FIXTURE_PLUGIN/cbm-tools.json"

  API_DIR="$BATS_TEST_TMPDIR/api"
  REL_DIR="$BATS_TEST_TMPDIR/rel"
  mkdir -p "$API_DIR/releases" "$REL_DIR/v0.11.0" "$BATS_TEST_TMPDIR/pack"
  printf '%s\n' '{"tag_name":"v0.11.0"}' > "$API_DIR/releases/latest"
  # The archive's binary is the fake MCP-speaking cbm: the script probes its tools/list.
  write_fake_cbm "$BATS_TEST_TMPDIR/pack/codebase-memory-mcp"
  printf 'installer\n' > "$BATS_TEST_TMPDIR/pack/install.sh"
  tar -czf "$REL_DIR/v0.11.0/$ASSET" -C "$BATS_TEST_TMPDIR/pack" codebase-memory-mcp install.sh
  (cd "$REL_DIR/v0.11.0" && sha256sum "$ASSET" > checksums.txt)

  FAKE_PAYLOADS="$BATS_TEST_TMPDIR/fake-payloads.json"
  printf '%s\n' '{"list_projects":{},"search_graph":{}}' > "$FAKE_PAYLOADS"

  make_stub curl \
    'out=""; url=""' \
    'while [ "$#" -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac; done' \
    '[ -n "${CURL_FAIL:-}" ] && exit 22' \
    'src="${url#file://}"' \
    '[ -f "$src" ] || exit 22' \
    'if [ -n "$out" ]; then cp "$src" "$out"; else cat "$src"; fi'
}

run_update() {
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" \
    CBM_RELEASE_BASE_URL="file://$API_DIR" CBM_DOWNLOAD_BASE_URL="file://$REL_DIR" \
    CBM_FAKE_PAYLOADS="$FAKE_PAYLOADS" \
    bash "$SCRIPT" --repo-root "$FIXTURE_ROOT" "$@"
}

# assert_bin_untouched -- the script must never write into the plugin's bin/ again.
assert_bin_untouched() {
  run bash -c "ls -A '$FIXTURE_PLUGIN/bin'"
  assert_output 'rtk'
  run cat "$FIXTURE_PLUGIN/bin/rtk"
  assert_output 'RTK-SENTINEL'
}

@test "--help prints usage and exits 0" {
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" bash "$SCRIPT" --help
  assert_success
  assert_output --partial "usage"
}

@test "exit 2: no --repo-root" {
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" bash "$SCRIPT" --check
  assert_failure 2
  assert_output --partial "usage"
}

@test "exit 2: unknown argument" {
  run_update --bogus
  assert_failure 2
}

@test "exit 2: missing jq on PATH" {
  rm -f "$MOCKBIN/jq"
  run_update --check
  assert_failure 2
  assert_output --partial "jq"
}

@test "exit 2: missing or malformed pin" {
  rm -f "$FIXTURE_PLUGIN/cbm-bundle.json"
  run_update --check
  assert_failure 2
  printf 'not json\n' > "$FIXTURE_PLUGIN/cbm-bundle.json"
  run_update --check
  assert_failure 2
}

@test "exit 5: non-Linux host writes nothing" {
  make_stub uname 'printf "Darwin\n"'
  run_update --check
  assert_failure 5
  assert_bin_untouched
}

@test "exit 3: the release API call fails" {
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" CURL_FAIL=1 \
    CBM_RELEASE_BASE_URL="file://$API_DIR" CBM_DOWNLOAD_BASE_URL="file://$REL_DIR" \
    bash "$SCRIPT" --repo-root "$FIXTURE_ROOT" --check
  assert_failure 3
  assert_bin_untouched
}

@test "exit 0: pin already matches the fixture latest release" {
  printf '%s\n' '{"tag_name":"v0.10.1"}' > "$API_DIR/releases/latest"
  run_update --check
  assert_success
  assert_output --partial "up-to-date 0.10.1"
}

@test "exit 10: --check reports a newer release and writes nothing" {
  run_update --check
  assert_failure 10
  assert_output --partial "update-available 0.10.1 -> 0.11.0"
  assert_bin_untouched
  run jq -r '.cbmVersion' "$FIXTURE_PLUGIN/cbm-bundle.json"
  assert_output "0.10.1"
}

@test "exit 4: a tampered asset fails verification and writes nothing" {
  printf 'TAMPERED\n' >> "$REL_DIR/v0.11.0/$ASSET"
  run_update --apply
  assert_failure 4
  assert_bin_untouched
  run jq -r '.cbmVersion' "$FIXTURE_PLUGIN/cbm-bundle.json"
  assert_output "0.10.1"
}

@test "exit 4: an archive without the binary fails verification" {
  rm -f "$REL_DIR/v0.11.0/$ASSET"
  tar -czf "$REL_DIR/v0.11.0/$ASSET" -C "$BATS_TEST_TMPDIR/pack" install.sh
  (cd "$REL_DIR/v0.11.0" && sha256sum "$ASSET" > checksums.txt)
  run_update --apply
  assert_failure 4
  assert_bin_untouched
}

@test "exit 11: --apply rewrites the pin and the tool snapshot, never bin/" {
  run_update --apply
  assert_failure 11
  assert_output --partial "updated 0.10.1 -> 0.11.0"
  refute_output --partial "bin/"
  assert_bin_untouched
  run jq -e '.cbmVersion == "0.11.0" and .releaseTag == "v0.11.0" and (.binaries | length) == 1 and (.binaries[0] | has("path") | not)' "$FIXTURE_PLUGIN/cbm-bundle.json"
  assert_success
  local expected_asset expected_bin
  expected_asset="$(cut -d' ' -f1 < "$REL_DIR/v0.11.0/checksums.txt")"
  expected_bin="$(sha256sum < "$BATS_TEST_TMPDIR/pack/codebase-memory-mcp" | cut -d' ' -f1)"
  run jq -r '.binaries[0].assetSha256' "$FIXTURE_PLUGIN/cbm-bundle.json"
  assert_output "$expected_asset"
  run jq -r '.binaries[0].binarySha256' "$FIXTURE_PLUGIN/cbm-bundle.json"
  assert_output "$expected_bin"
}

@test "exit 11: --apply regenerates cbm-tools.json from the binary's own tools/list" {
  run_update --apply
  assert_failure 11
  run jq -e '.cbmVersion == "0.11.0"' "$FIXTURE_PLUGIN/cbm-tools.json"
  assert_success
  run jq -e '[.tools[].name] | sort == ["list_projects","search_graph"]' "$FIXTURE_PLUGIN/cbm-tools.json"
  assert_success
  run jq -e '.tools | all((.name | length > 0) and (.description | length > 0) and (.inputSchema.type == "object"))' "$FIXTURE_PLUGIN/cbm-tools.json"
  assert_success
  run jq -e --slurpfile pin "$FIXTURE_PLUGIN/cbm-bundle.json" '.cbmVersion == $pin[0].cbmVersion' "$FIXTURE_PLUGIN/cbm-tools.json"
  assert_success
}

@test "exit 4: an empty tool list fails closed with no partial write" {
  printf '%s\n' '{}' > "$FAKE_PAYLOADS"
  run_update --apply
  assert_failure 4
  run jq -r '.cbmVersion' "$FIXTURE_PLUGIN/cbm-bundle.json"
  assert_output "0.10.1"
  run jq -e '[.tools[].name] == ["stale_tool"]' "$FIXTURE_PLUGIN/cbm-tools.json"
  assert_success
  assert_bin_untouched
}

@test "--apply leaves no temp residue and creates no extraction cache" {
  run_update --apply
  assert_failure 11
  run bash -c "find '$FIXTURE_PLUGIN' -name '.tmp*' -o -name '*.new' -o -name '*-next.*' | grep -c . || true"
  assert_output '0'
  run bash -c "find '$FIXTURE_ROOT' -type d -name 'cbm' | grep -c . || true"
  assert_output '0'
}

@test "--tag targets a specific release without querying the API" {
  rm -f "$API_DIR/releases/latest"
  run_update --tag v0.11.0 --apply
  assert_failure 11
  run jq -r '.cbmVersion' "$FIXTURE_PLUGIN/cbm-bundle.json"
  assert_output "0.11.0"
}

@test "the reference doc carries the canonical exit-code table" {
  local ref="$SKILL_DIR/update-cbm-bundle.reference.md"
  [ -f "$ref" ]
  for code in 0 2 3 4 5 10 11; do
    run grep -E "^\| $code +\|" "$ref"
    assert_success
  done
}
