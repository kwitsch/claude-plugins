#!/usr/bin/env bats

# update-rtk-bundle.sh — hermetic exit-code contract. No network: `curl` is a stub that
# serves canned files from $BATS_TEST_TMPDIR through file:// base URLs.

load 'test_helper'

setup() {
  common_setup
  SCRIPT="$SKILL_DIR/update-rtk-bundle.sh"

  # Tools the script needs that common_setup's MOCKBIN list does not cover:
  # `gzip` (exec'd as a child by `tar -xzf`) and `dirname`.
  for extra in gzip dirname; do
    extra_src="$(command -v "$extra" 2> /dev/null)" && [ -n "$extra_src" ] && ln -sf "$extra_src" "$MOCKBIN/$extra"
  done

  # Fixture repo root: a minimal copy of the plugin's bundle layout.
  FIXTURE_ROOT="$BATS_TEST_TMPDIR/repo"
  FIXTURE_PLUGIN="$FIXTURE_ROOT/plugins/linux-token-efficiency"
  mkdir -p "$FIXTURE_PLUGIN/bin"
  printf 'OLD-BINARY\n' > "$FIXTURE_PLUGIN/bin/rtk"
  chmod +x "$FIXTURE_PLUGIN/bin/rtk"
  cat > "$FIXTURE_PLUGIN/rtk-bundle.json" <<'EOF'
{
  "rtkVersion": "0.45.0",
  "upstreamRepo": "rtk-ai/rtk",
  "releaseTag": "v0.45.0",
  "binaries": [
    {
      "asset": "rtk-x86_64-unknown-linux-musl.tar.gz",
      "assetSha256": "0000000000000000000000000000000000000000000000000000000000000000",
      "binarySha256": "0000000000000000000000000000000000000000000000000000000000000000"
    }
  ]
}
EOF

  # Fixture release tree: api/releases/latest + <tag>/<asset> + <tag>/checksums.txt.
  API_DIR="$BATS_TEST_TMPDIR/api"
  REL_DIR="$BATS_TEST_TMPDIR/rel"
  mkdir -p "$API_DIR/releases" "$REL_DIR/v0.46.0" "$BATS_TEST_TMPDIR/pack"
  printf '%s\n' '{"tag_name":"v0.46.0"}' > "$API_DIR/releases/latest"
  printf 'NEW-BINARY\n' > "$BATS_TEST_TMPDIR/pack/rtk"
  chmod +x "$BATS_TEST_TMPDIR/pack/rtk"
  tar -czf "$REL_DIR/v0.46.0/rtk-x86_64-unknown-linux-musl.tar.gz" -C "$BATS_TEST_TMPDIR/pack" rtk
  (cd "$REL_DIR/v0.46.0" && sha256sum rtk-x86_64-unknown-linux-musl.tar.gz > checksums.txt)

  # Stub curl: understands the combined dash flags, an optional -o <file>, and a
  # file:// URL; CURL_FAIL=1 makes every call fail like a real transport error.
  make_stub curl \
    'out=""; url=""' \
    'while [ "$#" -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac; done' \
    '[ -n "${CURL_FAIL:-}" ] && exit 22' \
    'src="${url#file://}"' \
    '[ -f "$src" ] || exit 22' \
    'if [ -n "$out" ]; then cp "$src" "$out"; else cat "$src"; fi'
}

# run_update <extra args...> -- env -i for maximum hermeticity (bump-version.bats idiom).
run_update() {
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" \
    RTK_RELEASE_BASE_URL="file://$API_DIR" RTK_DOWNLOAD_BASE_URL="file://$REL_DIR" \
    bash "$SCRIPT" --repo-root "$FIXTURE_ROOT" "$@"
}

