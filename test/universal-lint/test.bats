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
  WRAPPER="$PLUGIN/bin/mjs-launch.sh"

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

# Prefer ripgrep; fall back to grep if rg isn't installed. rg's -E means
# --encoding=ARG and -r means --replace=ARG (both take a value, neither is
# grep's meaning), and rg has no recursive flag (recursion is its
# default) — so a bundled/bare -E is stripped before delegating to rg
# (its regex syntax is already ERE-equivalent for every pattern used in
# this file); grep gets its original arguments completely untouched.
# Note: bare `rg -c` prints nothing on 0 matches where `grep -c` prints `0`
# (both exit 1) -- no call site here checks that text (only $status or a
# nonzero count), so this divergence is accepted rather than papered over
# with --include-zero, which errors on ripgrep < 12.0.0.
rg_or_grep() {
  if command -v rg >/dev/null 2>&1; then
    local args=() a stripped seen_dashdash=false
    for a in "$@"; do
      if [ "$seen_dashdash" = true ]; then
        args+=("$a")
        continue
      fi
      case "$a" in
        --) seen_dashdash=true; args+=("$a") ;;
        -[A-Za-z]*)
          stripped="${a//E/}"
          [ "$stripped" = "-" ] && continue
          args+=("$stripped")
          ;;
        *) args+=("$a") ;;
      esac
    done
    command rg "${args[@]}"
  else
    command grep "$@"
  fi
}
export -f rg_or_grep

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
  run rg_or_grep -F "[universal-lint](plugins/universal-lint/README.md)" "$REPO_ROOT/README.md"
  assert_success
}

@test "plugin is in the test.yml matrix" {
  run rg_or_grep -E "^\s*-\s*universal-lint\s*$" "$REPO_ROOT/.github/workflows/test.yml"
  assert_success
}

@test ".mcp.json is valid JSON and registers universal-lint-hooks -> bin/mjs-launch.sh mcp/server.mjs" {
  run jq -e '.mcpServers["universal-lint-hooks"].command | endswith("bin/mjs-launch.sh")' "$MCP_JSON"
  assert_success
  run jq -e '.mcpServers["universal-lint-hooks"].args == ["${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs"]' "$MCP_JSON"
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

# --- bin/mjs-launch.sh (runtime launcher: PATH fix + bun/node selection) ----

@test "bin/mjs-launch.sh is executable (repo rule)" {
  [ -x "$WRAPPER" ]
}

@test "bin/mjs-launch.sh has a bash shebang and passes bash -n" {
  run head -n1 "$WRAPPER"
  assert_output '#!/usr/bin/env bash'
  run bash -n "$WRAPPER"
  assert_success
}

@test "bin/mjs-launch.sh errors on missing argument (exit 64)" {
  run "$WRAPPER"
  assert_failure 64
  assert_output --partial "missing argument"
}

@test "bin/mjs-launch.sh errors when neither bun nor node is on PATH" {
  local fakebin="$BATS_TEST_TMPDIR/fakebin-none"
  mkdir -p "$fakebin"
  for t in bash env; do
    src="$(command -v "$t" 2>/dev/null)" && ln -s "$src" "$fakebin/$t"
  done
  run env -i PATH="$fakebin" HOME="$HOME" "$WRAPPER" /some/script.mjs
  assert_failure 1
  assert_output --partial "neither bun nor node is available"
}

@test "bin/mjs-launch.sh falls back to node when bun is absent" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local fakebin="$BATS_TEST_TMPDIR/fakebin-node"
  mkdir -p "$fakebin"
  for t in bash env node; do
    src="$(command -v "$t" 2>/dev/null)" && ln -s "$src" "$fakebin/$t"
  done
  run env -i PATH="$fakebin" HOME="$HOME" "$WRAPPER" --version
  assert_success
}

@test "bin/mjs-launch.sh prefers bun over node when both are on PATH" {
  command -v bun >/dev/null 2>&1 || skip "bun not installed"
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local fakebin="$BATS_TEST_TMPDIR/fakebin-both"
  mkdir -p "$fakebin"
  for t in bash env node bun; do
    src="$(command -v "$t" 2>/dev/null)" && ln -s "$src" "$fakebin/$t"
  done
  local probe="$BATS_TEST_TMPDIR/which-runtime.mjs"
  printf 'console.log(typeof Bun !== "undefined" ? "bun" : "node")\n' > "$probe"
  run env -i PATH="$fakebin" HOME="$HOME" "$WRAPPER" "$probe"
  assert_success
  assert_output "bun"
}

