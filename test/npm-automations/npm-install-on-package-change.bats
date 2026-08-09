#!/usr/bin/env bats

# npm-install-on-package-change hook (PostToolUse Write|Edit) — npm-automations plugin.

load 'test_helper'

setup() {
  common_setup
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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

# make_pnpm_stub <exit_code> <stdout_text> -- same as make_npm_stub, but for a fake
# `pnpm` on PATH; records to the same $CALLLOG.
make_pnpm_stub() {
  local exit_code="$1" stdout_text="$2"
  PNPMDIR="$BATS_TEST_TMPDIR/pnpmbin"
  mkdir -p "$PNPMDIR"
  CALLLOG="$BATS_TEST_TMPDIR/npm-calls.log"
  cat > "$PNPMDIR/pnpm" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$PWD \$*" >> "$CALLLOG"
printf '%s' "$stdout_text"
exit $exit_code
EOF
  chmod +x "$PNPMDIR/pnpm"
  export PATH="$PNPMDIR:$PATH"
}

# edit_hook <enabled> <file_path> <old_string> <new_string> -- drive the hook with
# an Edit-shaped PostToolUse payload.
edit_hook() {
  jq -cn --arg fp "$2" --arg old "$3" --arg new "$4" \
    '{tool_name:"Edit", tool_input:{file_path:$fp, old_string:$old, new_string:$new}, cwd:($fp|. as $p | $p)}' \
    | CLAUDE_PLUGIN_OPTION_NPM_INSTALL_ON_PACKAGE_CHANGE="$1" "$HOOKS/npm-install-on-package-change.mjs" 2>/dev/null
}

# write_hook <enabled> <file_path> -- drive the hook with a Write-shaped payload.
write_hook() {
  jq -cn --arg fp "$2" --arg content "$(cat "$2")" \
    '{tool_name:"Write", tool_input:{file_path:$fp, content:$content}}' \
    | CLAUDE_PLUGIN_OPTION_NPM_INSTALL_ON_PACKAGE_CHANGE="$1" "$HOOKS/npm-install-on-package-change.mjs" 2>/dev/null
}

@test "npm-install-on-package-change is executable" {
  [ -x "$HOOKS/npm-install-on-package-change.mjs" ]
}

@test "version-only edit triggers no npm call" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_npm_stub 0 "ok"
  PROJ="$BATS_TEST_TMPDIR/proj1"; mkdir -p "$PROJ"
  cat > "$PROJ/package.json" <<'EOF'
{
  "name": "x",
  "version": "1.0.1",
  "devDependencies": {
    "debug": "^4.4.3"
  }
}
EOF
  run edit_hook "true" "$PROJ/package.json" '"version": "1.0.0"' '"version": "1.0.1"'
  assert_success
  [ -z "$output" ]
  [ ! -f "$CALLLOG" ]
}

@test "a changed dependency value runs npm install scoped to that spec" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_npm_stub 0 "ok"
  PROJ="$BATS_TEST_TMPDIR/proj2"; mkdir -p "$PROJ"
  cat > "$PROJ/package.json" <<'EOF'
{
  "name": "x",
  "version": "1.0.0",
  "dependencies": {
    "left-pad": "^2.0.0"
  }
}
EOF
  run edit_hook "true" "$PROJ/package.json" '"left-pad": "^1.0.0"' '"left-pad": "^2.0.0"'
  assert_success
  [ -z "$output" ]
  grep -q "^$PROJ install left-pad@\^2.0.0\$" "$CALLLOG"
}

@test "a newly-added dependency is included in the install specs" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_npm_stub 0 "ok"
  PROJ="$BATS_TEST_TMPDIR/proj3"; mkdir -p "$PROJ"
  cat > "$PROJ/package.json" <<'EOF'
{
  "name": "x",
  "version": "1.0.0",
  "dependencies": {
    "left-pad": "^1.0.0",
    "debug": "^4.4.3"
  }
}
EOF
  run edit_hook "true" "$PROJ/package.json" \
    '"left-pad": "^1.0.0"' '"left-pad": "^1.0.0",
    "debug": "^4.4.3"'
  assert_success
  [ -z "$output" ]
  grep -q "^$PROJ install debug@\^4.4.3\$" "$CALLLOG"
}

