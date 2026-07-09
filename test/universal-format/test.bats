#!/usr/bin/env bats

# Tests for the universal-format plugin (mcp-kind PostToolUse Write|Edit auto-formatter).

setup() {
  bats_require_minimum_version 1.5.0
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/universal-format"
  MCP_JSON="$PLUGIN/.mcp.json"
  HOOKS="$PLUGIN/hooks/hooks.json"
  SERVER="$PLUGIN/mcp/server.mjs"

  # Isolated PATH: only system tools symlinked in; formatter stubs added per test.
  MOCKBIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$MOCKBIN"
  for t in bash env node jq cat rm mkdir mktemp dirname head grep; do
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

@test "plugin.json is valid JSON with name/version/userConfig.auto_format" {
  run jq -e '.name == "universal-format" and (.version | type == "string") and (.userConfig.auto_format.type == "boolean") and (.userConfig.auto_format.default == true)' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}

@test "plugin is registered in marketplace.json without a version field" {
  run jq -e '[.plugins[] | select(.name == "universal-format" and .source == "./plugins/universal-format")] | length == 1' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
  run jq -e '[.plugins[] | select(.name == "universal-format") | has("version")] | any | not' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
}

@test "plugin has a root README table row" {
  run rg_or_grep -F "[universal-format](plugins/universal-format/README.md)" "$REPO_ROOT/README.md"
  assert_success
}

@test "plugin is in the test.yml matrix" {
  run rg_or_grep -E "^\s*-\s*universal-format\s*$" "$REPO_ROOT/.github/workflows/test.yml"
  assert_success
}

@test ".mcp.json is valid JSON and registers universal-format-hooks -> mcp/server.mjs" {
  run jq -e '.mcpServers["universal-format-hooks"].command | endswith("mcp/server.mjs")' "$MCP_JSON"
  assert_success
}

@test "hooks.json is valid JSON" {
  run jq empty "$HOOKS"
  assert_success
}

@test "PostToolUse hook is wired to the namespaced format_file mcp_tool with timeout 60" {
  run jq -e '.hooks.PostToolUse[0] | .matcher == "Write|Edit" and (.hooks[0].type == "mcp_tool") and (.hooks[0].server == "plugin:universal-format:universal-format-hooks") and (.hooks[0].tool == "format_file") and (.hooks[0].timeout == 60)' "$HOOKS"
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

@test "server lists format_file over stdio" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  run bash -c '
    printf "%s\n%s\n" \
      "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}" \
      "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}" \
      | node "'"$SERVER"'"
  '
  assert_success
  assert_output --partial '"format_file"'
}

@test "plugin README first ## heading is Install" {
  run bash -c "rg_or_grep -m1 '^## ' '$PLUGIN/README.md'"
  assert_success
  assert_output "## Install"
}

@test "plugin README contains the install command" {
  run rg_or_grep -F "/plugin install universal-format@kwitsch-plugins" "$PLUGIN/README.md"
  assert_success
}

@test "plugin README has no ## Hooks section" {
  run rg_or_grep -E "^## Hooks" "$PLUGIN/README.md"
  assert_failure
}

# --- behavioral: format_file core --------------------------------------------

# make_stub <name> <body-line>... — drop an executable bash stub into MOCKBIN.
make_stub() {
  local name="$1"; shift
  { printf '#!/usr/bin/env bash\n'; printf '%s\n' "$@"; } > "$MOCKBIN/$name"
  chmod +x "$MOCKBIN/$name"
}

# A recording+rewriting stub: appends "<name> <argv>" to $RECORD and overwrites the
# target file (always the last arg) so the server's content-diff sees a change.
rec_stub() {
  make_stub "$1" \
    'printf "%s %s\n" "'"$1"'" "$*" >> "$RECORD"' \
    'for last; do :; done' \
    'printf "reformatted-by-'"$1"'\n" > "$last"'
}

# format_file_call <file_path> <cwd> — one initialize + one tools/call over stdio on a
# fresh server process, on the isolated PATH. Echoes the tools/call structuredContent.
format_file_call() {
  local fp="$1" cwd="$2"
  {
    printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n'
    printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"format_file","arguments":%s}}\n' \
      "$(jq -cn --arg f "$fp" --arg c "$cwd" '{hook_event_name:"PostToolUse", tool_name:"Write", tool_input:{file_path:$f}, tool_response:{success:true}, cwd:$c}')"
  } | env PATH="$MOCKBIN" HOME="$HOME" RECORD="$RECORD" node "$SERVER" 2>/dev/null \
    | jq -c 'select(.id == 2) | .result.structuredContent'
}

@test "formats a shell file: shfmt runs, file changes, additionalContext returned" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo  hi\n' > "$cwd/a.sh"
  rec_stub shfmt
  run format_file_call "$cwd/a.sh" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "PostToolUse" and (.hookSpecificOutput.additionalContext | test("shfmt reformatted a.sh"))'
  run rg_or_grep -F "shfmt " "$RECORD"
  assert_success
  run cat "$cwd/a.sh"
  assert_output --partial "reformatted-by-shfmt"
}

