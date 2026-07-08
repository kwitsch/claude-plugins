#!/usr/bin/env bats

# Tests for the universal-lint plugin (mcp-kind PostToolUse Write|Edit check-only linter).

setup() {
  bats_require_minimum_version 1.5.0
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/universal-lint"
  MCP_JSON="$PLUGIN/.mcp.json"
  HOOKS="$PLUGIN/hooks/hooks.json"
  SERVER="$PLUGIN/mcp/server.mjs"

  # Isolated PATH: only system tools symlinked in; linter stubs added per test.
  MOCKBIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$MOCKBIN"
  for t in bash node; do
    src="$(command -v "$t" 2>/dev/null)" && [ -n "$src" ] && ln -s "$src" "$MOCKBIN/$t"
  done

  # Isolated HOME so no test reads real user config.
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME/.claude"
}

# --- scaffold invariants ---------------------------------------------------

@test "plugin.json is valid JSON with name/version/userConfig.auto_lint" {
  run jq -e '.name == "universal-lint" and (.version | type == "string") and (.userConfig.auto_lint.type == "boolean") and (.userConfig.auto_lint.default == true)' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}

@test "plugin is registered in marketplace.json without a version field" {
  run jq -e '[.plugins[] | select(.name == "universal-lint" and .source == "./plugins/universal-lint")] | length == 1' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
  run jq -e '[.plugins[] | select(.name == "universal-lint") | has("version")] | any | not' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
}

@test "plugin has a root README table row" {
  run grep -F "[universal-lint](plugins/universal-lint/README.md)" "$REPO_ROOT/README.md"
  assert_success
}

@test "plugin is in the test.yml matrix" {
  run grep -E "^\s*-\s*universal-lint\s*$" "$REPO_ROOT/.github/workflows/test.yml"
  assert_success
}

@test ".mcp.json is valid JSON and registers universal-lint-hooks -> mcp/server.mjs" {
  run jq -e '.mcpServers["universal-lint-hooks"].command | endswith("mcp/server.mjs")' "$MCP_JSON"
  assert_success
}

@test "hooks.json is valid JSON" {
  run jq empty "$HOOKS"
  assert_success
}

@test "PostToolUse hook is wired to the namespaced lint_file mcp_tool with timeout 60" {
  run jq -e '.hooks.PostToolUse[0] | .matcher == "Write|Edit" and (.hooks[0].type == "mcp_tool") and (.hooks[0].server == "plugin:universal-lint:universal-lint-hooks") and (.hooks[0].tool == "lint_file") and (.hooks[0].timeout == 60)' "$HOOKS"
  assert_success
}

@test "every mcp_tool hook references a configured server (namespaced key)" {
  run bash -c '
    set -e
    for s in $(jq -r "[.hooks[][].hooks[] | select(.type==\"mcp_tool\") | .server] | unique[]" "'"$HOOKS"'"); do
      key="${s##*:}"   # strip plugin:<plugin>: namespace prefix -> bare .mcp.json key
      jq -e --arg k "$key" ".mcpServers[\$k]" "'"$MCP_JSON"'" >/dev/null \
        || { echo "server not configured: $s (key $key)" >&2; exit 1; }
    done
  '
  assert_success
}

@test "every mcp_tool hook names a non-empty tool" {
  run jq -e '[.hooks[][].hooks[] | select(.type=="mcp_tool")] | all(.tool | type=="string" and length>0)' "$HOOKS"
  assert_success
}

@test "server.mjs is executable (repo rule)" {
  [ -x "$SERVER" ]
}

@test "server.mjs has a node shebang" {
  run head -n1 "$SERVER"
  assert_output '#!/usr/bin/env node'
}

@test "server.mjs passes node --check" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  run node --check "$SERVER"
  assert_success
}

@test "server lists lint_file over stdio" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  run bash -c '
    printf "%s\n%s\n" \
      "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}" \
      "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}" \
      | node "'"$SERVER"'"
  '
  assert_success
  assert_output --partial '"lint_file"'
}

@test "plugin README first ## heading is Install" {
  run bash -c "grep -m1 '^## ' '$PLUGIN/README.md'"
  assert_success
  assert_output "## Install"
}