@test "ambiguous reconstruction (new_string not unique) falls back to bare npm install" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_npm_stub 0 "ok"
  PROJ="$BATS_TEST_TMPDIR/proj4"; mkdir -p "$PROJ"
  cat > "$PROJ/package.json" <<'EOF'
{
  "name": "x",
  "version": "1.0.0",
  "dependencies": {
    "a": "^1.0.0",
    "b": "^1.0.0"
  }
}
EOF
  # new_string '"^1.0.0"' appears twice in the file (once per dependency value) --
  # deliberately non-unique, so reconstruction must bail to the full-install fallback.
  run edit_hook "true" "$PROJ/package.json" 'DOES-NOT-MATTER' '"^1.0.0"'
  assert_success
  [ -z "$output" ]
  grep -q "^$PROJ install\$" "$CALLLOG"
}

@test "Write creating a brand-new package.json runs bare npm install" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_npm_stub 0 "ok"
  PROJ="$BATS_TEST_TMPDIR/proj5"; mkdir -p "$PROJ"
  cat > "$PROJ/package.json" <<'EOF'
{
  "name": "x",
  "version": "1.0.0",
  "dependencies": {
    "left-pad": "^1.0.0"
  }
}
EOF
  run write_hook "true" "$PROJ/package.json"
  assert_success
  [ -z "$output" ]
  grep -q "^$PROJ install\$" "$CALLLOG"
}

@test "toggle off (env var false) never invokes npm" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_npm_stub 0 "ok"
  PROJ="$BATS_TEST_TMPDIR/proj6"; mkdir -p "$PROJ"
  cat > "$PROJ/package.json" <<'EOF'
{"name": "x", "version": "1.0.0", "dependencies": {"left-pad": "^2.0.0"}}
EOF
  run edit_hook "false" "$PROJ/package.json" '"left-pad": "^1.0.0"' '"left-pad": "^2.0.0"'
  assert_success
  [ -z "$output" ]
  [ ! -f "$CALLLOG" ]
}

@test "malformed JSON after edit fails open, no npm call" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_npm_stub 0 "ok"
  PROJ="$BATS_TEST_TMPDIR/proj7"; mkdir -p "$PROJ"
  printf '{ not valid json' > "$PROJ/package.json"
  run edit_hook "true" "$PROJ/package.json" 'x' 'y'
  assert_success
  [ -z "$output" ]
  [ ! -f "$CALLLOG" ]
}

@test "path under node_modules is a no-op" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_npm_stub 0 "ok"
  PROJ="$BATS_TEST_TMPDIR/proj8/node_modules/some-pkg"; mkdir -p "$PROJ"
  cat > "$PROJ/package.json" <<'EOF'
{"name": "x", "version": "1.0.0"}
EOF
  run edit_hook "true" "$PROJ/package.json" '"version": "1.0.0"' '"version": "1.0.0"'
  assert_success
  [ -z "$output" ]
  [ ! -f "$CALLLOG" ]
}

@test "non-package.json file is a no-op" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_npm_stub 0 "ok"
  PROJ="$BATS_TEST_TMPDIR/proj9"; mkdir -p "$PROJ"
  echo '{}' > "$PROJ/other.json"
  run edit_hook "true" "$PROJ/other.json" 'x' 'y'
  assert_success
  [ -z "$output" ]
  [ ! -f "$CALLLOG" ]
}

@test "npm failure surfaces additionalContext, truncated" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_npm_stub 1 "npm ERR! peer dep missing"
  PROJ="$BATS_TEST_TMPDIR/proj10"; mkdir -p "$PROJ"
  cat > "$PROJ/package.json" <<'EOF'
{"name": "x", "version": "1.0.0", "dependencies": {"left-pad": "^2.0.0"}}
EOF
  run edit_hook "true" "$PROJ/package.json" '"left-pad": "^1.0.0"' '"left-pad": "^2.0.0"'
  assert_success
  assert_output --partial '"additionalContext"'
  assert_output --partial 'npm install` failed'
  assert_output --partial "peer dep missing"
}

