#!/usr/bin/env bats

# hooks/rtk-install.mjs — SessionStart rtk installer. Hermetic: a few-byte fake rtk in a
# fabricated tar.gz is served by an ephemeral 127.0.0.1 HTTP server (the installer uses
# global fetch, which does not support file://). HOME is a sandbox, never the real ~/.local/bin.

load 'test_helper'

setup() {
  common_setup
  # tar forks gzip on -xzf.
  for extra in gzip dirname; do
    extra_src="$(command -v "$extra" 2> /dev/null)" && [ -n "$extra_src" ] && ln -sf "$extra_src" "$MOCKBIN/$extra"
  done

  INSTALLER="$PLUGIN/hooks/rtk-install.mjs"
  FAKE_PLUGIN="$BATS_TEST_TMPDIR/plugin"
  mkdir -p "$FAKE_PLUGIN/hooks"
  cp "$INSTALLER" "$FAKE_PLUGIN/hooks/rtk-install.mjs"
  chmod +x "$FAKE_PLUGIN/hooks/rtk-install.mjs"
  FAKE_INSTALLER="$FAKE_PLUGIN/hooks/rtk-install.mjs"

  FIXTURE_TAG="v9.9.9-fixture"
  FIXTURE_ASSET="rtk-x86_64-unknown-linux-musl.tar.gz"
  RELEASE_DIR="$BATS_TEST_TMPDIR/release"
  mkdir -p "$RELEASE_DIR/$FIXTURE_TAG" "$BATS_TEST_TMPDIR/pack"
  printf '#!/usr/bin/env bash\necho fake-rtk 9.9.9\n' > "$BATS_TEST_TMPDIR/pack/rtk"
  chmod +x "$BATS_TEST_TMPDIR/pack/rtk"
  tar -czf "$RELEASE_DIR/$FIXTURE_TAG/$FIXTURE_ASSET" -C "$BATS_TEST_TMPDIR/pack" rtk
  FAKE_BIN_SHA="$(sha256sum < "$BATS_TEST_TMPDIR/pack/rtk" | cut -d' ' -f1)"
  ASSET_SHA="$(sha256sum < "$RELEASE_DIR/$FIXTURE_TAG/$FIXTURE_ASSET" | cut -d' ' -f1)"

  write_pin "$ASSET_SHA" "$FAKE_BIN_SHA"
  TARGET="$HOME/.local/bin/rtk"
}

teardown() {
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2> /dev/null
  SERVER_PID=""
  return 0
}

# write_pin <assetSha> <binarySha> -- fabricate FAKE_PLUGIN/rtk-bundle.json (no path field).
write_pin() {
  jq -n --arg tag "$FIXTURE_TAG" --arg asset "$FIXTURE_ASSET" --arg a "$1" --arg b "$2" \
    '{rtkVersion:($tag|ltrimstr("v")), upstreamRepo:"rtk-ai/rtk", releaseTag:$tag,
      binaries:[{asset:$asset, assetSha256:$a, binarySha256:$b}]}' > "$FAKE_PLUGIN/rtk-bundle.json"
}

# start_server -- ephemeral 127.0.0.1 server over RELEASE_DIR; sets RTK_BASE and RELEASE_LOG.
start_server() {
  local script="$BATS_TEST_TMPDIR/rel-server.mjs" portfile="$BATS_TEST_TMPDIR/rel-port" i
  RELEASE_LOG="$BATS_TEST_TMPDIR/rel-requests.log"
  : > "$RELEASE_LOG"
  rm -f "$portfile"
  cat > "$script" << 'SRV'
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const root = fs.realpathSync(process.env.RELEASE_ROOT);
const server = http.createServer((req, res) => {
  fs.appendFileSync(process.env.RELEASE_LOG, `${req.url}\n`);
  const rel = decodeURIComponent(String(req.url).replace(/^\/releases\/download\//, "").replace(/^\/+/, ""));
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; res.end("no"); return; }
  res.statusCode = 200;
  fs.createReadStream(file).pipe(res);
});
server.listen(0, "127.0.0.1", () => fs.writeFileSync(process.env.RELEASE_PORT_FILE, String(server.address().port)));
SRV
  RELEASE_ROOT="$RELEASE_DIR" RELEASE_LOG="$RELEASE_LOG" RELEASE_PORT_FILE="$portfile" node "$script" &
  SERVER_PID=$!
  for ((i = 0; i < 50; i++)); do [ -s "$portfile" ] && break; sleep 0.1; done
  [ -s "$portfile" ] || return 1
  RTK_BASE="http://127.0.0.1:$(cat "$portfile")/releases/download"
  return 0
}

# run_install [VAR=VALUE ...] -- run the fixture installer on an isolated PATH.
run_install() {
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" \
    RTK_DOWNLOAD_BASE_URL="${RTK_BASE:-http://127.0.0.1:1/releases/download}" "$@" \
    node "$FAKE_INSTALLER"
}

linux_x64_or_skip() {
  [ "$(uname -s)" = "Linux" ] || skip "not a Linux host"
  [ "$(uname -m)" = "x86_64" ] || skip "not an x86_64 host"
}

@test "hooks/rtk-install.mjs is executable in the git index (100755)" {
  run git -C "$REPO_ROOT" ls-files --stage -- plugins/linux-token-efficiency/hooks/rtk-install.mjs
  assert_success
  assert_line --regexp '^100755 [0-9a-f]+ 0[[:space:]]+plugins/linux-token-efficiency/hooks/rtk-install\.mjs$'
}

@test "absent target: downloads, verifies and installs a mode-0755 rtk matching the fixture" {
  linux_x64_or_skip
  start_server
  run_install
  assert_success
  [ -x "$TARGET" ]
  run bash -c "sha256sum < '$TARGET' | cut -d' ' -f1"
  assert_output "$FAKE_BIN_SHA"
  run stat -c '%a' "$TARGET"
  assert_output '755'
}

@test "present target: an existing rtk is never overwritten and nothing is downloaded" {
  mkdir -p "$HOME/.local/bin"
  printf 'SENTINEL\n' > "$TARGET"
  chmod +x "$TARGET"
  start_server
  run_install
  assert_success
  run cat "$TARGET"
  assert_output 'SENTINEL'
  run bash -c "grep -c . '$RELEASE_LOG' || true"
  assert_output '0'
}

@test "asset sha256 mismatch: nothing installed, exit 0" {
  linux_x64_or_skip
  write_pin '0000000000000000000000000000000000000000000000000000000000000000' "$FAKE_BIN_SHA"
  start_server
  run_install
  assert_success
  [ ! -e "$TARGET" ]
}

@test "binary sha256 mismatch: nothing installed, exit 0" {
  linux_x64_or_skip
  write_pin "$ASSET_SHA" '1111111111111111111111111111111111111111111111111111111111111111'
  start_server
  run_install
  assert_success
  [ ! -e "$TARGET" ]
}

@test "rtk_enabled=false: no install, no network" {
  start_server
  run_install CLAUDE_PLUGIN_OPTION_RTK_ENABLED=false
  assert_success
  [ ! -e "$TARGET" ]
  run bash -c "grep -c . '$RELEASE_LOG' || true"
  assert_output '0'
}

@test "hooks.json wires the installer as an async SessionStart command hook" {
  run jq -e '.hooks.SessionStart[2].hooks[0] | .type == "command" and .command == "${CLAUDE_PLUGIN_ROOT}/hooks/rtk-install.mjs" and .async == true and .timeout == 20' "$HOOKS"
  assert_success
}
