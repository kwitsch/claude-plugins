#!/usr/bin/env bats

# Tests for the coding-toolbox plugin (golden behavior rules hooks).

setup() {
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/coding-toolbox"
  HOOKS="$PLUGIN/hooks"
}

@test "plugin.json is valid JSON with name/version/description" {
  run jq -e '.name == "coding-toolbox" and (.version | type == "string") and (.description | length > 0)' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}

@test "plugin is registered in marketplace.json" {
  run jq -e '[.plugins[] | select(.name == "coding-toolbox" and .source == "./plugins/coding-toolbox")] | length == 1' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
}

@test "marketplace.json entry carries no version field" {
  run jq -e '[.plugins[] | select(.name == "coding-toolbox") | has("version")] | any | not' "$REPO_ROOT/.claude-plugin/marketplace.json"
  assert_success
}

@test "plugin has a root README table row" {
  run grep -F "[coding-toolbox](plugins/coding-toolbox/README.md)" "$REPO_ROOT/README.md"
  assert_success
}

@test "plugin is in the test.yml matrix" {
  run grep -E "^\s*-\s*coding-toolbox\s*$" "$REPO_ROOT/.github/workflows/test.yml"
  assert_success
}

@test "SessionStart.md exists and is non-empty" {
  run test -s "$HOOKS/SessionStart.md"
  assert_success
}

@test "SessionStart.md covers all four axes and cites all three sourced axes" {
  run cat "$HOOKS/SessionStart.md"
  assert_success
  assert_output --partial "Interaction"
  assert_output --partial "AskUserQuestion"
  assert_output --partial "Language"
  assert_output --partial "Behavior"
  assert_output --partial "Mentality"
  assert_output --partial "cavemem"
  assert_output --partial "andrej-karpathy-skills"
  assert_output --partial "ponytail-lite"
}

@test "SessionStart.md forbids ending a turn with a bare '?'" {
  run cat "$HOOKS/SessionStart.md"
  assert_success
  assert_output --partial 'bare "?"'
}

@test "hooks.json is valid JSON" {
  run jq empty "$HOOKS/hooks.json"
  assert_success
}

@test "SessionStart hook cats SessionStart.md via a command hook (exec form)" {
  run jq -e '.hooks.SessionStart[0].hooks[0] | .type == "command" and .command == "cat" and (.args[0] | endswith("/hooks/SessionStart.md"))' "$HOOKS/hooks.json"
  assert_success
}

# Runtime/end-to-end test: run the wired SessionStart command+args and confirm it
# emits the rules (catches a wrong args path; proves cat+args does not read stdin).
@test "SessionStart hook command emits Golden Rules to stdout (end-to-end)" {
  cmd="$(jq -r '.hooks.SessionStart[0].hooks[0].command' "$HOOKS/hooks.json")"
  arg="$(jq -r '.hooks.SessionStart[0].hooks[0].args[0]' "$HOOKS/hooks.json" | sed "s#\${CLAUDE_PLUGIN_ROOT}#$PLUGIN#")"
  run "$cmd" "$arg"
  assert_success
  assert_output --partial "Golden Rules"
}

@test "PreToolUse hook is matcher-scoped (no Agent/Task) and wired to the mcp_tool" {
  run jq -e '.hooks.PreToolUse[0] | .matcher == "Edit|Write|NotebookEdit|Bash" and (.hooks[0].type == "mcp_tool") and (.hooks[0].server == "plugin:coding-toolbox:coding-toolbox-hooks") and (.hooks[0].tool == "golden_rules_reminder")' "$HOOKS/hooks.json"
  assert_success
}

@test "Stop hook has no matcher and is wired to the interaction_gate mcp_tool" {
  run jq -e '.hooks.Stop[0] | (has("matcher") | not) and (.hooks[0].type == "mcp_tool") and (.hooks[0].server == "plugin:coding-toolbox:coding-toolbox-hooks") and (.hooks[0].tool == "interaction_gate")' "$HOOKS/hooks.json"
  assert_success
}

@test ".mcp.json registers coding-toolbox-hooks pointing at mcp/server.mjs" {
  run jq -e '.mcpServers["coding-toolbox-hooks"].command | endswith("mcp/server.mjs")' "$PLUGIN/.mcp.json"
  assert_success
}

@test "mcp/server.mjs is executable (repo rule)" {
  [ -x "$PLUGIN/mcp/server.mjs" ]
}