@test "bin/mjs-launch.sh appends ~/.local/bin after the inherited PATH, so a system-PATH tool wins over a same-named one there" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local fakebin="$BATS_TEST_TMPDIR/fakebin-syspath"
  mkdir -p "$fakebin" "$HOME/.local/bin"
  for t in bash env node; do
    src="$(command -v "$t" 2>/dev/null)" && ln -s "$src" "$fakebin/$t"
  done
  printf '#!/usr/bin/env bash\necho system-path-tool\n' > "$fakebin/dupe-tool"
  chmod +x "$fakebin/dupe-tool"
  printf '#!/usr/bin/env bash\necho stale-local-bin-tool\n' > "$HOME/.local/bin/dupe-tool"
  chmod +x "$HOME/.local/bin/dupe-tool"
  local probe="$BATS_TEST_TMPDIR/which-tool.mjs"
  printf 'import { execSync } from "node:child_process";\nconsole.log(execSync("command -v dupe-tool").toString().trim());\n' > "$probe"
  run env -i PATH="$fakebin" HOME="$HOME" "$WRAPPER" "$probe"
  assert_success
  assert_output "$fakebin/dupe-tool"
}

@test "bin/mjs-launch.sh launches server.mjs correctly (lint_file listed over stdio)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  run bash -c '
    printf "%s\n%s\n" \
      "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}" \
      "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}" \
      | "'"$WRAPPER"'" "'"$SERVER"'"
  '
  assert_success
  assert_output --partial '"lint_file"'
}

@test "plugin README first ## heading is Install" {
  run bash -c "rg_or_grep -m1 '^## ' '$PLUGIN/README.md'"
  assert_success
  assert_output "## Install"
}

@test "plugin README contains the install command" {
  run rg_or_grep -F "/plugin install universal-lint@kwitsch-plugins" "$PLUGIN/README.md"
  assert_success
}

@test "plugin README has no ## Hooks section" {
  run rg_or_grep -E "^## Hooks" "$PLUGIN/README.md"
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
  run rg_or_grep -F "shellcheck " "$RECORD"
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

@test "non-target extension (.txt) -> linter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'hi\n' > "$cwd/a.txt"
  OUT="issue"
  rec_stub shellcheck 1
  run lint_file_call "$cwd/a.txt" "$cwd"
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
  run rg_or_grep -F "ruff check" "$RECORD"
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
  run rg_or_grep -F "go vet $cwd/pkg" "$RECORD"   # directory, not the file
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
  run rg_or_grep -F "golangci-lint run $cwd/pkg" "$RECORD"
  assert_success
  run rg_or_grep -F "go vet" "$RECORD"
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
  run rg_or_grep -F -- "-c $cwd/checkstyle.xml" "$RECORD"
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
  run rg_or_grep -F -- "-c /google_checks.xml" "$RECORD"
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
  run rg_or_grep -F "npx --yes eslint $cwd/a.js" "$RECORD"
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
  run rg_or_grep -E "^eslint " "$RECORD"
  assert_success
  run rg_or_grep -F "npx" "$RECORD"
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
  run rg_or_grep -F "rtk shellcheck $cwd/a.sh" "$RECORD"
  assert_success
  run rg_or_grep -E "^shellcheck " "$RECORD"
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
  run rg_or_grep -E "^checkstyle " "$RECORD"
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
  run rg_or_grep -E "^shellcheck " "$RECORD"
  assert_success
}

@test "rtk: a clean non-zero exit with empty stdout (rtk-internal failure) falls back to direct invocation, not misreported as a finding" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo $1\n' > "$cwd/a.sh"
  OUT='a.sh:1:6: note: Double quote to prevent globbing. [SC2086]'
  rec_stub shellcheck 1
  make_stub rtk \
    'if [ "$1" = "rewrite" ]; then printf "rtk shellcheck __RTK_PROBE__\n"; exit 3; fi' \
    'echo "rtk: internal error, could not reach backend" >&2' \
    'exit 2'
  run lint_file_call "$cwd/a.sh" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("SC2086")'
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("internal error") | not'
  run rg_or_grep -E "^shellcheck " "$RECORD"
  assert_success
}

