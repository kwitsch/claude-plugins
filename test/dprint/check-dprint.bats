#!/usr/bin/env bats

load 'test_helper'

setup() {
  common_setup
  SCRIPT="$SKILL_DIR/scripts/check-dprint.mjs"
}

# make_stub <name> <body-line>... -- drop an executable bash stub into MOCKBIN.
# Stub bodies must not reference $BATS_TEST_TMPDIR (not exported to stubs).
make_stub() {
  local name="$1"
  shift
  {
    printf '#!/usr/bin/env bash\n'
    printf '%s\n' "$@"
  } > "$MOCKBIN/$name"
  chmod +x "$MOCKBIN/$name"
}

# run_check [args...] -- run the real script on the isolated PATH/HOME.
run_check() {
  run env PATH="$MOCKBIN" HOME="$HOME" "$MOCKBIN/node" "$SCRIPT" "$@"
}

# min_version -- the floor read from the script's single MIN_VERSION constant.
min_version() {
  sed -n 's/^const MIN_VERSION = "\([0-9.]*\)";$/\1/p' "$SCRIPT"
}

@test "no dprint on PATH nor in ~/.dprint/bin -> exit 10, status=missing" {
  run_check
  assert_failure 10
  assert_output "status=missing version=- min=$(min_version) path=-"
}

@test "non-executable dprint file on PATH is ignored -> exit 10" {
  printf 'not executable\n' > "$MOCKBIN/dprint"
  chmod -x "$MOCKBIN/dprint"
  run_check
  assert_failure 10
  assert_output --partial "status=missing"
}

@test "dprint 0.6.0 is outdated (numeric compare, lexically > 0.50) -> exit 11" {
  make_stub dprint 'echo "dprint 0.6.0"'
  run_check
  assert_failure 11
  assert_output "status=outdated version=0.6.0 min=$(min_version) path=$MOCKBIN/dprint"
}

@test "dprint 0.100.0 is ok (numeric compare, lexically < 0.50.0) -> exit 0" {
  make_stub dprint 'echo "dprint 0.100.0"'
  run_check
  assert_success
  assert_output "status=ok version=0.100.0 min=$(min_version) path=$MOCKBIN/dprint"
}

@test "dprint exactly MIN_VERSION is ok -> exit 0" {
  local min
  min="$(min_version)"
  [ -n "$min" ]
  make_stub dprint "echo \"dprint $min\""
  run_check
  assert_success
  assert_output "status=ok version=$min min=$min path=$MOCKBIN/dprint"
}

@test "dprint 0.29.0 is outdated -> exit 11" {
  make_stub dprint 'echo "dprint 0.29.0"'
  run_check
  assert_failure 11
  assert_output --partial "status=outdated version=0.29.0"
}

@test "garbage --version output -> exit 2, status=error" {
  make_stub dprint 'echo "hello world"'
  run_check
  assert_failure 2
  assert_output --partial "status=error version=- min=$(min_version) path=$MOCKBIN/dprint"
}

@test "empty --version output -> exit 2, status=error" {
  make_stub dprint 'exit 0'
  run_check
  assert_failure 2
  assert_output --partial "status=error"
}

@test "--version exits non-zero -> exit 2, status=error" {
  make_stub dprint 'echo "dprint 0.60.0"' 'exit 1'
  run_check
  assert_failure 2
  assert_output --partial "status=error"
}

@test "fallback ~/.dprint/bin/dprint used when not on PATH -> exit 0 with that path" {
  mkdir -p "$HOME/.dprint/bin"
  printf '#!/usr/bin/env bash\necho "dprint 9.9.9"\n' > "$HOME/.dprint/bin/dprint"
  chmod +x "$HOME/.dprint/bin/dprint"
  run_check
  assert_success
  assert_output "status=ok version=9.9.9 min=$(min_version) path=$HOME/.dprint/bin/dprint"
}

@test "PATH dprint wins over ~/.dprint/bin/dprint" {
  make_stub dprint 'echo "dprint 0.10.0"'
  mkdir -p "$HOME/.dprint/bin"
  printf '#!/usr/bin/env bash\necho "dprint 9.9.9"\n' > "$HOME/.dprint/bin/dprint"
  chmod +x "$HOME/.dprint/bin/dprint"
  run_check
  assert_failure 11
  assert_output --partial "path=$MOCKBIN/dprint"
}

@test "any argument is a usage error -> exit 2" {
  make_stub dprint 'echo "dprint 9.9.9"'
  run_check --help
  assert_failure 2
  assert_output --partial "status=error"
}

@test "MIN_VERSION is defined exactly once in the script" {
  run grep -c 'MIN_VERSION = ' "$SCRIPT"
  assert_success
  assert_output "1"
}

@test "DPRINT_INSTALL replaces ~/.dprint in the fallback location" {
  make_stub dprint 'echo "dprint 0.100.0"'
  mkdir -p "$BATS_TEST_TMPDIR/inst/bin"
  mv "$MOCKBIN/dprint" "$BATS_TEST_TMPDIR/inst/bin/dprint"
  run env PATH="$MOCKBIN" HOME="$HOME" DPRINT_INSTALL="$BATS_TEST_TMPDIR/inst" "$MOCKBIN/node" "$SCRIPT"
  assert_success
  assert_output "status=ok version=0.100.0 min=$(min_version) path=$BATS_TEST_TMPDIR/inst/bin/dprint"
}