# Drive the reminder MCP server: initialize + $1 sequential tools/call requests on
# ONE server process (the throttle counter is in-process, session-lifetime state).
# Echoes one structuredContent JSON per call, in order.
golden_rules_calls() {
  local n="$1"
  {
    printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n'
    for i in $(seq 1 "$n"); do
      printf '{"jsonrpc":"2.0","id":%d,"method":"tools/call","params":{"name":"golden_rules_reminder","arguments":{"hook_event_name":"PreToolUse","tool_name":"Bash"}}}\n' "$((i + 1))"
    done
  } | node "$PLUGIN/mcp/server.mjs" 2>/dev/null \
    | jq -c 'select(.id > 1) | .result.structuredContent'
}

# Anti-flip tripwire (end-to-end): calls 1-9 are silent ({}), call 10 emits the
# additionalContext reminder — proves the throttle, not just the wiring.
@test "server throttles the reminder to every 10th matched call" {
  if ! command -v node >/dev/null 2>&1; then skip "node not installed"; fi
  run golden_rules_calls 10
  assert_success
  mapfile -t lines <<< "$output"
  [ "${#lines[@]}" -eq 10 ]
  for i in $(seq 0 8); do
    [ "${lines[$i]}" = "{}" ]
  done
  echo "${lines[9]}" | jq -e '.hookSpecificOutput.hookEventName == "PreToolUse" and (.hookSpecificOutput.additionalContext | length > 0)'
}

@test "throttled reminder mentions AskUserQuestion" {
  if ! command -v node >/dev/null 2>&1; then skip "node not installed"; fi
  run golden_rules_calls 10
  assert_success
  mapfile -t lines <<< "$output"
  echo "${lines[9]}" | jq -r '.hookSpecificOutput.additionalContext' | grep -q "AskUserQuestion"
}

# Drive the interaction_gate MCP tool with one last_assistant_message. Echoes the
# tools/call structuredContent JSON.
interaction_gate_call() {
  local msg="$1"
  {
    printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n'
    printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"interaction_gate","arguments":{"hook_event_name":"Stop","last_assistant_message":%s}}}\n' "$(jq -Rs . <<< "$msg")"
  } | node "$PLUGIN/mcp/server.mjs" 2>/dev/null \
    | jq -c 'select(.id == 2) | .result.structuredContent'
}

@test "interaction_gate blocks when the final line ends in a bare '?'" {
  if ! command -v node >/dev/null 2>&1; then skip "node not installed"; fi
  run interaction_gate_call $'Done here.\nWant me to X or Y?'
  assert_success
  echo "$output" | jq -e '.decision == "block" and (.reason | length > 0)'
}

@test "interaction_gate allows a normal final line" {
  if ! command -v node >/dev/null 2>&1; then skip "node not installed"; fi
  run interaction_gate_call "All done. Summary above."
  assert_success
  [ "$output" = "{}" ]
}

@test "plugin README first ## heading is Install" {
  run bash -c "grep -m1 '^## ' '$PLUGIN/README.md'"
  assert_success
  assert_output "## Install"
}

@test "plugin README contains the install command" {
  run grep -F "/plugin install coding-toolbox@kwitsch-plugins" "$PLUGIN/README.md"
  assert_success
}

@test "plugin README has no ## Hooks section" {
  run grep -E "^## Hooks" "$PLUGIN/README.md"
  assert_failure
}

@test "fresh-branch SKILL.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/fresh-branch/SKILL.md"
  assert_success
}

@test "fresh-branch frontmatter declares name and required allowed-tools" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/skills/fresh-branch/SKILL.md'"
  assert_success
  assert_output --partial "name: fresh-branch"
  assert_output --partial "AskUserQuestion"
  assert_output --partial 'Bash(git:*)'
}

@test "fresh-branch script detects linked worktree via git-dir comparison" {
  run grep -F 'git rev-parse --git-dir' "$PLUGIN/skills/fresh-branch/SKILL.md"
  assert_success
}

@test "fresh-branch script carries the documented exit-code contract" {
  run grep -F 'Exit: 0 ok' "$PLUGIN/skills/fresh-branch/SKILL.md"
  assert_success
}

@test "fresh-branch script auto-stashes and pops uncommitted changes" {
  run grep -F 'git stash push -u' "$PLUGIN/skills/fresh-branch/SKILL.md"
  assert_success
  run grep -F 'git stash pop' "$PLUGIN/skills/fresh-branch/SKILL.md"
  assert_success
}

@test "fresh-branch worktree path rebases instead of switching branches" {
  run grep -F 'git rebase "origin/$base"' "$PLUGIN/skills/fresh-branch/SKILL.md"
  assert_success
}

@test "fresh-branch checks branch-name collision before touching the tree" {
  run grep -F 'refs/heads/$branch' "$PLUGIN/skills/fresh-branch/SKILL.md"
  assert_success
}