@test "exit 2: no --repo-root, usage on stderr" {
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

@test "exit 2: missing pin file" {
  rm -f "$FIXTURE_PLUGIN/rtk-bundle.json"
  run_update --check
  assert_failure 2
}

@test "exit 5: non-Linux host" {
  make_stub uname 'if [ "${1:-}" = "-s" ]; then printf "Darwin\n"; else printf "Darwin\n"; fi'
  run_update --check
  assert_failure 5
  run cat "$FIXTURE_PLUGIN/bin/rtk"
  assert_output "OLD-BINARY"
}

@test "exit 0: pin already matches the fixture latest release" {
  printf '%s\n' '{"tag_name":"v0.45.0"}' > "$API_DIR/releases/latest"
  run_update --check
  assert_success
  assert_output --partial "up-to-date 0.45.0"
}

@test "exit 10: --check reports a newer release and writes nothing" {
  run_update --check
  assert_failure 10
  assert_output --partial "update-available 0.45.0 -> 0.46.0"
  run cat "$FIXTURE_PLUGIN/bin/rtk"
  assert_output "OLD-BINARY"
  run jq -r '.rtkVersion' "$FIXTURE_PLUGIN/rtk-bundle.json"
  assert_output "0.45.0"
}

@test "exit 3: the release API call fails" {
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" CURL_FAIL=1 \
    RTK_RELEASE_BASE_URL="file://$API_DIR" RTK_DOWNLOAD_BASE_URL="file://$REL_DIR" \
    bash "$SCRIPT" --repo-root "$FIXTURE_ROOT" --check
  assert_failure 3
  run cat "$FIXTURE_PLUGIN/bin/rtk"
  assert_output "OLD-BINARY"
}

@test "exit 4: tampered asset fails checksum verification and writes nothing" {
  printf 'TAMPERED\n' >> "$REL_DIR/v0.46.0/rtk-x86_64-unknown-linux-musl.tar.gz"
  run_update --apply
  assert_failure 4
  run cat "$FIXTURE_PLUGIN/bin/rtk"
  assert_output "OLD-BINARY"
  run jq -r '.rtkVersion' "$FIXTURE_PLUGIN/rtk-bundle.json"
  assert_output "0.45.0"
}

@test "exit 11: --apply recomputes the pin's shas + version and writes no bin/ file" {
  run_update --apply
  assert_failure 11
  assert_output --partial "updated 0.45.0 -> 0.46.0"
  # The sentinel binary is never touched — the script is pin-only now.
  run cat "$FIXTURE_PLUGIN/bin/rtk"
  assert_output "OLD-BINARY"
  run jq -e '.rtkVersion == "0.46.0" and .releaseTag == "v0.46.0" and (.binaries[0] | has("path") | not)' "$FIXTURE_PLUGIN/rtk-bundle.json"
  assert_success
  local expected_asset expected_bin
  expected_asset="$(cut -d' ' -f1 < "$REL_DIR/v0.46.0/checksums.txt")"
  expected_bin="$(tar -xzOf "$REL_DIR/v0.46.0/rtk-x86_64-unknown-linux-musl.tar.gz" rtk | sha256sum | cut -d' ' -f1)"
  run jq -r '.binaries[0].assetSha256' "$FIXTURE_PLUGIN/rtk-bundle.json"
  assert_output "$expected_asset"
  run jq -r '.binaries[0].binarySha256' "$FIXTURE_PLUGIN/rtk-bundle.json"
  assert_output "$expected_bin"
}

@test "--tag targets a specific release, recomputes the pin, touches no bin/ file" {
  rm -f "$API_DIR/releases/latest"
  run_update --tag v0.46.0 --apply
  assert_failure 11
  run cat "$FIXTURE_PLUGIN/bin/rtk"
  assert_output "OLD-BINARY"
  run jq -r '.rtkVersion' "$FIXTURE_PLUGIN/rtk-bundle.json"
  assert_output "0.46.0"
}

@test "--help prints usage and exits 0" {
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" bash "$SCRIPT" --help
  assert_success
  assert_output --partial "usage"
}

@test "the reference doc carries the canonical exit-code table" {
  local ref="$SKILL_DIR/update-rtk-bundle.reference.md"
  [ -f "$ref" ]
  for code in 0 2 3 4 5 10 11; do
    run grep -E "^\| $code +\|" "$ref"
    assert_success
  done
}