@test "plugin README contains the install command" {
  run grep -F "/plugin install universal-lint@kwitsch-plugins" "$PLUGIN/README.md"
  assert_success
}

@test "plugin README has no ## Hooks section" {
  run grep -E "^## Hooks" "$PLUGIN/README.md"
  assert_failure
}

# --- behavioral: lint_file core ----------------------------------------------

# make_stub <name> <body-line>... -- drop an executable bash stub into MOCKBIN.
make_stub() {
  local name="$1"; shift
  { printf '#!/usr/bin/env bash\n'; printf '%s\n' "$@"; } > "$MOCKBIN/$name"
  chmod +x "$MOCKBIN/$name"
}

# A recording stub: appends "<name> <argv>" to $RECORD, prints $OUT (env-supplied
# at call time by lint_file_call, read at stub-RUN-time, not baked in at
# definition time) to stdout, never touches the target file (a linter never
# modifies anything).
rec_stub() {
  local name="$1" exit_code="$2"
  make_stub "$name" \
    'printf "%s %s\n" "'"$name"'" "$*" >> "$RECORD"' \
    'printf '\''%s\n'\'' "$OUT"' \
    'exit '"$exit_code"
}

# lint_file_call <file_path> <cwd> -- one initialize + one tools/call over stdio on a
# fresh server process, on the isolated PATH. Echoes the tools/call structuredContent.
lint_file_call() {
  local fp="$1" cwd="$2"
  {
    printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n'
    printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"lint_file","arguments":%s}}\n' \
      "$(jq -cn --arg f "$fp" --arg c "$cwd" '{hook_event_name:"PostToolUse", tool_name:"Write", tool_input:{file_path:$f}, tool_response:{success:true}, cwd:$c}')"
  } | env PATH="$MOCKBIN" HOME="$HOME" RECORD="$RECORD" OUT="$OUT" node "$SERVER" 2>/dev/null \
    | jq -c 'select(.id == 2) | .result.structuredContent'
}

@test "shellcheck finds an issue: additionalContext returned with the stub's text" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo $1\n' > "$cwd/a.sh"
  OUT='a.sh:1:6: note: Double quote to prevent globbing. [SC2086]'
  rec_stub shellcheck 1
  run lint_file_call "$cwd/a.sh" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "PostToolUse" and (.hookSpecificOutput.additionalContext | test("SC2086"))'
  run grep -F "shellcheck " "$RECORD"
  assert_success
  run cat "$cwd/a.sh"
  assert_output "echo \$1"   # linter never modifies the file
}

@test "shellcheck clean (exit 0) -> {} even though it printed text" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo "$1"\n' > "$cwd/a.sh"
  OUT='no problems'
  rec_stub shellcheck 0
  run lint_file_call "$cwd/a.sh" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "no linter on PATH -> {}" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo $1\n' > "$cwd/a.sh"
  run lint_file_call "$cwd/a.sh" "$cwd"       # no shellcheck stub created
  assert_success
  [ "$output" = "{}" ]
}

@test "non-target extension (.md) -> linter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '# hi\n' > "$cwd/a.md"
  OUT="issue"
  rec_stub shellcheck 1
  run lint_file_call "$cwd/a.md" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "path outside cwd -> linter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  local out="$BATS_TEST_TMPDIR/outside"; mkdir -p "$out"
  printf 'echo $1\n' > "$out/a.sh"
  OUT="issue"
  rec_stub shellcheck 1
  run lint_file_call "$out/a.sh" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "node_modules path -> linter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/node_modules/x"
  printf 'echo $1\n' > "$cwd/node_modules/x/a.sh"
  OUT="issue"
  rec_stub shellcheck 1
  run lint_file_call "$cwd/node_modules/x/a.sh" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "auto_lint=false in user settings -> linter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo $1\n' > "$cwd/a.sh"
  OUT="issue"
  rec_stub shellcheck 1
  printf '{"pluginConfigs":{"universal-lint@kwitsch-plugins":{"options":{"auto_lint":false}}}}\n' > "$HOME/.claude/settings.json"
  run lint_file_call "$cwd/a.sh" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "eslint exit 2 (config/internal error) -> {} even though it printed text (skip, not issues)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x = 1\n' > "$cwd/a.js"
  OUT='Oops! Something went wrong! :('
  rec_stub eslint 2
  run lint_file_call "$cwd/a.js" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "eslint exit 1 -> issues surfaced" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x = 1\n' > "$cwd/a.js"
  OUT='a.js: 1:1  error  x is assigned a value but never used  no-unused-vars'
  rec_stub eslint 1
  run lint_file_call "$cwd/a.js" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("no-unused-vars")'
}