@test "a pnpm-lock.yaml directory runs pnpm add <spec>, not npm install" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_pnpm_stub 0 "ok"
  PROJ="$BATS_TEST_TMPDIR/proj-pnpm"; mkdir -p "$PROJ"; : > "$PROJ/pnpm-lock.yaml"
  cat > "$PROJ/package.json" <<'EOF'
{
  "name": "x",
  "version": "1.0.0",
  "dependencies": {
    "left-pad": "^2.0.0"
  }
}
EOF
  run edit_hook "true" "$PROJ/package.json" '"left-pad": "^1.0.0"' '"left-pad": "^2.0.0"'
  assert_success
  [ -z "$output" ]
  grep -q "^$PROJ add left-pad@\^2.0.0\$" "$CALLLOG"
}

@test "a pnpm-lock.yaml directory falls back to bare pnpm install (not npm) on Write" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_pnpm_stub 0 "ok"
  PROJ="$BATS_TEST_TMPDIR/proj-pnpm-write"; mkdir -p "$PROJ"; : > "$PROJ/pnpm-lock.yaml"
  cat > "$PROJ/package.json" <<'EOF'
{
  "name": "x",
  "version": "1.0.0",
  "dependencies": {
    "left-pad": "^1.0.0"
  }
}
EOF
  run write_hook "true" "$PROJ/package.json"
  assert_success
  [ -z "$output" ]
  grep -q "^$PROJ install\$" "$CALLLOG"
}

@test "pnpm missing from PATH surfaces a one-line diagnostic" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local fakebin="$BATS_TEST_TMPDIR/fakebin-no-pnpm"
  mkdir -p "$fakebin"
  for t in node env bash jq; do
    src="$(command -v "$t" 2>/dev/null)" && ln -s "$src" "$fakebin/$t"
  done
  PROJ="$BATS_TEST_TMPDIR/proj-pnpm-missing"; mkdir -p "$PROJ"; : > "$PROJ/pnpm-lock.yaml"
  cat > "$PROJ/package.json" <<'EOF'
{"name": "x", "version": "1.0.0", "dependencies": {"left-pad": "^2.0.0"}}
EOF
  local payload="$BATS_TEST_TMPDIR/payload-pnpm-missing.json"
  jq -cn --arg fp "$PROJ/package.json" --arg old '"left-pad": "^1.0.0"' --arg new '"left-pad": "^2.0.0"' \
    '{tool_name:"Edit", tool_input:{file_path:$fp, old_string:$old, new_string:$new}}' > "$payload"
  run env -i PATH="$fakebin" HOME="$HOME" CLAUDE_PLUGIN_OPTION_NPM_INSTALL_ON_PACKAGE_CHANGE=true \
    bash -c "'$HOOKS/npm-install-on-package-change.mjs' < '$payload'"
  assert_success
  assert_output --partial "pnpm not found on PATH"
}

@test "finds pnpm at \$HOME/.local/bin even when it's absent from the inherited PATH" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local localbin="$HOME/.local/bin"
  mkdir -p "$localbin"
  CALLLOG="$BATS_TEST_TMPDIR/npm-calls.log"
  cat > "$localbin/pnpm" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$PWD \$*" >> "$CALLLOG"