@test "rtk: npx-fallback tool routes through rtk when rtk is on PATH" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x = 1\n' > "$cwd/a.js"
  OUT='a.js: 1:1  error  x is assigned a value but never used  no-unused-vars'
  make_stub rtk \
    'printf "%s %s\n" "rtk" "$*" >> "$RECORD"' \
    'printf '\''%s\n'\'' "$OUT"' \
    'exit 1'
  # npx must be present on PATH (isToolAvailable/selectLintTool require it for
  # eslint's npmSpec candidacy) but must never actually run once rtk succeeds.
  make_stub npx \
    'printf "%s %s\n" "npx" "$*" >> "$RECORD"' \
    'echo "npx should not run when rtk succeeds" >&2' \
    'exit 1'
  run lint_file_call "$cwd/a.js" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("no-unused-vars")'
  run rg_or_grep -F "rtk npx --yes eslint $cwd/a.js" "$RECORD"
  assert_success
  run rg_or_grep -E "^npx " "$RECORD"
  assert_failure
}

@test "rtk: npx-fallback falls back to bare npx when the rtk call errors" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x = 1\n' > "$cwd/a.js"
  OUT='a.js: 1:1  error  x is assigned a value but never used  no-unused-vars'
  make_stub rtk 'kill -KILL $$'
  rec_stub npx 1
  run lint_file_call "$cwd/a.js" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("no-unused-vars")'
  run rg_or_grep -F "npx --yes eslint $cwd/a.js" "$RECORD"
  assert_success
}

@test "json extension -> linter never invoked (deliberately uncovered)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '{"a":1}' > "$cwd/a.json"
  OUT="issue"
  rec_stub eslint 1
  run lint_file_call "$cwd/a.json" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "yamllint finds an issue: additionalContext returned" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'a:   1\n' > "$cwd/a.yaml"
  OUT='a.yaml:1:4: [warning] too many spaces after colon (colons)'
  rec_stub yamllint 1
  run lint_file_call "$cwd/a.yaml" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("colons")'
  run rg_or_grep -F "yamllint " "$RECORD"
  assert_success
}

@test "yamllint clean (exit 0) -> {}" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'a: 1\n' > "$cwd/a.yaml"
  OUT=""
  rec_stub yamllint 0
  run lint_file_call "$cwd/a.yaml" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "markdown fallback: only markdownlint present -> used" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '# hi\n' > "$cwd/a.md"
  OUT='a.md:1 MD041/first-line-heading'
  rec_stub markdownlint 1
  run lint_file_call "$cwd/a.md" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("MD041")'
  run rg_or_grep -F "markdownlint " "$RECORD"
  assert_success
}

@test "markdown fallback: markdownlint-cli2 present -> wins over markdownlint (chain order)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '# hi\n' > "$cwd/a.md"
  OUT='a.md:1 MD041/first-line-heading'
  rec_stub markdownlint-cli2 1
  rec_stub markdownlint 1   # never runs -- cli2 wins
  run lint_file_call "$cwd/a.md" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("MD041")'
  run rg_or_grep -F "markdownlint-cli2 " "$RECORD"
  assert_success
  run rg_or_grep -E "^markdownlint " "$RECORD"
  assert_failure
}

@test "markdown: markdownlint on PATH, markdownlint-cli2 absent, npx present -> markdownlint wins (PATH beats npx-only)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '# hi\n' > "$cwd/a.md"
  OUT='a.md:1 MD041/first-line-heading'
  rec_stub markdownlint 1
  rec_stub npx 1   # present but must not be used -- markdownlint is genuinely installed
  run lint_file_call "$cwd/a.md" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("MD041")'
  run rg_or_grep -E "^markdownlint " "$RECORD"
  assert_success
  run rg_or_grep -F "npx" "$RECORD"
  assert_failure
}

@test "markdownlint-cli2 absent but npx present -> npx --yes markdownlint-cli2 fallback runs" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '# hi\n' > "$cwd/a.md"
  OUT='a.md:1 MD041/first-line-heading'
  rec_stub npx 1
  run lint_file_call "$cwd/a.md" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("MD041")'
  run rg_or_grep -F "npx --yes markdownlint-cli2 $cwd/a.md" "$RECORD"
  assert_success
}