@test "no formatter on PATH -> file untouched, {} result" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo  hi\n' > "$cwd/a.sh"
  run format_file_call "$cwd/a.sh" "$cwd"       # no shfmt stub created
  assert_success
  [ "$output" = "{}" ]
  run cat "$cwd/a.sh"
  assert_output "echo  hi"
}

@test "non-target extension (.txt) -> formatter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'hi\n' > "$cwd/a.txt"
  rec_stub shfmt
  run format_file_call "$cwd/a.txt" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "path outside cwd -> formatter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  local out="$BATS_TEST_TMPDIR/outside"; mkdir -p "$out"
  printf 'echo x\n' > "$out/a.sh"
  rec_stub shfmt
  run format_file_call "$out/a.sh" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "node_modules path -> formatter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd/node_modules/x"
  printf 'echo x\n' > "$cwd/node_modules/x/a.sh"
  rec_stub shfmt
  run format_file_call "$cwd/node_modules/x/a.sh" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "auto_format=false in user settings -> formatter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo  hi\n' > "$cwd/a.sh"
  rec_stub shfmt
  printf '{"pluginConfigs":{"universal-format@kwitsch-plugins":{"options":{"auto_format":false}}}}\n' > "$HOME/.claude/settings.json"
  run format_file_call "$cwd/a.sh" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "go fallback chain: gofmt used when only gofmt present; goimports wins when both present" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'package main\n' > "$cwd/a.go"
  RECORD="$BATS_TEST_TMPDIR/rec1"; : > "$RECORD"
  rec_stub gofmt
  run format_file_call "$cwd/a.go" "$cwd"
  assert_success
  run rg_or_grep -F "gofmt " "$RECORD"
  assert_success
  # now both present -> goimports (first in chain) wins
  RECORD="$BATS_TEST_TMPDIR/rec2"; : > "$RECORD"
  printf 'package main\n' > "$cwd/a.go"
  rec_stub goimports
  run format_file_call "$cwd/a.go" "$cwd"
  assert_success
  run rg_or_grep -F "goimports " "$RECORD"
  assert_success
  run rg_or_grep -F "gofmt " "$RECORD"
  assert_failure
}

@test "formatter exits 1 WITHOUT changing file -> {} (no crash)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'echo  hi\n' > "$cwd/a.sh"
  make_stub shfmt 'printf "%s %s\n" shfmt "$*" >> "$RECORD"' 'exit 1'   # no file change
  run format_file_call "$cwd/a.sh" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "formatter exits 1 AFTER changing file (ktlint case) -> additionalContext still returned" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'fun main(){}\n' > "$cwd/a.kt"
  make_stub ktlint \
    'printf "%s %s\n" ktlint "$*" >> "$RECORD"' \
    'for last; do :; done' \
    'printf "reformatted\n" > "$last"' \
    'exit 1'
  run format_file_call "$cwd/a.kt" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("ktlint reformatted a.kt")'
}

# --- behavioral: .editorconfig mapping + tool-native-config precedence -------

@test "java .editorconfig indent_size=4 -> google-java-format gets --aosp" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'class A {}\n' > "$cwd/A.java"
  printf 'root = true\n[*.java]\nindent_size = 4\n' > "$cwd/.editorconfig"
  rec_stub google-java-format
  run format_file_call "$cwd/A.java" "$cwd"
  assert_success
  run rg_or_grep -F -- "--aosp" "$RECORD"
  assert_success
}

@test "java .editorconfig indent_size=2 -> google-java-format runs bare (no --aosp)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'class A {}\n' > "$cwd/A.java"
  printf 'root = true\n[*.java]\nindent_size = 2\n' > "$cwd/.editorconfig"
  rec_stub google-java-format
  run format_file_call "$cwd/A.java" "$cwd"
  assert_success
  run rg_or_grep -F -- "--aosp" "$RECORD"
  assert_failure
  run rg_or_grep -F -- "--replace" "$RECORD"
  assert_success
}

@test "java .editorconfig indent_style=tab -> hard conflict, formatter never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'class A {}\n' > "$cwd/A.java"
  printf 'root = true\n[*]\nindent_style = tab\n' > "$cwd/.editorconfig"
  rec_stub google-java-format
  run format_file_call "$cwd/A.java" "$cwd"
  assert_success
  [ "$output" = "{}" ]
  [ ! -s "$RECORD" ]
}

@test "java .editorconfig indent_style=tab -> google-java-format skips, clang-format fallback runs" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'class A {}\n' > "$cwd/A.java"
  printf 'root = true\n[*]\nindent_style = tab\n' > "$cwd/.editorconfig"
  rec_stub google-java-format
  rec_stub clang-format
  run format_file_call "$cwd/A.java" "$cwd"
  assert_success
  local result="$output"
  run rg_or_grep -F "google-java-format " "$RECORD"
  assert_failure
  run rg_or_grep -F "clang-format " "$RECORD"
  assert_success
  echo "$result" | jq -e '.hookSpecificOutput.additionalContext | test("clang-format reformatted A.java")'
}