exit 0
EOF
  chmod +x "$localbin/pnpm"
  local fakebin="$BATS_TEST_TMPDIR/fakebin-no-localbin"
  mkdir -p "$fakebin"
  for t in node env bash jq; do
    src="$(command -v "$t" 2>/dev/null)" && ln -s "$src" "$fakebin/$t"
  done
  PROJ="$BATS_TEST_TMPDIR/proj-localbin"; mkdir -p "$PROJ"; : > "$PROJ/pnpm-lock.yaml"
  cat > "$PROJ/package.json" <<'EOF'
{"name": "x", "version": "1.0.0", "dependencies": {"left-pad": "^2.0.0"}}
EOF
  local payload="$BATS_TEST_TMPDIR/payload-localbin.json"
  jq -cn --arg fp "$PROJ/package.json" --arg old '"left-pad": "^1.0.0"' --arg new '"left-pad": "^2.0.0"' \
    '{tool_name:"Edit", tool_input:{file_path:$fp, old_string:$old, new_string:$new}}' > "$payload"
  # PATH deliberately excludes $HOME/.local/bin -- the hook's own PATH fix must add
  # it back for the stub to be found at all.
  run env -i PATH="$fakebin" HOME="$HOME" CLAUDE_PLUGIN_OPTION_NPM_INSTALL_ON_PACKAGE_CHANGE=true \
    bash -c "'$HOOKS/npm-install-on-package-change.mjs' < '$payload'"
  assert_success
  [ -z "$output" ]
  grep -q "^$PROJ add left-pad@\^2.0.0\$" "$CALLLOG"
}

@test "a stale ~/.local/bin/pnpm never shadows the real one earlier on PATH" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local localbin="$HOME/.local/bin"
  mkdir -p "$localbin"
  cat > "$localbin/pnpm" <<'EOF'
#!/usr/bin/env bash
echo "stale-local-bin-pnpm" >&2
exit 1
EOF
  chmod +x "$localbin/pnpm"
  make_pnpm_stub 0 "ok"
  PROJ="$BATS_TEST_TMPDIR/proj-pnpm-shadow"; mkdir -p "$PROJ"; : > "$PROJ/pnpm-lock.yaml"
  cat > "$PROJ/package.json" <<'EOF'
{"name": "x", "version": "1.0.0", "dependencies": {"left-pad": "^2.0.0"}}
EOF
  run edit_hook "true" "$PROJ/package.json" '"left-pad": "^1.0.0"' '"left-pad": "^2.0.0"'
  assert_success
  [ -z "$output" ]
  grep -q "^$PROJ add left-pad@\^2.0.0\$" "$CALLLOG"
}

@test "npm missing from PATH surfaces a one-line diagnostic" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local fakebin="$BATS_TEST_TMPDIR/fakebin-no-npm"
  mkdir -p "$fakebin"
  for t in node env bash jq; do
    src="$(command -v "$t" 2>/dev/null)" && ln -s "$src" "$fakebin/$t"
  done
  PROJ="$BATS_TEST_TMPDIR/proj11"; mkdir -p "$PROJ"
  cat > "$PROJ/package.json" <<'EOF'
{"name": "x", "version": "1.0.0", "dependencies": {"left-pad": "^2.0.0"}}
EOF
  local payload="$BATS_TEST_TMPDIR/payload.json"
  jq -cn --arg fp "$PROJ/package.json" --arg old '"left-pad": "^1.0.0"' --arg new '"left-pad": "^2.0.0"' \
    '{tool_name:"Edit", tool_input:{file_path:$fp, old_string:$old, new_string:$new}}' > "$payload"
  run env -i PATH="$fakebin" HOME="$HOME" CLAUDE_PLUGIN_OPTION_NPM_INSTALL_ON_PACKAGE_CHANGE=true \
    bash -c "'$HOOKS/npm-install-on-package-change.mjs' < '$payload'"
  assert_success
  assert_output --partial "npm not found on PATH"
}

@test "hooks.json wires Write|Edit -> npm-install-on-package-change with async:true and no args" {
  run jq -e '.hooks.PostToolUse[1]
    | .matcher == "Write|Edit"
      and (.hooks[0].type == "command")
      and (.hooks[0].command == "${CLAUDE_PLUGIN_ROOT}/hooks/npm-install-on-package-change.mjs")
      and (.hooks[0] | has("args") | not)
      and (.hooks[0].async == true)' "$HOOKS/hooks.json"
  assert_success
}

@test "plugin.json declares npm_install_on_package_change userConfig: boolean, default true" {
  run jq -e '.userConfig.npm_install_on_package_change
    | .type == "boolean"
      and .default == true
      and (.title | length > 0)
      and (.description | length > 0)' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}
