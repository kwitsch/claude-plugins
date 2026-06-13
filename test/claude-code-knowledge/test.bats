#!/usr/bin/env bats
# Tests for the claude-code-knowledge plugin: manifest invariants, the two
# command hooks (redirect-guide, session-cache), the cc-knowledge agent,
# the shared references, the cck-* skills, and the hermetic harness selftest.

setup() {
  bats_require_minimum_version 1.5.0
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/claude-code-knowledge"
  BIN="$PLUGIN/bin"
}

@test "plugin.json is valid JSON" {
  run -0 jq empty "$PLUGIN/.claude-plugin/plugin.json"
}

@test "plugin.json declares the right name and a version" {
  run -0 jq -e '.name == "claude-code-knowledge" and (.version | type == "string")' \
    "$PLUGIN/.claude-plugin/plugin.json"
}

@test "marketplace lists the plugin and carries no version field there" {
  run -0 jq -e '.plugins[] | select(.name == "claude-code-knowledge") | (has("version") | not)' \
    "$REPO_ROOT/.claude-plugin/marketplace.json"
}

# --- redirect-guide (PreToolUse Agent|Task reroute) ---

@test "redirect-guide reroutes claude-code-guide on the Agent tool" {
  in='{"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"subagent_type":"claude-code-guide","description":"d","prompt":"p"}}'
  run -0 bash -c 'printf "%s" "$1" | "$2"' _ "$in" "$BIN/redirect-guide"
  echo "$output" | jq -e '.hookSpecificOutput.permissionDecision == "allow"'
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.subagent_type == "claude-code-knowledge:cc-knowledge"'
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.description == "d"'
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.prompt == "p"'
}

@test "redirect-guide reroutes on the legacy Task tool name" {
  in='{"hook_event_name":"PreToolUse","tool_name":"Task","tool_input":{"subagent_type":"claude-code-guide","description":"d","prompt":"p"}}'
  run -0 bash -c 'printf "%s" "$1" | "$2"' _ "$in" "$BIN/redirect-guide"
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.subagent_type == "claude-code-knowledge:cc-knowledge"'
}

@test "redirect-guide normalizes a case/separator variant" {
  in='{"tool_name":"Agent","tool_input":{"subagent_type":"Claude Code Guide","description":"d","prompt":"p"}}'
  run -0 bash -c 'printf "%s" "$1" | "$2"' _ "$in" "$BIN/redirect-guide"
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.subagent_type == "claude-code-knowledge:cc-knowledge"'
}

@test "redirect-guide is silent for other subagents" {
  in='{"tool_name":"Agent","tool_input":{"subagent_type":"general-purpose","description":"d","prompt":"p"}}'
  run -0 bash -c 'printf "%s" "$1" | "$2"' _ "$in" "$BIN/redirect-guide"
  assert_output ""
}

@test "hooks.json registers PreToolUse(Agent|Task) -> redirect-guide" {
  f="$PLUGIN/hooks/hooks.json"
  run -0 jq -e '.hooks.PreToolUse[0].matcher == "Agent|Task"' "$f"
  run -0 jq -e '.hooks.PreToolUse[0].hooks[0].type == "command"' "$f"
  run -0 jq -e '.hooks.PreToolUse[0].hooks[0].command | test("redirect-guide")' "$f"
}

# --- session-cache (SessionStart version-scoped doc cache) ---

# Build a stub `claude` that prints a fixed version, placed first on PATH.
_stub_claude() {
  stub="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$stub"
  cat >"$stub/claude" <<'SH'
#!/usr/bin/env sh
echo "2.1.89 (Claude Code)"
SH
  chmod +x "$stub/claude"
  echo "$stub"
}

@test "session-cache keeps the current cache, purges stale, leaves non-cache dirs" {
  stub="$(_stub_claude)"
  data="$BATS_TEST_TMPDIR/data"
  mkdir -p "$data/cache-2.1.89" "$data/cache-2.0.0" "$data/cache-old/sub" "$data/keepme"
  run -0 env HOME="$BATS_TEST_TMPDIR/home" PATH="$stub:$PATH" CLAUDE_PLUGIN_DATA="$data" "$BIN/session-cache"
  [ -d "$data/cache-2.1.89" ]
  [ ! -e "$data/cache-2.0.0" ]
  [ ! -e "$data/cache-old" ]
  [ -d "$data/keepme" ]
  echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "SessionStart"'
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | contains("2.1.89")'
  echo "$output" | jq -e --arg p "$data/cache-2.1.89" '.hookSpecificOutput.additionalContext | contains($p)'
}

