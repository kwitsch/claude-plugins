#!/usr/bin/env bats
# Structural suite for the claude-code-knowledge plugin (cc-reference shape).
# Hermetic: pure file/JSON assertions, no network, no claude CLI.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/claude-code-knowledge"
  SKILL="$PLUGIN/skills/cc-reference"
  REFS="$SKILL/references"
  MARKET="$REPO_ROOT/.claude-plugin/marketplace.json"
  MAINT="$REPO_ROOT/.claude/skills/update-cc-references/SKILL.md"
}

# --- Manifest invariants ---

@test "plugin.json is valid JSON" {
  run jq empty "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
}

@test "plugin.json name is claude-code-knowledge" {
  run jq -r '.name' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [ "$output" = "claude-code-knowledge" ]
}

@test "plugin.json declares a version" {
  run jq -e '.version' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
}

@test "marketplace entry exists for claude-code-knowledge" {
  run jq -e '.plugins[] | select(.name == "claude-code-knowledge")' "$MARKET"
  [ "$status" -eq 0 ]
}

@test "marketplace entry carries no version (version lives only in plugin.json)" {
  run jq -e '.plugins[] | select(.name == "claude-code-knowledge") | has("version")' "$MARKET"
  [ "$output" = "false" ]
}

# --- Lookup skill ---

@test "cc-reference SKILL.md exists" {
  [ -f "$SKILL/SKILL.md" ]
}

@test "cc-reference SKILL.md has name and description frontmatter" {
  run grep -E '^name:[[:space:]]*cc-reference' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
  run grep -E '^description:' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-reference SKILL.md allowed-tools includes Read, Grep, and WebFetch fallback" {
  run grep -E '^allowed-tools:.*Read' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
  run grep -E '^allowed-tools:.*Grep' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
  run grep -E '^allowed-tools:.*WebFetch' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-reference SKILL.md documents a live-doc fallback" {
  run grep -iE 'Live-doc|WebFetch' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-reference SKILL.md is model-invocable (no disable-model-invocation)" {
  run grep -E '^disable-model-invocation:[[:space:]]*true' "$SKILL/SKILL.md"
  [ "$status" -ne 0 ]
}

# --- Reference files ---

@test "all reference files exist and are non-empty" {
  for f in claude-code-skills-reference.md claude-code-agents-reference.md \
           claude-code-hooks-reference.md hook-handler-selection.md \
           claude-code-commands-reference.md claude-code-mcp-reference.md \
           claude-code-plugins-reference.md claude-code-memory-reference.md \
           claude-code-settings-reference.md; do
    [ -s "$REFS/$f" ]
  done
}

@test "each reference file has at least one '## ' heading" {
  for f in claude-code-skills-reference.md claude-code-agents-reference.md \
           claude-code-hooks-reference.md hook-handler-selection.md \
           claude-code-commands-reference.md claude-code-mcp-reference.md \
           claude-code-plugins-reference.md claude-code-memory-reference.md \
           claude-code-settings-reference.md; do
    run grep -cE '^## ' "$REFS/$f"
    [ "$status" -eq 0 ]
    [ "$output" -ge 1 ]
  done
}

@test "each reference file header carries a verified date" {
  for f in claude-code-skills-reference.md claude-code-agents-reference.md \
           claude-code-hooks-reference.md hook-handler-selection.md \
           claude-code-commands-reference.md claude-code-mcp-reference.md \
           claude-code-plugins-reference.md claude-code-memory-reference.md \
           claude-code-settings-reference.md; do
    run grep -iE 'verified' "$REFS/$f"
    [ "$status" -eq 0 ]
  done
}

@test "SKILL.md routing/section index names each reference file" {
  for f in claude-code-skills-reference.md claude-code-agents-reference.md \
           claude-code-hooks-reference.md hook-handler-selection.md \
           claude-code-commands-reference.md claude-code-mcp-reference.md \
           claude-code-plugins-reference.md claude-code-memory-reference.md \
           claude-code-settings-reference.md; do
    run grep -F "$f" "$SKILL/SKILL.md"
    [ "$status" -eq 0 ]
  done
}

