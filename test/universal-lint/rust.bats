#!/usr/bin/env bats

# Rust (cargo clippy/check) detection, manifest targeting, chain preference,
# the no-Cargo.toml gate, and exit-code classification.

load 'test_helper'

setup() {
  common_setup
}

@test "rust: only cargo(check) on PATH -> invoked, targets --manifest-path, no positional" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/src"
  printf '[package]\nname = "x"\n' > "$cwd/Cargo.toml"
  printf 'fn main() {}\n' > "$cwd/src/main.rs"
  OUT="error[E0000]: some finding"
  rec_stub cargo 0
  run lint_file_call "$cwd/src/main.rs" "$cwd"
  assert_success
  run rg_or_grep -F "cargo check --manifest-path $cwd/Cargo.toml" "$RECORD"
  assert_success
  run rg_or_grep -F "main.rs" "$RECORD"   # no trailing file positional
  assert_failure
}

@test "rust: cargo-clippy on PATH gates selection, but the actual run is 'cargo clippy' (not the bare driver)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/src"
  printf '[package]\nname = "x"\n' > "$cwd/Cargo.toml"
  printf 'fn main() {}\n' > "$cwd/src/main.rs"
  OUT="warning: some clippy finding"
  # cargo-clippy only needs to be executable for onPath's probe -- rec_stub
  # here so an accidental direct invocation (the regression this test guards
  # against) would leave its own "cargo-clippy ..." line in $RECORD.
  rec_stub cargo-clippy 1
  rec_stub cargo 0
  run lint_file_call "$cwd/src/main.rs" "$cwd"
  assert_success
  run rg_or_grep -F "cargo clippy --manifest-path $cwd/Cargo.toml -- -D warnings" "$RECORD"
  assert_success
  # the bare cargo-clippy driver was never actually spawned -- only probed
  run rg_or_grep -E "^cargo-clippy " "$RECORD"
  assert_failure
}

@test "rust: .rs with no Cargo.toml anywhere -> {} and the stub is never invoked (manifest gate)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/src"
  printf 'fn main() {}\n' > "$cwd/src/main.rs"
  OUT="error: should never appear"
  rec_stub cargo 101
  run lint_file_call "$cwd/src/main.rs" "$cwd"
  assert_success
  assert_output "{}"
  run rg_or_grep -F "cargo" "$RECORD"
  assert_failure
}

@test "rust: nothing on PATH -> {} (no npx attempt)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/src"
  printf '[package]\nname = "x"\n' > "$cwd/Cargo.toml"
  printf 'fn main() {}\n' > "$cwd/src/main.rs"
  run lint_file_call "$cwd/src/main.rs" "$cwd"
  assert_success
  assert_output "{}"
}

@test "rust: cargo check exit 0 (clean) -> {}" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/src"
  printf '[package]\nname = "x"\n' > "$cwd/Cargo.toml"
  printf 'fn main() {}\n' > "$cwd/src/main.rs"
  OUT=""
  rec_stub cargo 0
  run lint_file_call "$cwd/src/main.rs" "$cwd"
  assert_success
  assert_output "{}"
}

@test "rust: cargo check exit 101 -> additionalContext finding whose target is the crate dir" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/src"
  printf '[package]\nname = "x"\n' > "$cwd/Cargo.toml"
  printf 'fn main() { let x = ; }\n' > "$cwd/src/main.rs"
  OUT="error: expected expression"
  rec_stub cargo 101
  run lint_file_call "$cwd/src/main.rs" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("expected expression")'
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("found issues in \\.:")'
}