@test "session-cache creates the current cache dir when missing" {
  stub="$(_stub_claude)"
  data="$BATS_TEST_TMPDIR/data2"
  mkdir -p "$data"
  run -0 env HOME="$BATS_TEST_TMPDIR/home" PATH="$stub:$PATH" CLAUDE_PLUGIN_DATA="$data" "$BIN/session-cache"
  [ -d "$data/cache-2.1.89" ]
}

@test "session-cache without CLAUDE_PLUGIN_DATA never purges and exits 0" {
  stub="$(_stub_claude)"
  safe="$BATS_TEST_TMPDIR/data3"
  mkdir -p "$safe/cache-x"
  run -0 env -u CLAUDE_PLUGIN_DATA HOME="$BATS_TEST_TMPDIR/home" PATH="$stub:$PATH" "$BIN/session-cache"
  [ -d "$safe/cache-x" ]
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("disabled|unavailable")'
}

@test "session-cache falls back to cache-unknown when version is unresolvable" {
  badstub="$BATS_TEST_TMPDIR/badbin"
  mkdir -p "$badstub"
  cat >"$badstub/claude" <<'SH'
#!/usr/bin/env sh
exit 1
SH
  chmod +x "$badstub/claude"
  data="$BATS_TEST_TMPDIR/data4"
  mkdir -p "$data"
  run -0 env HOME="$BATS_TEST_TMPDIR/home" PATH="$badstub:$PATH" CLAUDE_PLUGIN_DATA="$data" "$BIN/session-cache"
  [ -d "$data/cache-unknown" ]
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | contains("unknown")'
}

@test "hooks.json registers SessionStart -> session-cache" {
  f="$PLUGIN/hooks/hooks.json"
  run -0 jq -e '.hooks.SessionStart[0].hooks[0].type == "command"' "$f"
  run -0 jq -e '.hooks.SessionStart[0].hooks[0].command | test("session-cache")' "$f"
}

# --- cc-knowledge agent ---

@test "cc-knowledge agent declares name and description" {
  f="$PLUGIN/agents/cc-knowledge.md"
  [ -f "$f" ]
  grep -qE '^name:[[:space:]]*cc-knowledge[[:space:]]*$' "$f"
  grep -qE '^description:[[:space:]]*\S' "$f"
}

@test "cc-knowledge agent does not pin a tools allowlist (inherits all)" {
  f="$PLUGIN/agents/cc-knowledge.md"
  run grep -nE '^tools:' "$f"
  assert_failure
}

@test "cc-knowledge agent instructs cache-first then fetch, never training memory" {
  f="$PLUGIN/agents/cc-knowledge.md"
  grep -q 'code.claude.com/docs' "$f"
  grep -qi 'curl' "$f"
  grep -qi 'training memory' "$f"
}

# --- shared references ---

@test "shared workflow reference exists and covers the three modes" {
  f="$PLUGIN/references/cck-workflow.md"
  [ -f "$f" ]
  grep -qi 'create' "$f"
  grep -qi 'validate' "$f"
  grep -qi 'adjust' "$f"
  grep -q 'cc-knowledge' "$f"
}

@test "each component reference exists and points at a docs path" {
  for c in skill agent rule hook; do
    f="$PLUGIN/references/components/$c.md"
    [ -f "$f" ]
    grep -qE 'code.claude.com/docs|llms.txt|en/' "$f"
  done
}

# --- cck-* skills ---

@test "each cck-* skill has frontmatter, references the workflow, and is model-invocable" {
  for s in skill agent rule hook; do
    f="$PLUGIN/skills/cck-$s/SKILL.md"
    [ -f "$f" ]
    grep -qE "^name:[[:space:]]*cck-$s[[:space:]]*$" "$f"
    grep -qE '^description:[[:space:]]*\S' "$f"
    grep -q 'cck-workflow.md' "$f"
    grep -q "components/$s.md" "$f"
    grep -q 'claude-code-knowledge:cc-knowledge' "$f"
    run grep -nE '^disable-model-invocation:[[:space:]]*true' "$f"
    assert_failure
  done
}

# --- harness (test-only, hermetic mock protocol selftest) ---

@test "harness mock protocol selftest passes (skipped if node absent)" {
  if ! command -v node >/dev/null 2>&1; then
    skip "node not installed"
  fi
  sel="$BATS_TEST_DIRNAME/harness/mcp-tool-hook-harness/scripts/selftest-mock.mjs"
  [ -f "$sel" ]
  run -0 node "$sel"
}