@test "python: pyproject [tool.ruff] beats .editorconfig -> ruff runs bare (no --line-length)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'x=1\n' > "$cwd/a.py"
  printf '[tool.ruff]\nline-length = 79\n' > "$cwd/pyproject.toml"
  printf 'root = true\n[*]\nmax_line_length = 88\n' > "$cwd/.editorconfig"
  rec_stub ruff
  run format_file_call "$cwd/a.py" "$cwd"
  assert_success
  run rg_or_grep -F -- "--line-length" "$RECORD"
  assert_failure
}

@test "python: .editorconfig only (no pyproject) -> ruff gets --line-length" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'x=1\n' > "$cwd/a.py"
  printf 'root = true\n[*]\nmax_line_length = 88\n' > "$cwd/.editorconfig"
  rec_stub ruff
  run format_file_call "$cwd/a.py" "$cwd"
  assert_success
  run rg_or_grep -F -- "--line-length 88" "$RECORD"
  assert_success
}

@test "jsts: biome.json native config beats .editorconfig -> biome runs bare (no mapped flags)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x=1\n' > "$cwd/a.js"
  printf '{}\n' > "$cwd/biome.json"
  printf 'root = true\n[*]\nindent_style = space\nindent_size = 2\n' > "$cwd/.editorconfig"
  rec_stub biome
  run format_file_call "$cwd/a.js" "$cwd"
  assert_success
  run rg_or_grep -F -- "--indent-style" "$RECORD"
  assert_failure
  run rg_or_grep -F "biome " "$RECORD"
  assert_success
}

@test "jsts: prettier absent but npx present -> npx --yes prettier fallback runs" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x=1\n' > "$cwd/a.js"
  rec_stub npx
  run format_file_call "$cwd/a.js" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("prettier reformatted a.js")'
  run rg_or_grep -F "npx --yes prettier" "$RECORD"
  assert_success
  run cat "$cwd/a.js"
  assert_output --partial "reformatted-by-npx"
}

@test "jsts: prettier present on PATH -> npx never invoked" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x=1\n' > "$cwd/a.js"
  rec_stub prettier
  rec_stub npx   # present but must not be used
  run format_file_call "$cwd/a.js" "$cwd"
  assert_success
  run rg_or_grep -E "^prettier " "$RECORD"
  assert_success
  run rg_or_grep -F "npx" "$RECORD"
  assert_failure
}

@test "jsts: prettier and biome both absent, npx also absent -> {}" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x=1\n' > "$cwd/a.js"
  run format_file_call "$cwd/a.js" "$cwd"
  assert_success
  [ "$output" = "{}" ]
}

@test "jsts: biome on PATH, prettier absent, npx present -> biome wins (native beats npx-only)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'let x=1\n' > "$cwd/a.js"
  rec_stub biome
  rec_stub npx   # present but must not be used -- biome is genuinely installed
  run format_file_call "$cwd/a.js" "$cwd"
  assert_success
  run rg_or_grep -E "^biome " "$RECORD"
  assert_success
  run rg_or_grep -F "npx" "$RECORD"
  assert_failure
}

@test "formats a json file: prettier runs" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '{"a":1}' > "$cwd/a.json"
  rec_stub prettier
  run format_file_call "$cwd/a.json" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("prettier reformatted a.json")'
  run rg_or_grep -E "^prettier " "$RECORD"
  assert_success
}

@test "json: biome.json present, prettier absent -> biome runs bare" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '{"a":1}' > "$cwd/a.json"
  printf '{}\n' > "$cwd/biome.json"
  printf 'root = true\n[*]\nindent_style = space\nindent_size = 2\n' > "$cwd/.editorconfig"
  rec_stub biome
  run format_file_call "$cwd/a.json" "$cwd"
  assert_success
  run rg_or_grep -F -- "--indent-style" "$RECORD"
  assert_failure
  run rg_or_grep -F "biome " "$RECORD"
  assert_success
}

@test "formats a yaml file: prettier runs" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'a: 1\n' > "$cwd/a.yaml"
  rec_stub prettier
  run format_file_call "$cwd/a.yaml" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("prettier reformatted a.yaml")'
}

@test "formats a yml file: prettier runs (.yml extension)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf 'a: 1\n' > "$cwd/a.yml"
  rec_stub prettier
  run format_file_call "$cwd/a.yml" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("prettier reformatted a.yml")'
}

@test "formats a markdown file: prettier runs" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  RECORD="$BATS_TEST_TMPDIR/rec"; : > "$RECORD"
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  printf '# hi\n' > "$cwd/a.md"
  rec_stub prettier
  run format_file_call "$cwd/a.md" "$cwd"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("prettier reformatted a.md")'
}
