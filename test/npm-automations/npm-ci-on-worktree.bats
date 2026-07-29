#!/usr/bin/env bats

# npm-ci-on-worktree hook (PostToolUse EnterWorktree) — npm-automations plugin.

load 'test_helper'

setup() {
  common_setup
}

# ---------------------------------------------------------------------------
# npm-ci-on-worktree hook -- PostToolUse EnterWorktree: async `npm ci` when a
# package-lock.json exists in the entered worktree's cwd.
# ---------------------------------------------------------------------------

npm_ci_hook() {
  jq -cn --arg cwd "$2" \
    '{tool_name:"EnterWorktree", tool_input:{}, cwd:$cwd}' \
    | CLAUDE_PLUGIN_OPTION_NPM_CI_ON_WORKTREE="$1" "$HOOKS/npm-ci-on-worktree.mjs" 2>/dev/null
}

make_npm_stub() {
  local exit_code="$1" stdout_text="$2"
  NPMDIR="$BATS_TEST_TMPDIR/npmbin"
  mkdir -p "$NPMDIR"
  CALLLOG="$BATS_TEST_TMPDIR/npm-calls.log"
  cat > "$NPMDIR/npm" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$PWD \$*" >> "$CALLLOG"
printf '%s' "$stdout_text"
exit $exit_code
EOF
  chmod +x "$NPMDIR/npm"
  export PATH="$NPMDIR:$PATH"
}
@test "npm-ci-on-worktree is executable" {
  [ -x "$HOOKS/npm-ci-on-worktree.mjs" ]
}
@test "npm-ci-on-worktree: disabled (env var false) never invokes npm" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_npm_stub 0 "ok"
  PROJ="$BATS_TEST_TMPDIR/proj1"; mkdir -p "$PROJ"; : > "$PROJ/package-lock.json"
  run npm_ci_hook "false" "$PROJ"
  assert_success
  [ -z "$output" ]
  [ ! -f "$CALLLOG" ]
}
@test "npm-ci-on-worktree: fail-open on unresolved placeholder env value still invokes npm" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_npm_stub 0 "ok"
  PROJ="$BATS_TEST_TMPDIR/proj2"; mkdir -p "$PROJ"; : > "$PROJ/package-lock.json"
  run npm_ci_hook '${user_config.npm_ci_on_worktree}' "$PROJ"
  assert_success
  [ -z "$output" ]
  [ -f "$CALLLOG" ]
  grep -q " ci\$" "$CALLLOG"
}
@test "npm-ci-on-worktree: fail-open when the env var is entirely unset still invokes npm" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_npm_stub 0 "ok"
  PROJ="$BATS_TEST_TMPDIR/proj2b"; mkdir -p "$PROJ"; : > "$PROJ/package-lock.json"
  run bash -c "jq -cn --arg cwd '$PROJ' '{tool_name:\"EnterWorktree\", tool_input:{}, cwd:\$cwd}' \
    | env -u CLAUDE_PLUGIN_OPTION_NPM_CI_ON_WORKTREE '$HOOKS/npm-ci-on-worktree.mjs' 2>/dev/null"
  assert_success
  [ -z "$output" ]
  [ -f "$CALLLOG" ]
  grep -q " ci\$" "$CALLLOG"
}
@test "npm-ci-on-worktree: enabled + no package-lock.json never invokes npm" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_npm_stub 0 "ok"
  PROJ="$BATS_TEST_TMPDIR/proj3"; mkdir -p "$PROJ"
  run npm_ci_hook "true" "$PROJ"
  assert_success
  [ -z "$output" ]
  [ ! -f "$CALLLOG" ]
}
@test "npm-ci-on-worktree: enabled + lockfile + npm succeeds is silent" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_npm_stub 0 "added 10 packages"
  PROJ="$BATS_TEST_TMPDIR/proj4"; mkdir -p "$PROJ"; : > "$PROJ/package-lock.json"
  run npm_ci_hook "true" "$PROJ"
  assert_success
  [ -z "$output" ]
  grep -q "^$PROJ ci\$" "$CALLLOG"
}
@test "npm-ci-on-worktree: enabled + lockfile + npm fails surfaces additionalContext" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_npm_stub 1 "npm ERR! peer dep missing"
  PROJ="$BATS_TEST_TMPDIR/proj5"; mkdir -p "$PROJ"; : > "$PROJ/package-lock.json"
  run npm_ci_hook "true" "$PROJ"
  assert_success
  assert_output --partial '"additionalContext"'
  assert_output --partial 'npm ci` failed'
  assert_output --partial "peer dep missing"
}
@test "npm-ci-on-worktree fails open on garbage stdin" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  run bash -c "printf 'not json at all' | CLAUDE_PLUGIN_OPTION_NPM_CI_ON_WORKTREE=true '$HOOKS/npm-ci-on-worktree.mjs' 2>/dev/null"
  assert_success
  [ -z "$output" ]
}
@test "npm-ci-on-worktree: npm missing from PATH surfaces a one-line diagnostic" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local fakebin="$BATS_TEST_TMPDIR/fakebin-no-npm"
  mkdir -p "$fakebin"
  for t in node env bash; do
    src="$(command -v "$t" 2>/dev/null)" && ln -s "$src" "$fakebin/$t"
  done
  PROJ="$BATS_TEST_TMPDIR/proj6"; mkdir -p "$PROJ"; : > "$PROJ/package-lock.json"
  local payload="$BATS_TEST_TMPDIR/payload.json"
  jq -cn --arg cwd "$PROJ" '{tool_name:"EnterWorktree", tool_input:{}, cwd:$cwd}' > "$payload"
  run env -i PATH="$fakebin" HOME="$HOME" CLAUDE_PLUGIN_OPTION_NPM_CI_ON_WORKTREE=true \
    bash -c "'$HOOKS/npm-ci-on-worktree.mjs' < '$payload'"
  assert_success
  assert_output --partial "npm not found on PATH"
}
@test "npm-ci-on-worktree PostToolUse hook wired for EnterWorktree with async:true and no args (env-var toggle, not interpolated)" {
  run jq -e '.hooks.PostToolUse[0]
    | .matcher == "EnterWorktree"
      and (.hooks[0].type == "command")
      and (.hooks[0].command == "${CLAUDE_PLUGIN_ROOT}/hooks/npm-ci-on-worktree.mjs")
      and (.hooks[0] | has("args") | not)
      and (.hooks[0].async == true)' "$HOOKS/hooks.json"
  assert_success
}
@test "plugin.json declares npm_ci_on_worktree userConfig: boolean, default true, fail-open" {
  run jq -e '.userConfig.npm_ci_on_worktree
    | .type == "boolean"
      and .default == true
      and (.title | length > 0)
      and (.description | length > 0)' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}
@test "plugin.json description mentions the npm-ci-on-worktree hook" {
  run jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json"
  assert_output --partial "npm_ci_on_worktree"
}