@test "ruff check: subcommand precedes the file in recorded argv" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'x=1\n' > "$cwd/a.py"
  OUT="a.py:1:1: E225 missing whitespace around operator"
  rec_stub ruff 1
  run lint_file_call "$cwd/a.py" "$cwd"
  assert_success
  run grep -F "ruff check" "$RECORD"
  assert_success
}

@test "ktlint clean (exit 0) -> {}; issues (exit 1) -> surfaced" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'fun main(){}\n' > "$cwd/a.kt"
  RECORD="$BATS_TEST_TMPDIR/rec1"; : > "$RECORD"
  OUT=""
  rec_stub ktlint 0
  run lint_file_call "$cwd/a.kt" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  RECORD="$BATS_TEST_TMPDIR/rec2"; : > "$RECORD"
  OUT="a.kt:1:1: Missing newline before \")\" (standard:parameter-list-wrapping)"
  rec_stub ktlint 1
  run lint_file_call "$cwd/a.kt" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("parameter-list-wrapping")'
}

# --- behavioral: Go directory-scoping + fallback chain -----------------------

@test "go fallback: only go(vet) stub present -> used, targets the directory" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/pkg"
  printf 'package pkg\n' > "$cwd/pkg/a.go"
  OUT="pkg/a.go:1: some vet finding"
  rec_stub go 1
  run lint_file_call "$cwd/pkg/a.go" "$cwd"
  assert_success
  run grep -F "go vet $cwd/pkg" "$RECORD"   # directory, not the file
  assert_success
}

@test "go fallback: golangci-lint present -> wins over go vet, targets the directory" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/pkg"
  printf 'package pkg\n' > "$cwd/pkg/a.go"
  OUT="pkg/a.go:1: some finding"
  rec_stub golangci-lint 1
  rec_stub go 1   # never runs (golangci-lint wins) -- shares $OUT harmlessly
  run lint_file_call "$cwd/pkg/a.go" "$cwd"
  assert_success
  run grep -F "golangci-lint run $cwd/pkg" "$RECORD"
  assert_success
  run grep -F "go vet" "$RECORD"
  assert_failure
}

# --- behavioral: checkstyle (output-classified, not exit-code) ---------------

@test "checkstyle: boilerplate-only exit 0 -> {}" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'class A {}\n' > "$cwd/A.java"
  OUT=$'Starting audit...\nAudit done.'
  rec_stub checkstyle 0
  run lint_file_call "$cwd/A.java" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "checkstyle: boilerplate + warning-severity violation, exit 0 -> issues surfaced (proves NOT exit-code based)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'class A {}\n' > "$cwd/A.java"
  OUT=$'Starting audit...\n[WARN] A.java:1: Missing a Javadoc comment. [JavadocType]\nAudit done.'
  rec_stub checkstyle 0
  run lint_file_call "$cwd/A.java" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("JavadocType")'
}

@test "checkstyle: no 'Audit done.' (crash) -> {}" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'class A {}\n' > "$cwd/A.java"
  OUT='Exception in thread "main" java.lang.RuntimeException: bad config'
  rec_stub checkstyle 1
  run lint_file_call "$cwd/A.java" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "checkstyle: project checkstyle.xml present -> -c <path to it> in recorded argv" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'class A {}\n' > "$cwd/A.java"
  printf '<module name="Checker"/>\n' > "$cwd/checkstyle.xml"
  OUT=$'Starting audit...\nAudit done.'
  rec_stub checkstyle 0
  run lint_file_call "$cwd/A.java" "$cwd"
  assert_success
  run grep -F -- "-c $cwd/checkstyle.xml" "$RECORD"
  assert_success
}