@test "cc-reference SKILL.md has no executable !-injection trigger" {
  # `!` immediately followed by a backtick is Claude Code's dynamic-context
  # injection trigger — it RUNS at skill load. SKILL.md must never contain it
  # (it would execute, e.g. `cmd: command not found`). Such examples belong only
  # in the reference files, which are Read on demand and never preprocessed.
  run grep -nE '!`' "$SKILL/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "reference files live in the references/ subfolder, not the skill root" {
  [ -d "$REFS" ]
  # only SKILL.md may sit at the skill root; every other *.md lives under references/
  run bash -c 'ls "$1"/*.md 2>/dev/null | grep -v "/SKILL.md$" || true' _ "$SKILL"
  [ -z "$output" ]
}

@test "SKILL.md points reference paths at the references/ subfolder" {
  run grep -E '\$\{CLAUDE_SKILL_DIR\}/references/claude-code-skills-reference.md' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "skill-folder-structure convention file exists and documents the references/ rule" {
  [ -s "$REFS/skill-folder-structure.md" ]
  run grep -cE '^## ' "$REFS/skill-folder-structure.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
  run grep -F 'references/' "$REFS/skill-folder-structure.md"
  [ "$status" -eq 0 ]
  run grep -F "skill-folder-structure.md" "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}

# --- Maintenance skill (repo-root project skill; cross-tree coupling is intentional) ---

@test "update-cc-references maintenance skill exists" {
  [ -f "$MAINT" ]
}

@test "update-cc-references is user-only (disable-model-invocation: true)" {
  run grep -E '^disable-model-invocation:[[:space:]]*true' "$MAINT"
  [ "$status" -eq 0 ]
}

@test "update-cc-references allowed-tools include fetch + edit + release tools" {
  for tool in WebFetch Read Edit Write Glob Bash Skill; do
    run grep -E "^allowed-tools:.*$tool" "$MAINT"
    [ "$status" -eq 0 ]
  done
}

@test "update-cc-references covers the new targets and files" {
  run grep -E '^argument-hint:' "$MAINT"
  [ "$status" -eq 0 ]
  for tok in commands mcp plugins memory settings; do
    printf '%s\n' "$output" | grep -q "$tok"
  done
  for f in claude-code-commands-reference.md claude-code-mcp-reference.md \
           claude-code-plugins-reference.md claude-code-memory-reference.md \
           claude-code-settings-reference.md; do
    run grep -F "$f" "$MAINT"
    [ "$status" -eq 0 ]
  done
}

@test "update-cc-references release does a patch bump and stamps the ingestion date" {
  run grep -iE 'Patch version bump' "$MAINT"
  [ "$status" -eq 0 ]
  run grep -F 'CC docs read:' "$MAINT"
  [ "$status" -eq 0 ]
}

# --- No stray rejected components ---

@test "old rejected runtime-fetch artifacts are absent" {
  [ ! -f "$PLUGIN/agents/cc-knowledge.md" ]
  [ ! -d "$PLUGIN/bin" ]
  [ ! -d "$PLUGIN/references" ]
  [ ! -d "$PLUGIN/skills/cck-skill" ]
  [ ! -d "$PLUGIN/skills/cck-agent" ]
  [ ! -d "$PLUGIN/skills/cck-rule" ]
  [ ! -d "$PLUGIN/skills/cck-hook" ]
  [ ! -d "$REPO_ROOT/test/claude-code-knowledge/harness" ]
}

@test "claude-code-expert agent has name and description" {
  run grep -E '^name:[[:space:]]*claude-code-expert' "$PLUGIN/agents/claude-code-expert.md"
  [ "$status" -eq 0 ]
  run grep -E '^description:' "$PLUGIN/agents/claude-code-expert.md"
  [ "$status" -eq 0 ]
}

@test "claude-code-expert declares a model and cc-reference tools (Skill, Read, Grep)" {
  run grep -E '^model:' "$PLUGIN/agents/claude-code-expert.md"
  [ "$status" -eq 0 ]
  run grep -E '^tools:.*Skill' "$PLUGIN/agents/claude-code-expert.md"
  [ "$status" -eq 0 ]
  run grep -E '^tools:.*Read' "$PLUGIN/agents/claude-code-expert.md"
  [ "$status" -eq 0 ]
  run grep -E '^tools:.*Grep' "$PLUGIN/agents/claude-code-expert.md"
  [ "$status" -eq 0 ]
}

@test "claude-code-expert has no write or Bash tools" {
  run grep -E '^tools:.*(Write|Edit|NotebookEdit|Bash)' "$PLUGIN/agents/claude-code-expert.md"
  [ "$status" -ne 0 ]
}

# Drive the reroute MCP server: initialize + one tools/call, echo the
# structuredContent of the tools/call (id 2) response. $1 = arguments JSON object.
reroute_call() {
  printf '%s\n%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"reroute_guide\",\"arguments\":$1}}" \
    | node "$PLUGIN/mcp/server.mjs" 2>/dev/null \
    | jq -c 'select(.id==2) | .result.structuredContent'
}

@test "hooks.json wires the PreToolUse Agent reroute to the mcp_tool" {
  run jq empty "$PLUGIN/hooks/hooks.json"
  [ "$status" -eq 0 ]
  run jq -e '.hooks.PreToolUse[0].matcher | test("Agent")' "$PLUGIN/hooks/hooks.json"
  [ "$output" = "true" ]
  run jq -r '.hooks.PreToolUse[0].hooks[0].type' "$PLUGIN/hooks/hooks.json"
  [ "$output" = "mcp_tool" ]
  run jq -r '.hooks.PreToolUse[0].hooks[0].server' "$PLUGIN/hooks/hooks.json"
  [ "$output" = "claude-code-knowledge-hooks" ]
  run jq -r '.hooks.PreToolUse[0].hooks[0].tool' "$PLUGIN/hooks/hooks.json"
  [ "$output" = "reroute_guide" ]
}

@test ".mcp.json registers the hooks server pointing at mcp/server.mjs" {
  run jq empty "$PLUGIN/.mcp.json"
  [ "$status" -eq 0 ]
  run jq -r '.mcpServers["claude-code-knowledge-hooks"].command' "$PLUGIN/.mcp.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *"mcp/server.mjs" ]]
}

@test "mcp/server.mjs is executable (repo rule)" {
  [ -x "$PLUGIN/mcp/server.mjs" ]
}

@test "old command reroute hook is gone" {
  [ ! -f "$PLUGIN/hooks/reroute-guide.mjs" ]
}

@test "reroute server reroutes claude-code-guide, preserving prompt and model" {
  if ! command -v node >/dev/null 2>&1; then skip "node not installed"; fi
  sc=$(reroute_call '{"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"subagent_type":"claude-code-guide","prompt":"P","model":"m"}}')
  run jq -r '.hookSpecificOutput.permissionDecision' <<<"$sc"
  [ "$output" = "allow" ]
  run jq -r '.hookSpecificOutput.updatedInput.subagent_type' <<<"$sc"
  [ "$output" = "claude-code-knowledge:claude-code-expert" ]
  run jq -r '.hookSpecificOutput.updatedInput.prompt' <<<"$sc"
  [ "$output" = "P" ]
  run jq -r '.hookSpecificOutput.updatedInput.model' <<<"$sc"
  [ "$output" = "m" ]
}

@test "reroute server reroutes a case/separator variant" {
  if ! command -v node >/dev/null 2>&1; then skip "node not installed"; fi
  sc=$(reroute_call '{"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"subagent_type":"Claude Code Guide","prompt":"x"}}')
  run jq -r '.hookSpecificOutput.updatedInput.subagent_type' <<<"$sc"
  [ "$output" = "claude-code-knowledge:claude-code-expert" ]
}

@test "reroute server is a no-op for other subagents" {
  if ! command -v node >/dev/null 2>&1; then skip "node not installed"; fi
  sc=$(reroute_call '{"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"subagent_type":"general-purpose"}}')
  [ "$sc" = "{}" ]
}
