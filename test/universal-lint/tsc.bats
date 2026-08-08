#!/usr/bin/env bats

# tsc type-check + combined eslint+tsc tests.

load 'test_helper'

setup() {
  common_setup
}

@test "tsc: nearest tsconfig.json found upward, invoked with -p <path>, issues surfaced with project-root target" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/src"
  printf '{"compilerOptions":{"noEmit":true},"include":["src/**/*.ts"]}' > "$cwd/tsconfig.json"
  printf 'const x: number = 1;\n' > "$cwd/src/a.ts"
  OUT='src/a.ts(1,1): error TS2322: tsc-finding-marker'
  rec_stub tsc 2
  run lint_file_call "$cwd/src/a.ts" "$cwd"
  assert_success
  local out="$output"
  echo "$out" | jq -e '.hookSpecificOutput.additionalContext | test("tsc-finding-marker")'
  run rg_or_grep -F -- "-p $cwd/tsconfig.json" "$RECORD"
  assert_success
  echo "$out" | jq -e '.hookSpecificOutput.additionalContext | test("found issues in \\.:")'
}

@test "tsc: no tsconfig.json anywhere -> {}, tsc stub never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'const x: number = 1;\n' > "$cwd/a.ts"
  OUT="issue"
  rec_stub tsc 2
  run lint_file_call "$cwd/a.ts" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "tsc: solution-style tsconfig.json (references only) -> {}, tsc stub never invoked (confirmed blind spot)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '{"files":[],"references":[{"path":"./pkg"}]}' > "$cwd/tsconfig.json"
  printf 'const x: number = 1;\n' > "$cwd/a.ts"
  OUT="issue"
  rec_stub tsc 2
  run lint_file_call "$cwd/a.ts" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "tsc clean (exit 0) -> {}" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '{"compilerOptions":{"noEmit":true},"include":["*.ts"]}' > "$cwd/tsconfig.json"
  printf 'const x: number = 1;\n' > "$cwd/a.ts"
  OUT=""
  rec_stub tsc 0
  run lint_file_call "$cwd/a.ts" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "tsc exit 1 (TypeScript 7 native compiler's real-diagnostic exit code, source location present) -> surfaced as issues" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '{"compilerOptions":{"noEmit":true},"include":["*.ts"]}' > "$cwd/tsconfig.json"
  printf 'const x: number = 1;\n' > "$cwd/a.ts"
  OUT='a.ts(1,1): error TS2322: tsc-finding-marker'
  rec_stub tsc 1
  run lint_file_call "$cwd/a.ts" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("tsc-finding-marker")'
}

@test "tsc exit 1 (pure project/config-loading failure, no source-file location) -> {} (skip, not a real finding)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '{"compilerOptions":{"noEmit":true},"include":["*.ts"]}' > "$cwd/tsconfig.json"
  printf 'const x: number = 1;\n' > "$cwd/a.ts"
  OUT="error TS5083: Cannot read file '/proj/missing-base.json'."
  rec_stub tsc 1
  run lint_file_call "$cwd/a.ts" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "tsc exit 1 (config-loading failure AND a real diagnostic together) -> the real finding still surfaces" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '{"compilerOptions":{"noEmit":true},"include":["*.ts"]}' > "$cwd/tsconfig.json"
  printf 'const x: number = 1;\n' > "$cwd/a.ts"
  OUT="error TS5083: Cannot read file '/proj/missing-base.json'.
a.ts(1,1): error TS2322: tsc-finding-marker"
  rec_stub tsc 1
  run lint_file_call "$cwd/a.ts" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("tsc-finding-marker")'
}

@test "tsc exit 64 (unrecognized/crash) -> {} (skip bucket)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '{"compilerOptions":{"noEmit":true},"include":["*.ts"]}' > "$cwd/tsconfig.json"
  printf 'const x: number = 1;\n' > "$cwd/a.ts"
  OUT='unexpected crash'
  rec_stub tsc 64
  run lint_file_call "$cwd/a.ts" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "tsc: .js file next to a real tsconfig.json never triggers tsc (extension-gated, not lang-gated)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '{"compilerOptions":{"noEmit":true,"allowJs":true},"include":["*.js"]}' > "$cwd/tsconfig.json"
  printf 'let x = 1;\n' > "$cwd/a.js"
  rec_stub tsc 2
  rec_stub eslint 0
  OUT=""
  run lint_file_call "$cwd/a.js" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  run rg_or_grep -E "^tsc " "$RECORD"
  assert_failure
}

@test "tsc: absent from PATH but present at node_modules/.bin/tsc -> that absolute path is invoked directly, no rtk attempt" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/node_modules/.bin"
  printf '{"compilerOptions":{"noEmit":true},"include":["*.ts"]}' > "$cwd/tsconfig.json"
  printf 'const x: number = 1;\n' > "$cwd/a.ts"
  cat > "$cwd/node_modules/.bin/tsc" <<'INNER'
#!/usr/bin/env bash
printf "%s %s\n" "localtsc" "$*" >> "$RECORD"
echo "a.ts(1,1): error TS2322: local-tsc-marker"
exit 2
INNER
  chmod +x "$cwd/node_modules/.bin/tsc"
  make_stub rtk \
    'printf "%s %s\n" "rtk" "$*" >> "$RECORD"' \
    'exit 1'
  run lint_file_call "$cwd/a.ts" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("local-tsc-marker")'
  run rg_or_grep -F "localtsc " "$RECORD"
  assert_success
  run rg_or_grep -F "rtk" "$RECORD"
  assert_failure
}

@test "tsc: absent from PATH and no node_modules/.bin/tsc -> {}, no candidate" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '{"compilerOptions":{"noEmit":true},"include":["*.ts"]}' > "$cwd/tsconfig.json"
  printf 'const x: number = 1;\n' > "$cwd/a.ts"
  run lint_file_call "$cwd/a.ts" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "combined: eslint (jsts chain) and tsc both report issues on the same .ts edit -> one additionalContext with both" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '{"compilerOptions":{"noEmit":true},"include":["*.ts"]}' > "$cwd/tsconfig.json"
  printf 'let x: number = 1\n' > "$cwd/a.ts"
  make_stub eslint 'echo "eslint-finding-marker"' 'exit 1'
  make_stub tsc 'echo "tsc-finding-marker"' 'exit 2'
  run lint_file_call "$cwd/a.ts" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("eslint-finding-marker")'
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("tsc-finding-marker")'
}

@test "combined: outer truncate re-caps the WHOLE joined message even when both per-finding blocks are individually under MAX_CONTEXT_CHARS" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '{"compilerOptions":{"noEmit":true},"include":["*.ts"]}' > "$cwd/tsconfig.json"
  printf 'let x: number = 1\n' > "$cwd/a.ts"
  local big; big="$(printf 'x%.0s' $(seq 1 3000))"
  make_stub eslint "echo \"$big\"" 'exit 1'
  make_stub tsc "echo \"$big\"" 'exit 2'
  run lint_file_call "$cwd/a.ts" "$cwd"
  assert_success
  # each block (~3000 chars) is individually under the 4000-char per-finding cap,
  # but joined (~6000+) must still be re-capped by the outer truncate() pass
  local len
  len="$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext | length')"
  [ "$len" -lt 4200 ]
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("… \\(truncated\\)$")'
}