@test "checkstyle: no project config -> -c /google_checks.xml in recorded argv" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'class A {}\n' > "$cwd/A.java"
  OUT=$'Starting audit...\nAudit done.'
  rec_stub checkstyle 0
  run lint_file_call "$cwd/A.java" "$cwd"
  assert_success
  run grep -F -- "-c /google_checks.xml" "$RECORD"
  assert_success
}

# --- behavioral: truncation ---------------------------------------------------

@test "output over MAX_CONTEXT_CHARS is capped and marked truncated" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo $1\n' > "$cwd/a.sh"
  OUT="$(printf 'x%.0s' $(seq 1 5000))"
  rec_stub shellcheck 1
  run lint_file_call "$cwd/a.sh" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("… \\(truncated\\)$")'
}

# --- behavioral: npx fallback (eslint) ---------------------------------------

@test "eslint absent but npx present -> npx --yes eslint fallback runs, issues surfaced" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x = 1\n' > "$cwd/a.js"
  OUT='a.js: 1:1  error  x is assigned a value but never used  no-unused-vars'
  rec_stub npx 1
  run lint_file_call "$cwd/a.js" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("no-unused-vars")'
  run grep -F "npx --yes eslint $cwd/a.js" "$RECORD"
  assert_success
}

@test "eslint present on PATH -> npx never invoked even if present" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x = 1\n' > "$cwd/a.js"
  OUT="clean"
  rec_stub eslint 0
  rec_stub npx 0   # present but must not be used
  run lint_file_call "$cwd/a.js" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  run grep -E "^eslint " "$RECORD"
  assert_success
  run grep -F "npx" "$RECORD"
  assert_failure
}

# --- behavioral: rtk detection ------------------------------------------------

# rtk_stub <verb> <exit_code> -- stub $MOCKBIN/rtk that answers BOTH shapes:
#   rtk rewrite <tool> <args...> __RTK_PROBE__   -> echoes "rtk <verb> __RTK_PROBE__"
#   rtk <verb> <args...>                         -> records argv, prints $OUT, exits <exit_code>
rtk_stub() {
  local verb="$1" exit_code="$2"
  make_stub rtk \
    'if [ "$1" = "rewrite" ]; then printf "rtk %s __RTK_PROBE__\n" "'"$verb"'"; exit 3; fi' \
    'printf "%s %s\n" "rtk" "$*" >> "$RECORD"' \
    'printf '\''%s\n'\'' "$OUT"' \
    'exit '"$exit_code"
}

@test "rtk: shellcheck on PATH + rtk supports it -> lint runs via rtk, issues surfaced" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo $1\n' > "$cwd/a.sh"
  OUT='a.sh:1:6: note: Double quote to prevent globbing. [SC2086]'
  rec_stub shellcheck 1
  rtk_stub shellcheck 1
  run lint_file_call "$cwd/a.sh" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("SC2086")'
  run grep -F "rtk shellcheck $cwd/a.sh" "$RECORD"
  assert_success
  run grep -E "^shellcheck " "$RECORD"
  assert_failure
}

@test "rtk: checkstyle unsupported by rtk -> falls through to direct invocation" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'class A {}\n' > "$cwd/A.java"
  OUT=$'Starting audit...\nAudit done.'
  rec_stub checkstyle 0
  make_stub rtk \
    'if [ "$1" = "rewrite" ]; then exit 1; fi' \
    'echo "rtk should not run the actual tool" >&2' \
    'exit 1'
  run lint_file_call "$cwd/A.java" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  run grep -E "^checkstyle " "$RECORD"
  assert_success
}

@test "rtk: rtk supports the tool but the run itself is killed -> falls back to direct invocation" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo $1\n' > "$cwd/a.sh"
  OUT='a.sh:1:6: note: Double quote to prevent globbing. [SC2086]'
  rec_stub shellcheck 1
  make_stub rtk \
    'if [ "$1" = "rewrite" ]; then printf "rtk shellcheck __RTK_PROBE__\n"; exit 3; fi' \
    'kill -KILL $$'
  run lint_file_call "$cwd/a.sh" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("SC2086")'
  run grep -E "^shellcheck " "$RECORD"
  assert_success
}
