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
           claude-code-mcp-tool-hooks-reference.md \
           claude-code-commands-reference.md claude-code-mcp-reference.md \
           claude-code-plugins-reference.md claude-code-memory-reference.md \
           claude-code-settings-reference.md; do
    [ -s "$REFS/$f" ]
  done
}

@test "each reference file has at least one '## ' heading" {
  for f in claude-code-skills-reference.md claude-code-agents-reference.md \
           claude-code-hooks-reference.md hook-handler-selection.md \
           claude-code-mcp-tool-hooks-reference.md \
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
           claude-code-mcp-tool-hooks-reference.md \
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
           claude-code-mcp-tool-hooks-reference.md \
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

@test "mcp-tool-hooks reference documents the plugin server-name namespacing gotcha" {
  [ -s "$REFS/claude-code-mcp-tool-hooks-reference.md" ]
  run grep -F 'plugin:<plugin-name>:<server-key>' "$REFS/claude-code-mcp-tool-hooks-reference.md"
  [ "$status" -eq 0 ]
  run grep -iE 'not connected' "$REFS/claude-code-mcp-tool-hooks-reference.md"
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

# --- cc-reviewer agent (parameterized read-only reviewer) ---

@test "cc-reviewer agent has name and description" {
  run grep -E '^name:[[:space:]]*cc-reviewer' "$PLUGIN/agents/cc-reviewer.md"
  [ "$status" -eq 0 ]
  run grep -E '^description:' "$PLUGIN/agents/cc-reviewer.md"
  [ "$status" -eq 0 ]
}

@test "cc-reviewer declares model haiku and cc-reference tools (Skill, Read, Grep, Glob)" {
  run grep -E '^model:[[:space:]]*haiku' "$PLUGIN/agents/cc-reviewer.md"
  [ "$status" -eq 0 ]
  for tool in Skill Read Grep Glob; do
    run grep -E "^tools:.*$tool" "$PLUGIN/agents/cc-reviewer.md"
    [ "$status" -eq 0 ]
  done
}

@test "cc-reviewer has no write or Bash tools" {
  run grep -E '^tools:.*(Write|Edit|NotebookEdit|Bash)' "$PLUGIN/agents/cc-reviewer.md"
  [ "$status" -ne 0 ]
}

@test "cc-reviewer is cc-reference-only and never answers from training memory" {
  run grep -F 'cc-reference' "$PLUGIN/agents/cc-reviewer.md"
  [ "$status" -eq 0 ]
  run grep -iE 'never.*training memory|not.*training memory' "$PLUGIN/agents/cc-reviewer.md"
  [ "$status" -eq 0 ]
}

@test "cc-reviewer documents the structured findings output contract" {
  run grep -iE 'suggested_fix' "$PLUGIN/agents/cc-reviewer.md"
  [ "$status" -eq 0 ]
  run grep -iE 'severity' "$PLUGIN/agents/cc-reviewer.md"
  [ "$status" -eq 0 ]
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
  # A plugin's own mcp_tool hook must reference the runtime-namespaced server name
  # (plugin:<plugin>:<server-key>, as shown by `claude mcp list` / `/mcp`), NOT the
  # bare .mcp.json key — the bare key resolves to "MCP server not connected".
  run jq -r '.hooks.PreToolUse[0].hooks[0].server' "$PLUGIN/hooks/hooks.json"
  [ "$output" = "plugin:claude-code-knowledge:claude-code-knowledge-hooks" ]
  run jq -r '.hooks.PreToolUse[0].hooks[0].tool' "$PLUGIN/hooks/hooks.json"
  [ "$output" = "reroute_guide" ]
}

@test ".mcp.json registers the hooks server pointing at mcp/server.mjs" {
  run jq empty "$PLUGIN/.mcp.json"
  [ "$status" -eq 0 ]
  run jq -r '.mcpServers["claude-code-knowledge-hooks"].command' "$PLUGIN/.mcp.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *"mcp/server.mjs" ]] || [[ "$output" == *"bin/mjs-launch.sh" ]]
}

@test ".mcp.json launches the hooks server via the mjs-launch.sh wrapper" {
  run jq -e '.mcpServers["claude-code-knowledge-hooks"] | (.command | endswith("bin/mjs-launch.sh")) and (.args[0] | endswith("mcp/server.mjs"))' "$PLUGIN/.mcp.json"
  [ "$status" -eq 0 ]
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

# --- cc-review orchestrator skill ---

@test "cc-review SKILL.md exists" {
  [ -f "$PLUGIN/skills/cc-review/SKILL.md" ]
}

@test "cc-review SKILL.md has name and argument-hint frontmatter" {
  run grep -E '^name:[[:space:]]*cc-review' "$PLUGIN/skills/cc-review/SKILL.md"
  [ "$status" -eq 0 ]
  run grep -E '^argument-hint:' "$PLUGIN/skills/cc-review/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-review runs inline (NOT context: fork — needs Agent + Edit/Write)" {
  run grep -E '^context:[[:space:]]*fork' "$PLUGIN/skills/cc-review/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "cc-review dispatches the cc-reviewer agent" {
  run grep -F 'cc-reviewer' "$PLUGIN/skills/cc-review/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-review gates application through AskUserQuestion" {
  run grep -F 'AskUserQuestion' "$PLUGIN/skills/cc-review/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-review detection is runtime Bash, not a load-time !-injection" {
  # The skill must not carry a `!`+backtick dynamic-context trigger (would run at
  # load, before the target is resolved). Detection is a model-run bash block.
  run grep -nE '!`' "$PLUGIN/skills/cc-review/SKILL.md"
  [ "$status" -ne 0 ]
}

# --- cc-author-planner agent (read-only authoring planner) ---

@test "cc-author-planner agent has name and description" {
  run grep -E '^name:[[:space:]]*cc-author-planner' "$PLUGIN/agents/cc-author-planner.md"
  [ "$status" -eq 0 ]
  run grep -E '^description:' "$PLUGIN/agents/cc-author-planner.md"
  [ "$status" -eq 0 ]
}

@test "cc-author-planner declares model haiku and cc-reference tools (Skill, Read, Grep)" {
  run grep -E '^model:[[:space:]]*haiku' "$PLUGIN/agents/cc-author-planner.md"
  [ "$status" -eq 0 ]
  for tool in Skill Read Grep; do
    run grep -E "^tools:.*$tool" "$PLUGIN/agents/cc-author-planner.md"
    [ "$status" -eq 0 ]
  done
}

@test "cc-author-planner has no write or Bash tools" {
  run grep -E '^tools:.*(Write|Edit|NotebookEdit|Bash)' "$PLUGIN/agents/cc-author-planner.md"
  [ "$status" -ne 0 ]
}

@test "cc-author-planner is cc-reference-only and never invents from training memory" {
  run grep -F 'cc-reference' "$PLUGIN/agents/cc-author-planner.md"
  [ "$status" -eq 0 ]
  run grep -iE 'never.*training memory|not.*training memory' "$PLUGIN/agents/cc-author-planner.md"
  [ "$status" -eq 0 ]
}

@test "cc-author-planner documents the structured output contract (files + uncovered)" {
  run grep -F 'full_content' "$PLUGIN/agents/cc-author-planner.md"
  [ "$status" -eq 0 ]
  run grep -F 'uncovered' "$PLUGIN/agents/cc-author-planner.md"
  [ "$status" -eq 0 ]
}

# --- cc-author orchestrator skill ---

@test "cc-author SKILL.md exists" {
  [ -f "$PLUGIN/skills/cc-author/SKILL.md" ]
}

@test "cc-author SKILL.md has name and argument-hint frontmatter" {
  run grep -E '^name:[[:space:]]*cc-author' "$PLUGIN/skills/cc-author/SKILL.md"
  [ "$status" -eq 0 ]
  run grep -E '^argument-hint:' "$PLUGIN/skills/cc-author/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-author runs inline (NOT context: fork — needs Agent + Write)" {
  run grep -E '^context:[[:space:]]*fork' "$PLUGIN/skills/cc-author/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "cc-author allowed-tools include Agent, Write, AskUserQuestion" {
  for tool in Agent Write AskUserQuestion; do
    run grep -E "^allowed-tools:.*$tool" "$PLUGIN/skills/cc-author/SKILL.md"
    [ "$status" -eq 0 ]
  done
}

@test "cc-author dispatches the cc-author-planner agent" {
  run grep -F 'cc-author-planner' "$PLUGIN/skills/cc-author/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-author surfaces uncovered points and gates via AskUserQuestion" {
  run grep -F 'uncovered' "$PLUGIN/skills/cc-author/SKILL.md"
  [ "$status" -eq 0 ]
  run grep -F 'AskUserQuestion' "$PLUGIN/skills/cc-author/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-author is model-invocable (no disable-model-invocation)" {
  run grep -E '^disable-model-invocation:[[:space:]]*true' "$PLUGIN/skills/cc-author/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "cc-author has no load-time !-injection trigger" {
  run grep -nE '!`' "$PLUGIN/skills/cc-author/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "cc-author is cc-reference-grounded" {
  run grep -F 'cc-reference' "$PLUGIN/skills/cc-author/SKILL.md"
  [ "$status" -eq 0 ]
}

# --- cc-memory orchestrator skill ---

@test "cc-memory SKILL.md exists" {
  [ -f "$PLUGIN/skills/cc-memory/SKILL.md" ]
}

@test "cc-memory SKILL.md has name and argument-hint frontmatter" {
  run grep -E '^name:[[:space:]]*cc-memory' "$PLUGIN/skills/cc-memory/SKILL.md"
  [ "$status" -eq 0 ]
  run grep -E '^argument-hint:' "$PLUGIN/skills/cc-memory/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-memory runs inline (NOT context: fork)" {
  run grep -E '^context:[[:space:]]*fork' "$PLUGIN/skills/cc-memory/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "cc-memory reuses cc-reviewer with component_type memory" {
  run grep -F 'cc-reviewer' "$PLUGIN/skills/cc-memory/SKILL.md"
  [ "$status" -eq 0 ]
  run grep -E 'component_type:[[:space:]]*memory' "$PLUGIN/skills/cc-memory/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-memory gates application through AskUserQuestion" {
  run grep -F 'AskUserQuestion' "$PLUGIN/skills/cc-memory/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-memory discovery is runtime Bash, not load-time !-injection" {
  run grep -nE '!`' "$PLUGIN/skills/cc-memory/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "cc-memory is model-invocable (no disable-model-invocation)" {
  run grep -E '^disable-model-invocation:[[:space:]]*true' "$PLUGIN/skills/cc-memory/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "cc-memory is cc-reference-grounded" {
  run grep -F 'cc-reference' "$PLUGIN/skills/cc-memory/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-memory dispatch prompt asks reviewer for leanness/split findings" {
  local f="$PLUGIN/skills/cc-memory/SKILL.md"
  run grep -F 'leanness' "$f";            [ "$status" -eq 0 ]
  run grep -F 'splittab' "$f";            [ "$status" -eq 0 ]
  run grep -F '.claude/rules/' "$f";      [ "$status" -eq 0 ]
  run grep -E '\bpaths:' "$f";            [ "$status" -eq 0 ]
  run grep -F 'uncovered: false' "$f";    [ "$status" -eq 0 ]
  run grep -iF 'never `high`' "$f";       [ "$status" -eq 0 ]
}

@test "cc-memory report has claude-md-improver-style summary + per-file blocks" {
  local f="$PLUGIN/skills/cc-memory/SKILL.md"
  run grep -F '### Summary' "$f";                  [ "$status" -eq 0 ]
  run grep -F 'Recommended actions' "$f";          [ "$status" -eq 0 ]
  run grep -iF 'files needing update' "$f";        [ "$status" -eq 0 ]
}

@test "cc-memory default scope discovers CLAUDE.md and .claude/rules files" {
  local f="$PLUGIN/skills/cc-memory/SKILL.md"
  run grep -F "name CLAUDE.md -o -path '*/.claude/rules/*.md'" "$f"; [ "$status" -eq 0 ]
  run grep -F '.claude/rules/*.md' "$f";                            [ "$status" -eq 0 ]
}

@test "plugin.json description mentions the authoring capability" {
  run jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *"author"* ]]
}

# --- cc-reference-validator agent (read-only contradiction validator) ---

@test "cc-reference-validator agent exists and is read-only" {
  agent="$REPO_ROOT/.claude/agents/cc-reference-validator.md"
  [ -f "$agent" ]
  grep -Eq "^name: cc-reference-validator$" "$agent"
  grep -Eq "^tools:.*WebFetch" "$agent"
  grep -Eq "^tools:.*Read" "$agent"
  ! grep -Eq "^tools:.*(Write|Edit)" "$agent"
}

@test "cc-reference-validator encodes the adversarial verdict discipline" {
  agent="$REPO_ROOT/.claude/agents/cc-reference-validator.md"
  grep -qi "verbatim" "$agent"
  grep -q "CONFIRMED" "$agent"
  grep -q "REJECTED" "$agent"
  grep -q "UNVERIFIABLE" "$agent"
}

@test "cc-reference-validator consults the advisor on difficult decisions when one is available" {
  agent="$REPO_ROOT/.claude/agents/cc-reference-validator.md"
  grep -qi "advisor" "$agent"
  grep -qi "available" "$agent"
}

# --- update-cc-references contradiction-validation gate ---

@test "update-cc-references skill has the contradiction-validation gate" {
  grep -qi "Contradiction-validation gate" "$MAINT"
  grep -q "cc-reference-validator" "$MAINT"
  grep -qi "git diff HEAD" "$MAINT"
  grep -q "UNVERIFIABLE" "$MAINT"
}

@test "update-cc-references Release is gated on the contradiction gate" {
  grep -qi "zero unconfirmed contradictions" "$MAINT"
}

# --- mjs-launch.sh wrapper ---

@test "mjs-launch.sh is executable and passes bash -n" {
  [ -x "$PLUGIN/bin/mjs-launch.sh" ]
  run bash -n "$PLUGIN/bin/mjs-launch.sh"
  [ "$status" -eq 0 ]
}

@test "mjs-launch.sh runs the script under bun when bun is present" {
  tmp="$BATS_TEST_TMPDIR/bunhome"; mkdir -p "$tmp/.bun/bin"
  cat > "$tmp/.bun/bin/bun" <<'EOF'
#!/usr/bin/env bash
echo "BUN_RAN $*"
EOF
  chmod +x "$tmp/.bun/bin/bun"
  run env -i HOME="$tmp" PATH="/usr/bin:/bin" bash "$PLUGIN/bin/mjs-launch.sh" /x/server.mjs --flag
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "BUN_RAN /x/server.mjs --flag"
}

@test "mjs-launch.sh falls back to node when bun is absent" {
  nodedir="$(dirname "$(command -v node)")"
  script="$BATS_TEST_TMPDIR/which.mjs"
  printf 'process.stdout.write(process.versions.bun ? "RUNTIME_BUN" : "RUNTIME_NODE");\n' > "$script"
  run env -i HOME="$BATS_TEST_TMPDIR/nohome" PATH="$nodedir:/usr/bin:/bin" bash "$PLUGIN/bin/mjs-launch.sh" "$script"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "RUNTIME_NODE"
}

@test "mjs-launch.sh exits 1 when neither bun nor node is available" {
  emptybin="$BATS_TEST_TMPDIR/empty"; mkdir -p "$emptybin"
  ln -sf "$(command -v bash)" "$emptybin/bash"
  run env -i HOME="$BATS_TEST_TMPDIR/nohome" PATH="$emptybin" bash "$PLUGIN/bin/mjs-launch.sh" /x/server.mjs
  [ "$status" -eq 1 ]
}

@test "mjs-launch.sh exits 64 when no script argument is given" {
  run env -i HOME="$BATS_TEST_TMPDIR/nohome" PATH="/usr/bin:/bin" bash "$PLUGIN/bin/mjs-launch.sh"
  [ "$status" -eq 64 ]
}

# --- cc-compress script (scripts/compress.mjs) ---
# Hermetic: stubs `claude` as an isolated-PATH Node executable. No network.

compress_script() {
  printf '%s' "$PLUGIN/skills/cc-compress/scripts/compress.mjs"
}

# A stub `claude` that validates it was called with `--print --model sonnet`,
# then echoes back everything after the last "TEXT:\n" marker in the prompt
# plus a trailing HTML-comment marker — a trivial, structure-preserving
# "compression" that satisfies every validator (headings/code-blocks/URLs/
# paths/bullets/inline-code all unchanged) while still differing from the
# input, so the compress_file() identical-output guard doesn't fire.
install_passthrough_claude_stub() {
  STUB_DIR="$BATS_TEST_TMPDIR/stub_passthrough"
  mkdir -p "$STUB_DIR"
  cat > "$STUB_DIR/claude" <<'STUBEOF'
#!/usr/bin/env node
const args = process.argv.slice(2);
if (!args.includes('--print') || !args.includes('--model') || !args.includes('sonnet')) {
  console.error('bad args: ' + args.join(' '));
  process.exit(9);
}
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const marker = 'TEXT:\n';
  const idx = input.lastIndexOf(marker);
  const body = idx === -1 ? input : input.slice(idx + marker.length);
  process.stdout.write(body + '\n\n<!-- compressed -->');
});
STUBEOF
  chmod +x "$STUB_DIR/claude"
}

# A stub `claude` that returns a fixed BROKEN output (drops a code block) on
# its first invocation and a fixed FIXED output on every invocation after,
# tracked via a counter file — simulates the initial-compress-then-fix retry
# path deterministically. Outputs are written to separate files (not
# interpolated into the generated .mjs source) so arbitrary multi-line content
# — including backticks — never needs shell-to-JS string escaping.
install_retry_claude_stub() {
  # $1 = broken output, $2 = fixed output, $3 = counter file path
  STUB_DIR="$BATS_TEST_TMPDIR/stub_retry"
  mkdir -p "$STUB_DIR"
  printf '%s' "$1" > "$STUB_DIR/output1.md"
  printf '%s' "$2" > "$STUB_DIR/output2.md"
  cat > "$STUB_DIR/claude" <<STUBEOF
#!/usr/bin/env node
// Extensionless file run via the shebang defaults to CommonJS — use require(),
// not import, or this is a SyntaxError on Node <22.7.
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const args = process.argv.slice(2);
if (!args.includes('--print') || !args.includes('--model') || !args.includes('sonnet')) {
  console.error('bad args: ' + args.join(' '));
  process.exit(9);
}
process.stdin.resume();
process.stdin.on('end', () => {
  const counterFile = '$3';
  const stubDir = '$STUB_DIR';
  let n = existsSync(counterFile) ? parseInt(readFileSync(counterFile, 'utf8'), 10) : 0;
  n += 1;
  writeFileSync(counterFile, String(n));
  const outFile = n === 1 ? stubDir + '/output1.md' : stubDir + '/output2.md';
  process.stdout.write(readFileSync(outFile, 'utf8'));
});
STUBEOF
  chmod +x "$STUB_DIR/claude"
}

@test "compress.mjs exists, is executable, passes node --check" {
  local s; s="$(compress_script)"
  [ -x "$s" ]
  run node --check "$s"
  [ "$status" -eq 0 ]
}

@test "compress.mjs: no args prints usage and exits 1" {
  run node "$(compress_script)"
  [ "$status" -eq 1 ]
  echo "$output" | grep -qi usage
}

@test "compress.mjs: one arg prints usage and exits 1" {
  run node "$(compress_script)" "$BATS_TEST_TMPDIR/x.md"
  [ "$status" -eq 1 ]
}

@test "compress.mjs: non-.md target is skipped with exit 0, no backup written" {
  local src="$BATS_TEST_TMPDIR/notes.txt"
  echo "hello" > "$src"
  local backup_root="$BATS_TEST_TMPDIR/backups_skip"
  run node "$(compress_script)" "$src" "$backup_root"
  [ "$status" -eq 0 ]
  [ ! -d "$backup_root" ]
}

@test "compress.mjs: sensitive filename is refused without spawning claude" {
  STUB_DIR="$BATS_TEST_TMPDIR/stub_should_not_run"
  mkdir -p "$STUB_DIR"
  local marker="$BATS_TEST_TMPDIR/claude_was_invoked"
  printf '#!/usr/bin/env bash\ntouch %q; exit 99\n' "$marker" > "$STUB_DIR/claude"
  chmod +x "$STUB_DIR/claude"
  local src="$BATS_TEST_TMPDIR/secrets.md"
  printf 'some content that is long enough to pass the empty check\n' > "$src"
  local backup_root="$BATS_TEST_TMPDIR/backups_sensitive"
  run env PATH="$STUB_DIR:$PATH" node "$(compress_script)" "$src" "$backup_root"
  [ "$status" -eq 1 ]
  echo "$output" | grep -qi sensitive
  grep -q "some content that is long enough" "$src"
  [ ! -f "$marker" ]
}

@test "compress.mjs: claude missing from PATH leaves source untouched with a clear error" {
  local src="$BATS_TEST_TMPDIR/plain.md"
  printf '# Title\n\nSome prose sentence long enough to compress.\n' > "$src"
  cp "$src" "$BATS_TEST_TMPDIR/plain.md.orig"
  local backup_root="$BATS_TEST_TMPDIR/backups_noclaude"
  # Isolate PATH to a dir containing ONLY a symlink to the real `node` binary
  # — guarantees `claude` is unresolvable regardless of whether this machine
  # happens to install node and claude in the same or different bin dirs.
  local isolated="$BATS_TEST_TMPDIR/node_only_bin"
  mkdir -p "$isolated"
  ln -s "$(command -v node)" "$isolated/node"
  run env PATH="$isolated" node "$(compress_script)" "$src" "$backup_root"
  [ "$status" -eq 1 ]
  diff "$src" "$BATS_TEST_TMPDIR/plain.md.orig"
}

@test "compress.mjs: successful compression writes compressed file + backup" {
  install_passthrough_claude_stub
  mkdir -p "$BATS_TEST_TMPDIR/proj"
  local src="$BATS_TEST_TMPDIR/proj/notes.md"
  printf '# Title\n\nThis is a long enough sentence to compress.\n' > "$src"
  local backup_root="$BATS_TEST_TMPDIR/backups_ok"
  run env PATH="$STUB_DIR:$PATH" node "$(compress_script)" "$src" "$backup_root"
  [ "$status" -eq 0 ]
  grep -q '<!-- compressed -->' "$src"
  grep -q '# Title' "$src"
  local backup="$backup_root/proj/notes.original.md"
  [ -f "$backup" ]
  grep -q 'This is a long enough sentence to compress.' "$backup"
}

@test "compress.mjs: existing backup aborts to prevent data loss" {
  install_passthrough_claude_stub
  mkdir -p "$BATS_TEST_TMPDIR/proj2"
  local src="$BATS_TEST_TMPDIR/proj2/notes.md"
  printf '# Title\n\nThis is a long enough sentence to compress.\n' > "$src"
  local backup_root="$BATS_TEST_TMPDIR/backups_exists"
  mkdir -p "$backup_root/proj2"
  echo "pre-existing backup" > "$backup_root/proj2/notes.original.md"
  run env PATH="$STUB_DIR:$PATH" node "$(compress_script)" "$src" "$backup_root"
  [ "$status" -eq 1 ]
  echo "$output" | grep -qi "already exists"
  grep -q '# Title' "$src"
}

@test "compress.mjs: YAML frontmatter round-trips verbatim" {
  install_passthrough_claude_stub
  mkdir -p "$BATS_TEST_TMPDIR/proj3"
  local src="$BATS_TEST_TMPDIR/proj3/notes.md"
  cat > "$src" <<'MDEOF'
---
name: test
type: memory
---
# Title

This is a long enough sentence to compress.
MDEOF
  local backup_root="$BATS_TEST_TMPDIR/backups_fm"
  run env PATH="$STUB_DIR:$PATH" node "$(compress_script)" "$src" "$backup_root"
  [ "$status" -eq 0 ]
  run head -n4 "$src"
  [ "$output" = "$(printf -- '---\nname: test\ntype: memory\n---')" ]
}

@test "compress.mjs: nested fenced code block survives validation" {
  install_passthrough_claude_stub
  mkdir -p "$BATS_TEST_TMPDIR/proj4"
  local src="$BATS_TEST_TMPDIR/proj4/notes.md"
  cat > "$src" <<'MDEOF'
# Title

````text
some outer content
```inner marker```
more outer
````

A sentence long enough to compress here.
MDEOF
  local backup_root="$BATS_TEST_TMPDIR/backups_nest"
  run env PATH="$STUB_DIR:$PATH" node "$(compress_script)" "$src" "$backup_root"
  [ "$status" -eq 0 ]
  grep -q '````text' "$src"
  grep -q 'inner marker' "$src"
}

@test "compress.mjs: multiple URLs preserved" {
  install_passthrough_claude_stub
  mkdir -p "$BATS_TEST_TMPDIR/proj5"
  local src="$BATS_TEST_TMPDIR/proj5/notes.md"
  printf '# Title\n\nSee https://example.com/a and https://example.com/b for a long enough sentence.\n' > "$src"
  local backup_root="$BATS_TEST_TMPDIR/backups_urls"
  run env PATH="$STUB_DIR:$PATH" node "$(compress_script)" "$src" "$backup_root"
  [ "$status" -eq 0 ]
  grep -q 'https://example.com/a' "$src"
  grep -q 'https://example.com/b' "$src"
}

@test "compress.mjs: retries with a targeted fix and succeeds on retry 2" {
  local counter="$BATS_TEST_TMPDIR/retry_counter_ok"
  install_retry_claude_stub \
    $'# Title\n\nBroken compression, code block dropped.' \
    $'# Title\n\n```bash\necho hi\n```\n\nFixed compression.' \
    "$counter"
  mkdir -p "$BATS_TEST_TMPDIR/proj6"
  local src="$BATS_TEST_TMPDIR/proj6/notes.md"
  cat > "$src" <<'MDEOF'
# Title

```bash
echo hi
```

A sentence long enough to compress here.
MDEOF
  local backup_root="$BATS_TEST_TMPDIR/backups_retry_ok"
  run env PATH="$STUB_DIR:$PATH" node "$(compress_script)" "$src" "$backup_root"
  [ "$status" -eq 0 ]
  grep -q 'Fixed compression' "$src"
  [ "$(cat "$counter")" = "2" ]
}

@test "compress.mjs: retries when a URL is dropped, succeeds after the fix" {
  # Covers the URL validator's rejection path specifically (the other retry
  # tests exercise the code-block validator) — different failure mode, same
  # retry-then-succeed mechanics.
  local counter="$BATS_TEST_TMPDIR/retry_counter_url"
  install_retry_claude_stub \
    $'# Title\n\nSee docs for a sentence long enough to compress.' \
    $'# Title\n\nSee https://example.com/docs for a fixed sentence.' \
    "$counter"
  mkdir -p "$BATS_TEST_TMPDIR/proj8"
  local src="$BATS_TEST_TMPDIR/proj8/notes.md"
  printf '# Title\n\nSee https://example.com/docs for a sentence long enough to compress here.\n' > "$src"
  local backup_root="$BATS_TEST_TMPDIR/backups_retry_url"
  run env PATH="$STUB_DIR:$PATH" node "$(compress_script)" "$src" "$backup_root"
  [ "$status" -eq 0 ]
  grep -q 'https://example.com/docs' "$src"
  [ "$(cat "$counter")" = "2" ]
}

@test "compress.mjs: exhausts retries, restores original, removes backup" {
  local counter="$BATS_TEST_TMPDIR/retry_counter_fail"
  install_retry_claude_stub \
    $'# Title\n\nBroken compression, code block dropped.' \
    $'# Title\n\nStill broken, code block still dropped.' \
    "$counter"
  mkdir -p "$BATS_TEST_TMPDIR/proj7"
  local src="$BATS_TEST_TMPDIR/proj7/notes.md"
  cat > "$src" <<'MDEOF'
# Title

```bash
echo hi
```

A sentence long enough to compress here.
MDEOF
  cp "$src" "$BATS_TEST_TMPDIR/proj7/notes.md.orig"
  local backup_root="$BATS_TEST_TMPDIR/backups_retry_fail"
  run env PATH="$STUB_DIR:$PATH" node "$(compress_script)" "$src" "$backup_root"
  [ "$status" -eq 2 ]
  diff "$src" "$BATS_TEST_TMPDIR/proj7/notes.md.orig"
  [ ! -f "$backup_root/proj7/notes.original.md" ]
}

# --- cc-compress orchestrator skill ---

@test "cc-compress SKILL.md exists" {
  [ -f "$PLUGIN/skills/cc-compress/SKILL.md" ]
}

@test "cc-compress SKILL.md has name, description, argument-hint frontmatter" {
  local f="$PLUGIN/skills/cc-compress/SKILL.md"
  run grep -E '^name:[[:space:]]*cc-compress' "$f"; [ "$status" -eq 0 ]
  run grep -E '^description:' "$f";                  [ "$status" -eq 0 ]
  run grep -E '^argument-hint:' "$f";                 [ "$status" -eq 0 ]
}

@test "cc-compress is model-invocable (no disable-model-invocation)" {
  run grep -E '^disable-model-invocation:[[:space:]]*true' "$PLUGIN/skills/cc-compress/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "cc-compress has no load-time !-injection trigger" {
  run grep -nE '!`' "$PLUGIN/skills/cc-compress/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "cc-compress references its bundled script via CLAUDE_SKILL_DIR" {
  run grep -F '${CLAUDE_SKILL_DIR}/scripts/compress.mjs' "$PLUGIN/skills/cc-compress/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-compress gates non-recoverable targets through AskUserQuestion" {
  local f="$PLUGIN/skills/cc-compress/SKILL.md"
  run grep -F 'AskUserQuestion' "$f"; [ "$status" -eq 0 ]
  run grep -iF 'git' "$f";            [ "$status" -eq 0 ]
}

@test "cc-compress documents the session-temp backup resolution" {
  run grep -iE 'scratchpad|mktemp' "$PLUGIN/skills/cc-compress/SKILL.md"
  [ "$status" -eq 0 ]
}
