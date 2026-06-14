#!/usr/bin/env bats
# Structural suite for the claude-code-knowledge plugin (cc-reference shape).
# Hermetic: pure file/JSON assertions, no network, no claude CLI.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/claude-code-knowledge"
  SKILL="$PLUGIN/skills/cc-reference"
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

@test "all four reference files exist and are non-empty" {
  for f in claude-code-skills-reference.md claude-code-agents-reference.md \
           claude-code-hooks-reference.md hook-handler-selection.md; do
    [ -s "$SKILL/$f" ]
  done
}

@test "each reference file has at least one '## ' heading" {
  for f in claude-code-skills-reference.md claude-code-agents-reference.md \
           claude-code-hooks-reference.md hook-handler-selection.md; do
    run grep -cE '^## ' "$SKILL/$f"
    [ "$status" -eq 0 ]
    [ "$output" -ge 1 ]
  done
}

@test "each reference file header carries a verified date" {
  for f in claude-code-skills-reference.md claude-code-agents-reference.md \
           claude-code-hooks-reference.md hook-handler-selection.md; do
    run grep -iE 'verified' "$SKILL/$f"
    [ "$status" -eq 0 ]
  done
}

@test "SKILL.md routing/section index names each reference file" {
  for f in claude-code-skills-reference.md claude-code-agents-reference.md \
           claude-code-hooks-reference.md hook-handler-selection.md; do
    run grep -F "$f" "$SKILL/SKILL.md"
    [ "$status" -eq 0 ]
  done
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

@test "claude-code-expert has no write tools" {
  run grep -E '^tools:.*(Write|Edit|NotebookEdit)' "$PLUGIN/agents/claude-code-expert.md"
  [ "$status" -ne 0 ]
}

@test "hooks.json is valid JSON with a PreToolUse Agent reroute" {
  run jq empty "$PLUGIN/hooks/hooks.json"
  [ "$status" -eq 0 ]
  run jq -e '.hooks.PreToolUse[0].matcher | test("Agent")' "$PLUGIN/hooks/hooks.json"
  [ "$output" = "true" ]
  run jq -e '.hooks.PreToolUse[0].hooks[0].command | test("reroute-guide.mjs")' "$PLUGIN/hooks/hooks.json"
  [ "$output" = "true" ]
}

@test "reroute-guide.mjs reroutes claude-code-guide, preserving prompt and model" {
  if ! command -v node >/dev/null 2>&1; then skip "node not installed"; fi
  out=$(printf '%s' '{"tool_name":"Agent","tool_input":{"subagent_type":"claude-code-guide","prompt":"P","model":"m"}}' | node "$PLUGIN/hooks/reroute-guide.mjs")
  run jq -r '.hookSpecificOutput.permissionDecision' <<<"$out"
  [ "$output" = "allow" ]
  run jq -r '.hookSpecificOutput.updatedInput.subagent_type' <<<"$out"
  [ "$output" = "claude-code-knowledge:claude-code-expert" ]
  run jq -r '.hookSpecificOutput.updatedInput.prompt' <<<"$out"
  [ "$output" = "P" ]
  run jq -r '.hookSpecificOutput.updatedInput.model' <<<"$out"
  [ "$output" = "m" ]
}

@test "reroute-guide.mjs reroutes a case/separator variant" {
  if ! command -v node >/dev/null 2>&1; then skip "node not installed"; fi
  out=$(printf '%s' '{"tool_name":"Agent","tool_input":{"subagent_type":"Claude Code Guide","prompt":"x"}}' | node "$PLUGIN/hooks/reroute-guide.mjs")
  run jq -r '.hookSpecificOutput.updatedInput.subagent_type' <<<"$out"
  [ "$output" = "claude-code-knowledge:claude-code-expert" ]
}

@test "reroute-guide.mjs is silent for other subagents" {
  if ! command -v node >/dev/null 2>&1; then skip "node not installed"; fi
  out=$(printf '%s' '{"tool_name":"Agent","tool_input":{"subagent_type":"general-purpose"}}' | node "$PLUGIN/hooks/reroute-guide.mjs")
  [ -z "$out" ]
}

@test "reroute-guide.mjs fails open (exit 0, no output) on invalid JSON" {
  if ! command -v node >/dev/null 2>&1; then skip "node not installed"; fi
  out=$(printf '%s' 'not json' | node "$PLUGIN/hooks/reroute-guide.mjs")
  rc=$?
  [ "$rc" -eq 0 ]
  [ -z "$out" ]
}
