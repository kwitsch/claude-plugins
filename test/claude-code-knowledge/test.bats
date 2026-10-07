#!/usr/bin/env bats
# Structural suite for the claude-code-knowledge plugin (cc-reference shape).
# Hermetic: no network. The cc-compress script tests stub `claude` as a
# make_stub bash executable on an isolated PATH (env -i) — never the real CLI.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/claude-code-knowledge"
  SKILL="$PLUGIN/skills/cc-reference"
  REFS="$SKILL/references"
  MARKET="$REPO_ROOT/.claude-plugin/marketplace.json"
  MAINT="$REPO_ROOT/.claude/skills/update-cc-references/SKILL.md"

  # Isolated PATH for the cc-compress script tests: `node` (to run compress.mjs),
  # `bash`/`cat` (make_stub's `#!/usr/bin/env bash` stubs need both to actually
  # run their shebang and body), `git` (compress.mjs's own recoverability
  # check). No `claude` unless a test adds one.
  MOCKBIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$MOCKBIN"
  for t in node bash cat git; do
    src="$(command -v "$t")" && [ -n "$src" ] && ln -s "$src" "$MOCKBIN/$t"
  done

  # Isolated HOME so no test reads real user config.
  HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME"
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

# make_stub <name> <body-line>... — drop an executable bash stub into MOCKBIN.
make_stub() {
  local name="$1"; shift
  rm -f "$MOCKBIN/$name"
  { printf '#!/usr/bin/env bash\n'; printf '%s\n' "$@"; } > "$MOCKBIN/$name"
  chmod +x "$MOCKBIN/$name"
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
  run rg_or_grep -E '^name:[[:space:]]*cc-reference' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E '^description:' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-reference SKILL.md allowed-tools includes Read, Grep, and WebFetch fallback" {
  run rg_or_grep -E '^allowed-tools:.*Read' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E '^allowed-tools:.*Grep' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E '^allowed-tools:.*WebFetch' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-reference SKILL.md documents a live-doc fallback" {
  run rg_or_grep -iE 'Live-doc|WebFetch' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-reference SKILL.md is model-invocable (no disable-model-invocation)" {
  run rg_or_grep -E '^disable-model-invocation:[[:space:]]*true' "$SKILL/SKILL.md"
  [ "$status" -ne 0 ]
}

# --- Reference files ---

@test "all reference files exist and are non-empty" {
  for f in claude-code-skills-reference.md claude-code-agents-reference.md \
           claude-code-hooks-reference.md hook-handler-selection.md \
           claude-code-mcp-tool-hooks-reference.md \
           claude-code-commands-reference.md claude-code-mcp-reference.md \
           claude-code-mcp-managed-reference.md \
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
           claude-code-mcp-managed-reference.md \
           claude-code-plugins-reference.md claude-code-memory-reference.md \
           claude-code-settings-reference.md; do
    run rg_or_grep -cE '^## ' "$REFS/$f"
    [ "$status" -eq 0 ]
    [ "$output" -ge 1 ]
  done
}

@test "each reference file header carries a verified date" {
  for f in claude-code-skills-reference.md claude-code-agents-reference.md \
           claude-code-hooks-reference.md hook-handler-selection.md \
           claude-code-mcp-tool-hooks-reference.md \
           claude-code-commands-reference.md claude-code-mcp-reference.md \
           claude-code-mcp-managed-reference.md \
           claude-code-plugins-reference.md claude-code-memory-reference.md \
           claude-code-settings-reference.md; do
    run rg_or_grep -iE 'verified' "$REFS/$f"
    [ "$status" -eq 0 ]
  done
}

@test "SKILL.md routing/section index names each reference file" {
  for f in claude-code-skills-reference.md claude-code-agents-reference.md \
           claude-code-hooks-reference.md hook-handler-selection.md \
           claude-code-mcp-tool-hooks-reference.md \
           claude-code-commands-reference.md claude-code-mcp-reference.md \
           claude-code-mcp-managed-reference.md \
           claude-code-plugins-reference.md claude-code-memory-reference.md \
           claude-code-settings-reference.md; do
    run rg_or_grep -F "$f" "$SKILL/SKILL.md"
    [ "$status" -eq 0 ]
  done
}

@test "cc-reference SKILL.md has no executable !-injection trigger" {
  # `!` immediately followed by a backtick is Claude Code's dynamic-context
  # injection trigger — it RUNS at skill load. SKILL.md must never contain it
  # (it would execute, e.g. `cmd: command not found`). Such examples belong only
  # in the reference files, which are Read on demand and never preprocessed.
  run rg_or_grep -nE '!`' "$SKILL/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "reference files live in the references/ subfolder, not the skill root" {
  [ -d "$REFS" ]
  # only SKILL.md may sit at the skill root; every other *.md lives under references/
  run bash -c 'ls "$1"/*.md 2>/dev/null | rg_or_grep -v "/SKILL.md$" || true' _ "$SKILL"
  [ -z "$output" ]
}

@test "SKILL.md points reference paths at the references/ subfolder" {
  run rg_or_grep -E '\$\{CLAUDE_SKILL_DIR\}/references/claude-code-skills-reference.md' "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "mcp-tool-hooks reference documents the plugin server-name namespacing gotcha" {
  [ -s "$REFS/claude-code-mcp-tool-hooks-reference.md" ]
  run rg_or_grep -F 'plugin:<plugin-name>:<server-key>' "$REFS/claude-code-mcp-tool-hooks-reference.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -iE 'not connected' "$REFS/claude-code-mcp-tool-hooks-reference.md"
  [ "$status" -eq 0 ]
}

@test "skill-folder-structure convention file exists and documents the references/ rule" {
  [ -s "$REFS/skill-folder-structure.md" ]
  run rg_or_grep -cE '^## ' "$REFS/skill-folder-structure.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
  run rg_or_grep -F 'references/' "$REFS/skill-folder-structure.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F "skill-folder-structure.md" "$SKILL/SKILL.md"
  [ "$status" -eq 0 ]
}

# --- Maintenance skill (repo-root project skill; cross-tree coupling is intentional) ---

@test "update-cc-references maintenance skill exists" {
  [ -f "$MAINT" ]
}

@test "update-cc-references is user-only (disable-model-invocation: true)" {
  run rg_or_grep -E '^disable-model-invocation:[[:space:]]*true' "$MAINT"
  [ "$status" -eq 0 ]
}

@test "update-cc-references allowed-tools include fetch + edit + release tools" {
  for tool in Workflow Read Edit Write Glob Bash Skill; do
    run rg_or_grep -E "^allowed-tools:.*$tool" "$MAINT"
    [ "$status" -eq 0 ]
  done
}

@test "update-cc-references never falls back to WebFetch for content" {
  run rg_or_grep -E "^allowed-tools:" "$MAINT"
  [ "$status" -eq 0 ]
  [[ "$output" != *"WebFetch"* ]]
  run rg_or_grep -qi "curl" "$MAINT"
  [ "$status" -eq 0 ]
}

@test "cc-reference-validator is local-path-only, no WebFetch fallback" {
  agent="$REPO_ROOT/.claude/agents/cc-reference-validator.md"
  rg_or_grep -qi "local file path" "$agent"
  ! rg_or_grep -Eq "^tools:.*WebFetch" "$agent"
  ! rg_or_grep -qi "WebFetch" "$agent"
}

@test "update-cc-references covers the new targets and files" {
  run rg_or_grep -E '^argument-hint:' "$MAINT"
  [ "$status" -eq 0 ]
  for tok in commands mcp plugins memory settings; do
    printf '%s\n' "$output" | rg_or_grep -q "$tok"
  done
  for f in claude-code-commands-reference.md claude-code-mcp-reference.md \
           claude-code-mcp-managed-reference.md \
           claude-code-plugins-reference.md claude-code-memory-reference.md \
           claude-code-settings-reference.md; do
    run rg_or_grep -F "$f" "$MAINT"
    [ "$status" -eq 0 ]
  done
}

@test "update-cc-references release does a patch bump and stamps the ingestion date" {
  run rg_or_grep -iE 'Patch version bump' "$MAINT"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'CC docs read:' "$MAINT"
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
  run rg_or_grep -E '^name:[[:space:]]*claude-code-expert' "$PLUGIN/agents/claude-code-expert.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E '^description:' "$PLUGIN/agents/claude-code-expert.md"
  [ "$status" -eq 0 ]
}

@test "claude-code-expert declares a model and cc-reference tools (Skill, Read, Grep)" {
  run rg_or_grep -E '^model:' "$PLUGIN/agents/claude-code-expert.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E '^tools:.*Skill' "$PLUGIN/agents/claude-code-expert.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E '^tools:.*Read' "$PLUGIN/agents/claude-code-expert.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E '^tools:.*Grep' "$PLUGIN/agents/claude-code-expert.md"
  [ "$status" -eq 0 ]
}

@test "claude-code-expert has no write or Bash tools" {
  run rg_or_grep -E '^tools:.*(Write|Edit|NotebookEdit|Bash)' "$PLUGIN/agents/claude-code-expert.md"
  [ "$status" -ne 0 ]
}

# --- cc-reviewer agent (parameterized read-only reviewer) ---

@test "cc-reviewer agent has name and description" {
  run rg_or_grep -E '^name:[[:space:]]*cc-reviewer' "$PLUGIN/agents/cc-reviewer.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E '^description:' "$PLUGIN/agents/cc-reviewer.md"
  [ "$status" -eq 0 ]
}

@test "cc-reviewer declares model haiku and cc-reference tools (Skill, Read, Grep, Glob)" {
  run rg_or_grep -E '^model:[[:space:]]*haiku' "$PLUGIN/agents/cc-reviewer.md"
  [ "$status" -eq 0 ]
  for tool in Skill Read Grep Glob; do
    run rg_or_grep -E "^tools:.*$tool" "$PLUGIN/agents/cc-reviewer.md"
    [ "$status" -eq 0 ]
  done
}

@test "cc-reviewer has no write or Bash tools" {
  run rg_or_grep -E '^tools:.*(Write|Edit|NotebookEdit|Bash)' "$PLUGIN/agents/cc-reviewer.md"
  [ "$status" -ne 0 ]
}

@test "cc-reviewer is cc-reference-only and never answers from training memory" {
  run rg_or_grep -F 'cc-reference' "$PLUGIN/agents/cc-reviewer.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -iE 'never.*training memory|not.*training memory' "$PLUGIN/agents/cc-reviewer.md"
  [ "$status" -eq 0 ]
}

@test "cc-reviewer documents the structured findings output contract" {
  run rg_or_grep -iE 'suggested_fix' "$PLUGIN/agents/cc-reviewer.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -iE 'severity' "$PLUGIN/agents/cc-reviewer.md"
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
  run rg_or_grep -E '^name:[[:space:]]*cc-review' "$PLUGIN/skills/cc-review/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E '^argument-hint:' "$PLUGIN/skills/cc-review/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-review runs inline (NOT context: fork — needs Agent + Edit/Write)" {
  run rg_or_grep -E '^context:[[:space:]]*fork' "$PLUGIN/skills/cc-review/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "cc-review dispatches the cc-reviewer agent" {
  run rg_or_grep -F 'cc-reviewer' "$PLUGIN/skills/cc-review/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-review gates application through AskUserQuestion" {
  run rg_or_grep -F 'AskUserQuestion' "$PLUGIN/skills/cc-review/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-review detection is runtime Bash, not a load-time !-injection" {
  # The skill must not carry a `!`+backtick dynamic-context trigger (would run at
  # load, before the target is resolved). Detection is a model-run bash block.
  run rg_or_grep -nE '!`' "$PLUGIN/skills/cc-review/SKILL.md"
  [ "$status" -ne 0 ]
}

# --- cc-author-planner agent (read-only authoring planner) ---

@test "cc-author-planner agent has name and description" {
  run rg_or_grep -E '^name:[[:space:]]*cc-author-planner' "$PLUGIN/agents/cc-author-planner.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E '^description:' "$PLUGIN/agents/cc-author-planner.md"
  [ "$status" -eq 0 ]
}

@test "cc-author-planner declares model haiku and cc-reference tools (Skill, Read, Grep)" {
  run rg_or_grep -E '^model:[[:space:]]*haiku' "$PLUGIN/agents/cc-author-planner.md"
  [ "$status" -eq 0 ]
  for tool in Skill Read Grep; do
    run rg_or_grep -E "^tools:.*$tool" "$PLUGIN/agents/cc-author-planner.md"
    [ "$status" -eq 0 ]
  done
}

@test "cc-author-planner has no write or Bash tools" {
  run rg_or_grep -E '^tools:.*(Write|Edit|NotebookEdit|Bash)' "$PLUGIN/agents/cc-author-planner.md"
  [ "$status" -ne 0 ]
}

@test "cc-author-planner is cc-reference-only and never invents from training memory" {
  run rg_or_grep -F 'cc-reference' "$PLUGIN/agents/cc-author-planner.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -iE 'never.*training memory|not.*training memory' "$PLUGIN/agents/cc-author-planner.md"
  [ "$status" -eq 0 ]
}

@test "cc-author-planner documents the structured output contract (files + uncovered)" {
  run rg_or_grep -F 'full_content' "$PLUGIN/agents/cc-author-planner.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'uncovered' "$PLUGIN/agents/cc-author-planner.md"
  [ "$status" -eq 0 ]
}

# --- cc-author orchestrator skill ---

@test "cc-author SKILL.md exists" {
  [ -f "$PLUGIN/skills/cc-author/SKILL.md" ]
}

@test "cc-author SKILL.md has name and argument-hint frontmatter" {
  run rg_or_grep -E '^name:[[:space:]]*cc-author' "$PLUGIN/skills/cc-author/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E '^argument-hint:' "$PLUGIN/skills/cc-author/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-author runs inline (NOT context: fork — needs Agent + Write)" {
  run rg_or_grep -E '^context:[[:space:]]*fork' "$PLUGIN/skills/cc-author/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "cc-author allowed-tools include Agent, Write, AskUserQuestion" {
  for tool in Agent Write AskUserQuestion; do
    run rg_or_grep -E "^allowed-tools:.*$tool" "$PLUGIN/skills/cc-author/SKILL.md"
    [ "$status" -eq 0 ]
  done
}

@test "cc-author dispatches the cc-author-planner agent" {
  run rg_or_grep -F 'cc-author-planner' "$PLUGIN/skills/cc-author/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-author surfaces uncovered points and gates via AskUserQuestion" {
  run rg_or_grep -F 'uncovered' "$PLUGIN/skills/cc-author/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -F 'AskUserQuestion' "$PLUGIN/skills/cc-author/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-author is model-invocable (no disable-model-invocation)" {
  run rg_or_grep -E '^disable-model-invocation:[[:space:]]*true' "$PLUGIN/skills/cc-author/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "cc-author has no load-time !-injection trigger" {
  run rg_or_grep -nE '!`' "$PLUGIN/skills/cc-author/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "cc-author is cc-reference-grounded" {
  run rg_or_grep -F 'cc-reference' "$PLUGIN/skills/cc-author/SKILL.md"
  [ "$status" -eq 0 ]
}

# --- memory-audit orchestrator skill ---

@test "memory-audit SKILL.md exists" {
  [ -f "$PLUGIN/skills/memory-audit/SKILL.md" ]
}

@test "memory-audit SKILL.md has name and argument-hint frontmatter" {
  run rg_or_grep -E '^name:[[:space:]]*memory-audit' "$PLUGIN/skills/memory-audit/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E '^argument-hint:' "$PLUGIN/skills/memory-audit/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "memory-audit runs inline (NOT context: fork)" {
  run rg_or_grep -E '^context:[[:space:]]*fork' "$PLUGIN/skills/memory-audit/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "memory-audit reuses cc-reviewer with component_type memory" {
  run rg_or_grep -F 'cc-reviewer' "$PLUGIN/skills/memory-audit/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E 'component_type:[[:space:]]*memory' "$PLUGIN/skills/memory-audit/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "memory-audit SKILL.md points at analysis-workflow.md" {
  run rg_or_grep -F '${CLAUDE_SKILL_DIR}/analysis-workflow.md' "$PLUGIN/skills/memory-audit/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "memory-audit gates application through AskUserQuestion" {
  run rg_or_grep -F 'AskUserQuestion' "$PLUGIN/skills/memory-audit/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "memory-audit discovery is runtime Bash, not load-time !-injection" {
  run rg_or_grep -nE '!`' "$PLUGIN/skills/memory-audit/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "memory-audit is model-invocable (no disable-model-invocation)" {
  run rg_or_grep -E '^disable-model-invocation:[[:space:]]*true' "$PLUGIN/skills/memory-audit/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "memory-audit is cc-reference-grounded" {
  run rg_or_grep -F 'cc-reference' "$PLUGIN/skills/memory-audit/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "memory-audit argument-hint carries --fix" {
  run rg_or_grep -F 'argument-hint: [--fix]' "$PLUGIN/skills/memory-audit/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "memory-audit --fix branch is additive (auto-apply branch coexists with AskUserQuestion)" {
  local f="$PLUGIN/skills/memory-audit/SKILL.md"
  run rg_or_grep -F -- '--fix' "$f";        [ "$status" -eq 0 ]
  run rg_or_grep -F '$FIX' "$f";            [ "$status" -eq 0 ]
  run rg_or_grep -F 'AskUserQuestion' "$f"; [ "$status" -eq 0 ]
}

@test "memory-audit eligibility predicate survives in SKILL.md gate/apply prose" {
  local f="$PLUGIN/skills/memory-audit/SKILL.md"
  run rg_or_grep -F 'uncovered: false' "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -F 'suggested_fix' "$f";    [ "$status" -eq 0 ]
}

@test "memory-audit analysis-workflow.md dispatch prompt asks reviewer for leanness/split findings" {
  local f="$PLUGIN/skills/memory-audit/analysis-workflow.md"
  run rg_or_grep -F 'leanness' "$f";            [ "$status" -eq 0 ]
  run rg_or_grep -F 'splittab' "$f";            [ "$status" -eq 0 ]
  run rg_or_grep -F '.claude/rules/' "$f";      [ "$status" -eq 0 ]
  run rg_or_grep -E '\bpaths:' "$f";            [ "$status" -eq 0 ]
  run rg_or_grep -F 'uncovered: false' "$f";    [ "$status" -eq 0 ]
  run rg_or_grep -iF 'never `high`' "$f";       [ "$status" -eq 0 ]
}

@test "memory-audit report has claude-md-improver-style summary + per-file blocks" {
  local f="$PLUGIN/skills/memory-audit/SKILL.md"
  run rg_or_grep -F '### Summary' "$f";                  [ "$status" -eq 0 ]
  run rg_or_grep -F 'Recommended actions' "$f";          [ "$status" -eq 0 ]
  run rg_or_grep -iF 'files needing update' "$f";        [ "$status" -eq 0 ]
}

@test "memory-audit default scope discovers CLAUDE.md and .claude/rules files" {
  local f="$PLUGIN/skills/memory-audit/SKILL.md"
  run rg_or_grep -F "name CLAUDE.md -o -path '*/.claude/rules/*.md'" "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -F '.claude/rules/*.md' "$f";                            [ "$status" -eq 0 ]
}

@test "plugin.json description mentions the authoring capability" {
  run jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *"author"* ]]
}

# --- memory-audit analysis-workflow (Workflow refactor) ---

@test "memory-audit analysis-workflow.md reference file exists and is non-empty" {
  [ -s "$PLUGIN/skills/memory-audit/analysis-workflow.md" ]
}

@test "memory-audit analysis-workflow.md defines the Workflow script (Analyze + Aggregate phases, schemas, computeGrade backfill)" {
  local f="$PLUGIN/skills/memory-audit/analysis-workflow.md"
  run rg_or_grep -F "phase('Analyze')" "$f";     [ "$status" -eq 0 ]
  run rg_or_grep -F "phase('Aggregate')" "$f";    [ "$status" -eq 0 ]
  run rg_or_grep -F 'FINDINGS_SCHEMA' "$f";       [ "$status" -eq 0 ]
  run rg_or_grep -F 'AGGREGATE_SCHEMA' "$f";      [ "$status" -eq 0 ]
  run rg_or_grep -F 'computeGrade' "$f";          [ "$status" -eq 0 ]
  run rg_or_grep -iF 'Agent-tool fallback' "$f";  [ "$status" -eq 0 ]
}

@test "memory-audit analysis-workflow.md pins both agent() call sites to sonnet" {
  local f="$PLUGIN/skills/memory-audit/analysis-workflow.md"
  run rg_or_grep -F "schema: FINDINGS_SCHEMA, model: 'sonnet'" "$f";  [ "$status" -eq 0 ]
  run rg_or_grep -F "schema: AGGREGATE_SCHEMA, model: 'sonnet'" "$f"; [ "$status" -eq 0 ]
}

@test "memory-audit analysis-workflow.md backfill keeps manual to-dos and computes summary in code" {
  local f="$PLUGIN/skills/memory-audit/analysis-workflow.md"
  run rg_or_grep -F 'recommendedActions: covered.map(f => f.recommendation)' "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -F 'const filesNeedingUpdate =' "$f";                            [ "$status" -eq 0 ]
  run rg_or_grep -F 'const filesFailed =' "$f";                                   [ "$status" -eq 0 ]
  run rg_or_grep -F "label: 'aggregate:retry'" "$f";                              [ "$status" -eq 0 ]
}

@test "plugin.json version was bumped for memory-audit rename + --fix (minor, off 1.7.11)" {
  run jq -r '.version' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [ "$output" != "1.7.11" ]
}

# --- memory-audit doc/manifest sync ---

@test "plugin.json description mentions memory-audit" {
  run jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *"memory-audit"* ]]
}

@test "claude-code-knowledge CLAUDE.md lists memory-audit" {
  run rg_or_grep -F 'memory-audit' "$PLUGIN/CLAUDE.md"
  [ "$status" -eq 0 ]
}

@test "claude-code-knowledge README lists memory-audit in the Skills table" {
  run rg_or_grep -F '`memory-audit`' "$PLUGIN/README.md"
  [ "$status" -eq 0 ]
}

@test "root README plugin row mentions memory-audit" {
  run rg_or_grep -F 'claude-code-knowledge](plugins/claude-code-knowledge/README.md)' "$REPO_ROOT/README.md"
  [ "$status" -eq 0 ]
  [[ "$output" == *"memory-audit"* ]]
}

# --- cc-reference-validator agent (read-only contradiction validator) ---

@test "cc-reference-validator agent exists and is read-only" {
  agent="$REPO_ROOT/.claude/agents/cc-reference-validator.md"
  [ -f "$agent" ]
  rg_or_grep -Eq "^name: cc-reference-validator$" "$agent"
  rg_or_grep -Eq "^tools:.*Read" "$agent"
  ! rg_or_grep -Eq "^tools:.*(Write|Edit)" "$agent"
}

@test "cc-reference-validator encodes the adversarial verdict discipline" {
  agent="$REPO_ROOT/.claude/agents/cc-reference-validator.md"
  rg_or_grep -qi "verbatim" "$agent"
  rg_or_grep -q "CONFIRMED" "$agent"
  rg_or_grep -q "REJECTED" "$agent"
  rg_or_grep -q "UNVERIFIABLE" "$agent"
}

@test "cc-reference-validator consults the advisor on difficult decisions when one is available" {
  agent="$REPO_ROOT/.claude/agents/cc-reference-validator.md"
  rg_or_grep -qi "advisor" "$agent"
  rg_or_grep -qi "available" "$agent"
}

# --- update-cc-references contradiction-validation gate ---

@test "update-cc-references skill has the contradiction-validation gate" {
  rg_or_grep -qi "Contradiction-validation gate" "$MAINT"
  rg_or_grep -q "cc-reference-validator" "$MAINT"
  rg_or_grep -qi "git diff HEAD" "$MAINT"
  rg_or_grep -q "UNVERIFIABLE" "$MAINT"
}

@test "update-cc-references Release is gated on the contradiction gate" {
  rg_or_grep -qi "zero unconfirmed contradictions" "$MAINT"
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
  echo "$output" | rg_or_grep -q "BUN_RAN /x/server.mjs --flag"
}

@test "mjs-launch.sh falls back to node when bun is absent" {
  nodedir="$(dirname "$(command -v node)")"
  script="$BATS_TEST_TMPDIR/which.mjs"
  printf 'process.stdout.write(process.versions.bun ? "RUNTIME_BUN" : "RUNTIME_NODE");\n' > "$script"
  run env -i HOME="$BATS_TEST_TMPDIR/nohome" PATH="$nodedir:/usr/bin:/bin" bash "$PLUGIN/bin/mjs-launch.sh" "$script"
  [ "$status" -eq 0 ]
  echo "$output" | rg_or_grep -q "RUNTIME_NODE"
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
# Hermetic: `claude` runs only as a make_stub bash executable on the isolated
# MOCKBIN PATH (env -i). No network, no real claude CLI.

compress_script() {
  printf '%s' "$PLUGIN/skills/cc-compress/scripts/compress.mjs"
}

# run_compress <filepath> <backup-root> — invoke compress.mjs on the isolated
# MOCKBIN PATH/HOME. Forwards RETRY_COUNTER/RETRY_OUTPUT_1/RETRY_OUTPUT_2 when
# a test has set them (the retry stub reads its per-call output from there).
run_compress() {
  run env -i PATH="$MOCKBIN" HOME="$HOME" \
    ${RETRY_COUNTER:+RETRY_COUNTER="$RETRY_COUNTER"} \
    ${RETRY_OUTPUT_1:+RETRY_OUTPUT_1="$RETRY_OUTPUT_1"} \
    ${RETRY_OUTPUT_2:+RETRY_OUTPUT_2="$RETRY_OUTPUT_2"} \
    "$MOCKBIN/node" "$(compress_script)" "$@"
}

# find_backup <backup-root> <basename> — locate a backup file without needing
# to replicate backupPathFor's hash-suffixed directory name in bash.
find_backup() {
  find "$1" -type f -name "$2" 2>/dev/null
}

# backup_hash_dir <source-dir> — mirrors compress.mjs's backupPathFor naming
# (parent-dir-name + 8-hex-char sha256 of the full dir path), for the one test
# that must pre-create a backup at the exact path compress.mjs will compute.
backup_hash_dir() {
  local hash
  hash="$(node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex').slice(0,8))" "$1")"
  printf '%s-%s' "$(basename "$1")" "$hash"
}

# install_passthrough_claude_stub — a `claude` stub that validates it was
# called with `--print --model sonnet`, then echoes back everything after the
# last "TEXT:\n" marker in the prompt plus a trailing HTML-comment marker — a
# trivial, structure-preserving "compression" that satisfies every validator
# (headings/code-blocks/URLs/paths/bullets/inline-code all unchanged) while
# still differing from the input, so the identical-output guard doesn't fire.
install_passthrough_claude_stub() {
  make_stub claude \
    'if [[ "$*" != *"--print"* || "$*" != *"--model"* || "$*" != *"sonnet"* ]]; then echo "bad args: $*" >&2; exit 9; fi' \
    'prompt="$(cat)"' \
    'marker=$'"'"'TEXT:\n'"'"'' \
    'body="${prompt#*"$marker"}"' \
    'printf '"'"'%s\n\n<!-- compressed -->'"'"' "$body"'
}

# install_retry_claude_stub <broken-output> <fixed-output> <counter-file> — a
# `claude` stub returning <broken-output> on its first call and <fixed-output>
# on every call after, tracked via <counter-file>. Outputs are written to
# files and read via env vars (RETRY_OUTPUT_1/2, RETRY_COUNTER) rather than
# interpolated into the stub body, so multi-line content with backticks never
# needs escaping into the generated script.
install_retry_claude_stub() {
  local dir="$BATS_TEST_TMPDIR/retry_outputs"
  mkdir -p "$dir"
  printf '%s' "$1" > "$dir/output1.md"
  printf '%s' "$2" > "$dir/output2.md"
  RETRY_COUNTER="$3"
  RETRY_OUTPUT_1="$dir/output1.md"
  RETRY_OUTPUT_2="$dir/output2.md"
  make_stub claude \
    'if [[ "$*" != *"--print"* || "$*" != *"--model"* || "$*" != *"sonnet"* ]]; then echo "bad args: $*" >&2; exit 9; fi' \
    'cat > /dev/null' \
    'n=0; [ -f "$RETRY_COUNTER" ] && n=$(cat "$RETRY_COUNTER")' \
    'n=$((n+1)); echo "$n" > "$RETRY_COUNTER"' \
    'if [ "$n" -eq 1 ]; then cat "$RETRY_OUTPUT_1"; else cat "$RETRY_OUTPUT_2"; fi'
}

@test "compress.mjs exists, is executable, passes node --check" {
  local s; s="$(compress_script)"
  [ -x "$s" ]
  run node --check "$s"
  [ "$status" -eq 0 ]
}

@test "compress.mjs: no args prints usage and exits 1" {
  run_compress
  [ "$status" -eq 1 ]
  echo "$output" | rg_or_grep -qi usage
}

@test "compress.mjs: one arg prints usage and exits 1" {
  run_compress "$BATS_TEST_TMPDIR/x.md"
  [ "$status" -eq 1 ]
}

@test "compress.mjs: non-.md target is skipped with exit 0, no backup written" {
  local src="$BATS_TEST_TMPDIR/notes.txt"
  echo "hello" > "$src"
  local backup_root="$BATS_TEST_TMPDIR/backups_skip"
  run_compress "$src" "$backup_root"
  [ "$status" -eq 0 ]
  [ ! -d "$backup_root" ]
}

@test "compress.mjs: sensitive filename is refused without spawning claude" {
  # MOCKBIN has no `claude` stub in this test — if the sensitive check were
  # ever bypassed, execFileSync would hit ENOENT and the output would say
  # "claude CLI not found", not "sensitive", so the assertion below still
  # distinguishes correct-refusal from an accidental invocation.
  local src="$BATS_TEST_TMPDIR/secrets.md"
  printf 'some content that is long enough to pass the empty check\n' > "$src"
  local backup_root="$BATS_TEST_TMPDIR/backups_sensitive"
  run_compress "$src" "$backup_root"
  [ "$status" -eq 1 ]
  echo "$output" | rg_or_grep -qi sensitive
  rg_or_grep -q "some content that is long enough" "$src"
}

@test "compress.mjs: claude missing from PATH leaves source untouched with a clear error" {
  # MOCKBIN has no `claude` stub — this is the natural "missing" case.
  local src="$BATS_TEST_TMPDIR/plain.md"
  printf '# Title\n\nSome prose sentence long enough to compress.\n' > "$src"
  cp "$src" "$BATS_TEST_TMPDIR/plain.md.orig"
  local backup_root="$BATS_TEST_TMPDIR/backups_noclaude"
  run_compress "$src" "$backup_root" --confirmed
  [ "$status" -eq 1 ]
  diff "$src" "$BATS_TEST_TMPDIR/plain.md.orig"
}

@test "compress.mjs: successful compression writes compressed file + backup" {
  install_passthrough_claude_stub
  mkdir -p "$BATS_TEST_TMPDIR/proj"
  local src="$BATS_TEST_TMPDIR/proj/notes.md"
  printf '# Title\n\nThis is a long enough sentence to compress.\n' > "$src"
  local backup_root="$BATS_TEST_TMPDIR/backups_ok"
  run_compress "$src" "$backup_root" --confirmed
  [ "$status" -eq 0 ]
  rg_or_grep -q '<!-- compressed -->' "$src"
  rg_or_grep -q '# Title' "$src"
  local backup; backup="$(find_backup "$backup_root" 'notes.original.md')"
  [ -n "$backup" ]
  rg_or_grep -q 'This is a long enough sentence to compress.' "$backup"
}

@test "compress.mjs: existing backup aborts to prevent data loss" {
  install_passthrough_claude_stub
  mkdir -p "$BATS_TEST_TMPDIR/proj2"
  local src="$BATS_TEST_TMPDIR/proj2/notes.md"
  printf '# Title\n\nThis is a long enough sentence to compress.\n' > "$src"
  local backup_root="$BATS_TEST_TMPDIR/backups_exists"
  local hashdir; hashdir="$(backup_hash_dir "$BATS_TEST_TMPDIR/proj2")"
  mkdir -p "$backup_root/$hashdir"
  echo "pre-existing backup" > "$backup_root/$hashdir/notes.original.md"
  run_compress "$src" "$backup_root" --confirmed
  [ "$status" -eq 1 ]
  echo "$output" | rg_or_grep -qi "already exists"
  rg_or_grep -q '# Title' "$src"
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
  run_compress "$src" "$backup_root" --confirmed
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
  run_compress "$src" "$backup_root" --confirmed
  [ "$status" -eq 0 ]
  rg_or_grep -q '````text' "$src"
  rg_or_grep -q 'inner marker' "$src"
}

@test "compress.mjs: multiple URLs preserved" {
  install_passthrough_claude_stub
  mkdir -p "$BATS_TEST_TMPDIR/proj5"
  local src="$BATS_TEST_TMPDIR/proj5/notes.md"
  printf '# Title\n\nSee https://example.com/a and https://example.com/b for a long enough sentence.\n' > "$src"
  local backup_root="$BATS_TEST_TMPDIR/backups_urls"
  run_compress "$src" "$backup_root" --confirmed
  [ "$status" -eq 0 ]
  rg_or_grep -q 'https://example.com/a' "$src"
  rg_or_grep -q 'https://example.com/b' "$src"
}

@test "compress.mjs: preserves a trailing newline the original had" {
  install_passthrough_claude_stub
  mkdir -p "$BATS_TEST_TMPDIR/proj9"
  local src="$BATS_TEST_TMPDIR/proj9/notes.md"
  printf '# Title\n\nThis is a long enough sentence to compress.\n' > "$src"
  local backup_root="$BATS_TEST_TMPDIR/backups_nl"
  run_compress "$src" "$backup_root" --confirmed
  [ "$status" -eq 0 ]
  [ -z "$(tail -c1 "$src" | tr -d '\n')" ]
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
  run_compress "$src" "$backup_root" --confirmed
  [ "$status" -eq 0 ]
  rg_or_grep -q 'Fixed compression' "$src"
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
  run_compress "$src" "$backup_root" --confirmed
  [ "$status" -eq 0 ]
  rg_or_grep -q 'https://example.com/docs' "$src"
  [ "$(cat "$counter")" = "2" ]
}

@test "compress.mjs: exhausts retries, leaves source untouched, writes no backup" {
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
  run_compress "$src" "$backup_root" --confirmed
  [ "$status" -eq 2 ]
  diff "$src" "$BATS_TEST_TMPDIR/proj7/notes.md.orig"
  [ -z "$(find_backup "$backup_root" 'notes.original.md')" ]
}

@test "compress.mjs: exit 3 when target is untracked, nothing touched" {
  mkdir -p "$BATS_TEST_TMPDIR/proj10"
  (cd "$BATS_TEST_TMPDIR/proj10" && git init -q)
  local src="$BATS_TEST_TMPDIR/proj10/notes.md"
  printf '# Title\n\nSome prose sentence long enough to compress.\n' > "$src"
  cp "$src" "$src.orig"
  local backup_root="$BATS_TEST_TMPDIR/backups_untracked"
  run_compress "$src" "$backup_root"
  [ "$status" -eq 3 ]
  echo "$output" | rg_or_grep -qi "not git-recoverable"
  diff "$src" "$src.orig"
  [ -z "$(find_backup "$backup_root" 'notes.original.md')" ]
}

@test "compress.mjs: --confirmed bypasses the git-recoverability gate" {
  install_passthrough_claude_stub
  mkdir -p "$BATS_TEST_TMPDIR/proj11"
  (cd "$BATS_TEST_TMPDIR/proj11" && git init -q)
  local src="$BATS_TEST_TMPDIR/proj11/notes.md"
  printf '# Title\n\nThis is a long enough sentence to compress.\n' > "$src"
  local backup_root="$BATS_TEST_TMPDIR/backups_bypass"
  run_compress "$src" "$backup_root" --confirmed
  [ "$status" -eq 0 ]
}

@test "compress.mjs: git-tracked-and-clean target skips the recoverability gate" {
  install_passthrough_claude_stub
  mkdir -p "$BATS_TEST_TMPDIR/proj12"
  local src="$BATS_TEST_TMPDIR/proj12/notes.md"
  printf '# Title\n\nThis is a long enough sentence to compress.\n' > "$src"
  (
    cd "$BATS_TEST_TMPDIR/proj12"
    git init -q
    git config user.email test@example.com
    git config user.name test
    git add notes.md
    git commit -q -m init
  )
  local backup_root="$BATS_TEST_TMPDIR/backups_tracked"
  run_compress "$src" "$backup_root"
  [ "$status" -eq 0 ]
}

# --- cc-compress orchestrator skill ---

@test "cc-compress SKILL.md exists" {
  [ -f "$PLUGIN/skills/cc-compress/SKILL.md" ]
}

@test "cc-compress SKILL.md has name, description, argument-hint frontmatter" {
  local f="$PLUGIN/skills/cc-compress/SKILL.md"
  run rg_or_grep -E '^name:[[:space:]]*cc-compress' "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -E '^description:' "$f";                  [ "$status" -eq 0 ]
  run rg_or_grep -E '^argument-hint:' "$f";                 [ "$status" -eq 0 ]
}

@test "cc-compress is model-invocable (no disable-model-invocation)" {
  run rg_or_grep -E '^disable-model-invocation:[[:space:]]*true' "$PLUGIN/skills/cc-compress/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "cc-compress has no load-time !-injection trigger" {
  run rg_or_grep -nE '!`' "$PLUGIN/skills/cc-compress/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "cc-compress references its bundled script via CLAUDE_SKILL_DIR" {
  run rg_or_grep -F '${CLAUDE_SKILL_DIR}/scripts/compress.mjs' "$PLUGIN/skills/cc-compress/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-compress gates non-recoverable targets through AskUserQuestion" {
  local f="$PLUGIN/skills/cc-compress/SKILL.md"
  run rg_or_grep -F 'AskUserQuestion' "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -iF 'git' "$f";            [ "$status" -eq 0 ]
}

@test "cc-compress documents the session-temp backup resolution" {
  run rg_or_grep -iE 'scratchpad|mktemp' "$PLUGIN/skills/cc-compress/SKILL.md"
  [ "$status" -eq 0 ]
}

# --- cc-compress doc/manifest sync ---

@test "plugin.json version was bumped for cc-reference docs refresh (patch)" {
  run jq -r '.version' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [ "$output" != "1.8.0" ]
}

@test "plugin.json description mentions cc-compress" {
  run jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *"cc-compress"* ]]
}

@test "claude-code-knowledge CLAUDE.md boundary rule lists cc-compress" {
  run rg_or_grep -F 'cc-compress' "$PLUGIN/CLAUDE.md"
  [ "$status" -eq 0 ]
}

@test "claude-code-knowledge README lists cc-compress in the Skills table" {
  run rg_or_grep -F '`cc-compress`' "$PLUGIN/README.md"
  [ "$status" -eq 0 ]
}

@test "root README plugin row mentions cc-compress" {
  run rg_or_grep -F 'claude-code-knowledge](plugins/claude-code-knowledge/README.md)' "$REPO_ROOT/README.md"
  [ "$status" -eq 0 ]
  [[ "$output" == *"cc-compress"* ]]
}

# --- context-mode removal ---

@test "claude-code-expert agent has no context-mode reference" {
  [ -f "$PLUGIN/agents/claude-code-expert.md" ]
  run rg_or_grep -c "context-mode" "$PLUGIN/agents/claude-code-expert.md"
  [ "$status" -eq 1 ]
}

@test "cc-author-planner agent has no context-mode reference" {
  [ -f "$PLUGIN/agents/cc-author-planner.md" ]
  run rg_or_grep -c "context-mode" "$PLUGIN/agents/cc-author-planner.md"
  [ "$status" -eq 1 ]
}

@test "cc-reviewer agent has no context-mode reference" {
  [ -f "$PLUGIN/agents/cc-reviewer.md" ]
  run rg_or_grep -c "context-mode" "$PLUGIN/agents/cc-reviewer.md"
  [ "$status" -eq 1 ]
}

@test "cc-reference skill has no context-mode reference" {
  [ -f "$PLUGIN/skills/cc-reference/SKILL.md" ]
  run rg_or_grep -c "context-mode" "$PLUGIN/skills/cc-reference/SKILL.md"
  [ "$status" -eq 1 ]
}

@test "cc-review skill has no context-mode reference" {
  [ -f "$PLUGIN/skills/cc-review/SKILL.md" ]
  run rg_or_grep -c "context-mode" "$PLUGIN/skills/cc-review/SKILL.md"
  [ "$status" -eq 1 ]
}

@test "memory-audit skill has no context-mode reference" {
  [ -f "$PLUGIN/skills/memory-audit/SKILL.md" ]
  run rg_or_grep -c "context-mode" "$PLUGIN/skills/memory-audit/SKILL.md"
  [ "$status" -eq 1 ]
}

# --- lsp-audit script (scripts/audit-lsp.mjs) ---
# Hermetic: the audit script spawns no child process (pure fs), so tests call
# the real `node` directly against temp project dirs under $BATS_TEST_TMPDIR.

audit_script() { printf '%s' "$PLUGIN/skills/lsp-audit/scripts/audit-lsp.mjs"; }
run_audit() { run node "$(audit_script)" "$@"; }

@test "audit-lsp.mjs exists and passes node --check" {
  local s; s="$(audit_script)"
  [ -f "$s" ]
  run node --check "$s"
  [ "$status" -eq 0 ]
}

@test "audit-lsp.reference.md exists and documents the invocation" {
  local r="$PLUGIN/skills/lsp-audit/scripts/audit-lsp.reference.md"
  [ -f "$r" ]
  run rg_or_grep -F 'audit-lsp.mjs' "$r"
  [ "$status" -eq 0 ]
}

@test "audit-lsp.reference.md documents the plugin target, legacy migration and new output keys" {
  local r="$PLUGIN/skills/lsp-audit/scripts/audit-lsp.reference.md"
  run rg_or_grep -F '.claude/skills/lsp/.lsp.json' "$r"; [ "$status" -eq 0 ]
  run rg_or_grep -F '.claude-plugin/plugin.json' "$r"; [ "$status" -eq 0 ]
  run rg_or_grep -F 'legacyRootLspJson' "$r"; [ "$status" -eq 0 ]
  run rg_or_grep -F 'migratedFromRoot' "$r"; [ "$status" -eq 0 ]
  run rg_or_grep -F 'pluginManifestMissing' "$r"; [ "$status" -eq 0 ]
  run rg_or_grep -F 'only migrates a legacy root file' "$r"; [ "$status" -eq 0 ]
}

@test "lsp-map.json is valid JSON with the expected catalog shape" {
  local m="$PLUGIN/skills/lsp-audit/scripts/lsp-map.json"
  run jq empty "$m"
  [ "$status" -eq 0 ]
  # every value is an object carrying a "server" field, or a bare string alias
  run jq -e 'all(.[]; (type=="object" and has("server")) or type=="string")' "$m"
  [ "$status" -eq 0 ]
}

@test "audit mode: reports catalog proposals and unknowns for uncovered exts" {
  local proj="$BATS_TEST_TMPDIR/p_audit"
  local f="$proj/.claude/skills/lsp/.lsp.json"
  mkdir -p "${f%/*}"
  printf 'x\n' > "$proj/a.py"
  printf 'x\n' > "$proj/b.go"
  printf 'x\n' > "$proj/c.md"
  printf '{}\n' > "$f"
  run_audit "$proj"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.lspJsonExists == true'
  echo "$output" | jq -e '.proposals | map(select(.ext==".py" and .server=="pylsp")) | length == 1'
  echo "$output" | jq -e '.proposals | map(select(.ext==".go" and .server=="gopls")) | length == 1'
  echo "$output" | jq -e '.unknown   | map(select(.ext==".md")) | length == 1'
}

@test "--fix: writes pylsp + gopls blocks, no .md server, canonical 2-space+newline output" {
  local proj="$BATS_TEST_TMPDIR/p_fix"
  local f="$proj/.claude/skills/lsp/.lsp.json"
  mkdir -p "${f%/*}"
  printf 'x\n' > "$proj/a.py"
  printf 'x\n' > "$proj/b.go"
  printf 'x\n' > "$proj/c.md"
  printf '{}\n' > "$f"
  run_audit "$proj" --fix
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.applied | index(".py") != null'
  echo "$output" | jq -e '.applied | index(".go") != null'
  jq -e '.pylsp.extensionToLanguage[".py"] == "python"' "$f"
  jq -e '.gopls.extensionToLanguage[".go"] == "go"' "$f"
  # no server covers .md
  jq -e 'any(.[]; (.extensionToLanguage // {}) | has(".md")) | not' "$f"
  # on-disk text is exactly JSON.stringify(obj, null, 2) + "\n"
  run node -e 'const fs=require("fs");const t=fs.readFileSync(process.argv[1],"utf8");process.exit(t===JSON.stringify(JSON.parse(t),null,2)+"\n"?0:1)' "$f"
  [ "$status" -eq 0 ]
}

@test "--fix merges into an existing server (no duplicate block)" {
  local proj="$BATS_TEST_TMPDIR/p_merge"
  local f="$proj/.claude/skills/lsp/.lsp.json"
  mkdir -p "${f%/*}"
  printf 'x\n' > "$proj/a.mjs"
  cat > "$f" <<'JSON'
{
  "vtsls": {
    "command": "npx",
    "args": ["-y", "@vtsls/language-server@0.3.0", "--stdio"],
    "extensionToLanguage": {
      ".ts": "typescript"
    },
    "startupTimeout": 60000
  }
}
JSON
  run_audit "$proj" --fix
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.mergedIntoServers | index("vtsls") != null'
  jq -e '.vtsls.extensionToLanguage[".mjs"] == "javascript"' "$f"
  jq -e '.vtsls.extensionToLanguage[".ts"]  == "typescript"' "$f"
  # exactly one vtsls key (no duplicate server block)
  jq -e '[keys[] | select(. == "vtsls")] | length == 1' "$f"
}

@test "new server block is scoped to only the applied extension, not catalog-family siblings" {
  local proj="$BATS_TEST_TMPDIR/p_scoped"
  local f="$proj/.claude/skills/lsp/.lsp.json"
  mkdir -p "${f%/*}"
  printf 'x\n' > "$proj/a.css"
  cat > "$f" <<'JSON'
{
  "othercss": {
    "command": "x",
    "args": [],
    "extensionToLanguage": {
      ".scss": "scss"
    },
    "startupTimeout": 60000
  }
}
JSON
  run_audit "$proj" --apply ".css"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.createdServers   | index("cssls") != null'
  echo "$output" | jq -e '.conflictsSkipped == []'
  # cssls gets only .css — not .scss/.less, even though the catalog's cssls
  # entry lists them as siblings and the project has neither of those files
  jq -e '.cssls.extensionToLanguage | has(".css") and (has(".scss") | not) and (has(".less") | not)' "$f"
  # existing server untouched
  jq -e '.othercss.extensionToLanguage[".scss"] == "scss"' "$f"
}

@test "malformed .lsp.json: exit 1, file byte-for-byte unchanged, nothing written" {
  local proj="$BATS_TEST_TMPDIR/p_bad"
  local f="$proj/.claude/skills/lsp/.lsp.json"
  mkdir -p "${f%/*}"
  printf 'x\n' > "$proj/a.py"
  printf '%s' '{ not valid json' > "$f"
  local before; before="$(cat "$f")"
  run_audit "$proj" --fix
  [ "$status" -eq 1 ]
  [ "$(cat "$f")" = "$before" ]
  [ ! -e "$proj/.claude/skills/lsp/.claude-plugin" ]
}

@test "no .lsp.json: --fix creates a well-formed fresh file" {
  local proj="$BATS_TEST_TMPDIR/p_fresh"
  local f="$proj/.claude/skills/lsp/.lsp.json"
  local m="$proj/.claude/skills/lsp/.claude-plugin/plugin.json"
  mkdir -p "$proj"
  printf 'x\n' > "$proj/a.py"
  [ ! -e "$proj/.claude" ]
  run_audit "$proj" --fix
  [ "$status" -eq 0 ]
  [ -f "$f" ]
  jq -e '.pylsp.extensionToLanguage[".py"] == "python"' "$f"
  run node -e 'const fs=require("fs");const t=fs.readFileSync(process.argv[1],"utf8");process.exit(t===JSON.stringify(JSON.parse(t),null,2)+"\n"?0:1)' "$f"
  [ "$status" -eq 0 ]
  jq -e '.name == "lsp"' "$m"
  jq -e '.description == "Project LSP server configuration, maintained by claude-code-knowledge:lsp-audit."' "$m"
  [ ! -e "$proj/.lsp.json" ]
}

@test "--apply applies only the named extension" {
  local proj="$BATS_TEST_TMPDIR/p_apply"
  local f="$proj/.claude/skills/lsp/.lsp.json"
  mkdir -p "${f%/*}"
  printf 'x\n' > "$proj/a.py"
  printf 'x\n' > "$proj/b.go"
  printf '{}\n' > "$f"
  run_audit "$proj" --apply ".py"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.applied == [".py"]'
  jq -e '.pylsp.extensionToLanguage[".py"] == "python"' "$f"
  jq -e 'has("gopls") | not' "$f"
}

@test "dotfile with only a leading dot is skipped (no extension)" {
  local proj="$BATS_TEST_TMPDIR/p_dotfile"
  local f="$proj/.claude/skills/lsp/.lsp.json"
  mkdir -p "${f%/*}"
  printf 'x\n' > "$proj/.gitignore"
  printf 'x\n' > "$proj/a.py"
  printf '{}\n' > "$f"
  run_audit "$proj"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '[.proposals[].ext, .unknown[].ext] | (index(".gitignore") == null) and (index("gitignore") == null)'
}

@test "pruned directories do not contribute extensions" {
  local proj="$BATS_TEST_TMPDIR/p_prune"
  local f="$proj/.claude/skills/lsp/.lsp.json"
  mkdir -p "$proj/node_modules" "${f%/*}"
  printf 'x\n' > "$proj/node_modules/foo.py"
  printf '{}\n' > "$f"
  run_audit "$proj"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '[.proposals[].ext] | index(".py") == null'
}

@test "an existing plugin manifest is never overwritten" {
  local proj="$BATS_TEST_TMPDIR/p_manifest"
  local d="$proj/.claude/skills/lsp"
  mkdir -p "$d/.claude-plugin"
  printf 'x\n' > "$proj/a.py"
  printf '{}\n' > "$d/.lsp.json"
  printf '{"name":"lsp","description":"custom"}' > "$d/.claude-plugin/plugin.json"
  cp "$d/.claude-plugin/plugin.json" "$BATS_TEST_TMPDIR/manifest.before"
  run_audit "$proj" --fix
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.wrote == true'
  jq -e '.pylsp.extensionToLanguage[".py"] == "python"' "$d/.lsp.json"
  cmp "$BATS_TEST_TMPDIR/manifest.before" "$d/.claude-plugin/plugin.json"
}

@test "a plugin .lsp.json without a manifest is reported and repaired without rewriting the .lsp.json" {
  local proj="$BATS_TEST_TMPDIR/p_repair"
  local d="$proj/.claude/skills/lsp"
  mkdir -p "$d"
  printf 'x\n' > "$proj/a.py"
  printf '{ "keep":   {"command":"x","extensionToLanguage":{".zz":"zz"}} }\n' > "$d/.lsp.json"
  cp "$d/.lsp.json" "$BATS_TEST_TMPDIR/lsp.before"
  run_audit "$proj"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.pluginManifestMissing == true'
  [ ! -e "$d/.claude-plugin" ]
  run_audit "$proj" --apply ""
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.wrote == true and .applied == [] and .migratedFromRoot == false'
  jq -e '.name == "lsp"' "$d/.claude-plugin/plugin.json"
  cmp "$BATS_TEST_TMPDIR/lsp.before" "$d/.lsp.json"
  run_audit "$proj"
  echo "$output" | jq -e '.pluginManifestMissing == false'
}

@test "a plain skill at .claude/skills/lsp fails closed in every mode and is left untouched" {
  local proj="$BATS_TEST_TMPDIR/p_plainskill"
  local d="$proj/.claude/skills/lsp"
  mkdir -p "$d"
  printf 'x\n' > "$proj/a.py"
  printf -- '---\nname: lsp\n---\n' > "$d/SKILL.md"
  printf '{}\n' > "$d/.lsp.json"
  for mode in "" "--fix"; do
    run_audit "$proj" $mode
    [ "$status" -eq 1 ]
    [[ "$output" == *"plain skill"* ]]
  done
  [ ! -e "$d/.claude-plugin" ]
  [ "$(cat "$d/.lsp.json")" = "{}" ]
}

@test "--fix migrates a root .lsp.json into the lsp plugin and removes it" {
  local proj="$BATS_TEST_TMPDIR/p_mig"
  mkdir -p "$proj"
  printf 'x\n' > "$proj/a.ts"
  printf 'x\n' > "$proj/a.py"
  cat > "$proj/.lsp.json" <<'JSON'
{
  "vtsls": {
    "command": "npx",
    "args": ["-y", "@vtsls/language-server@0.3.0", "--stdio"],
    "extensionToLanguage": {
      ".ts": "typescript"
    },
    "startupTimeout": 60000
  }
}
JSON
  run_audit "$proj" --fix
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.migratedFromRoot == true'
  echo "$output" | jq -e '.wrote == true'
  [ ! -e "$proj/.lsp.json" ]
  local f="$proj/.claude/skills/lsp/.lsp.json"
  jq -e '.vtsls.extensionToLanguage[".ts"] == "typescript"' "$f"
  jq -e '.pylsp.extensionToLanguage[".py"] == "python"' "$f"
  jq -e '.name == "lsp"' "$proj/.claude/skills/lsp/.claude-plugin/plugin.json"
}

@test "--fix with nothing to add still migrates the root file byte-identically" {
  local proj="$BATS_TEST_TMPDIR/p_mig_same"
  mkdir -p "$proj"
  printf 'x\n' > "$proj/a.py"
  node -e 'const c={pylsp:{command:"pylsp",args:[],extensionToLanguage:{".py":"python"},startupTimeout:60000},jsonls:{command:"vscode-json-languageserver",args:["--stdio"],extensionToLanguage:{".json":"json"},startupTimeout:60000}};process.stdout.write(JSON.stringify(c,null,2)+"\n")' > "$proj/.lsp.json"
  cp "$proj/.lsp.json" "$BATS_TEST_TMPDIR/root.same.before"
  run_audit "$proj" --fix
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.applied == []'
  echo "$output" | jq -e '.migratedFromRoot == true'
  [ ! -e "$proj/.lsp.json" ]
  cmp "$BATS_TEST_TMPDIR/root.same.before" "$proj/.claude/skills/lsp/.lsp.json"
}

@test "audit mode with a root .lsp.json is read-only and reports legacyRootLspJson" {
  local proj="$BATS_TEST_TMPDIR/p_mig_audit"
  mkdir -p "$proj"
  printf 'x\n' > "$proj/a.py"
  cat > "$proj/.lsp.json" <<'JSON'
{ "pylsp": { "command": "pylsp", "args": [], "extensionToLanguage": { ".py": "python" }, "startupTimeout": 60000 } }
JSON
  cp "$proj/.lsp.json" "$BATS_TEST_TMPDIR/root.audit.before"
  run_audit "$proj"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.legacyRootLspJson == true'
  echo "$output" | jq -e '.lspJsonExists == false'
  echo "$output" | jq -e '[.proposals[].ext] | index(".py") == null'
  cmp "$BATS_TEST_TMPDIR/root.audit.before" "$proj/.lsp.json"
  [ ! -e "$proj/.claude/skills/lsp" ]
}

@test "a malformed root .lsp.json fails closed: nothing written, root untouched" {
  local proj="$BATS_TEST_TMPDIR/p_mig_bad"
  mkdir -p "$proj"
  printf 'x\n' > "$proj/a.py"
  printf '%s' '{ not valid json' > "$proj/.lsp.json"
  cp "$proj/.lsp.json" "$BATS_TEST_TMPDIR/root.bad.before"
  run_audit "$proj" --fix
  [ "$status" -eq 1 ]
  cmp "$BATS_TEST_TMPDIR/root.bad.before" "$proj/.lsp.json"
  [ ! -e "$proj/.claude/skills/lsp" ]
}

@test "a shared server id with differing blocks fails closed, both files unchanged" {
  local proj="$BATS_TEST_TMPDIR/p_mig_conflict"
  local d="$proj/.claude/skills/lsp"
  mkdir -p "$d"
  printf 'x\n' > "$proj/a.ts"
  printf '%s\n' '{"vtsls":{"command":"npx","args":["-y","@vtsls/language-server@0.3.0","--stdio"],"extensionToLanguage":{".ts":"typescript"},"startupTimeout":60000}}' > "$proj/.lsp.json"
  printf '%s\n' '{"vtsls":{"command":"npx","args":["-y","@vtsls/language-server@0.3.0","--stdio"],"extensionToLanguage":{".mjs":"javascript"},"startupTimeout":60000}}' > "$d/.lsp.json"
  cp "$proj/.lsp.json" "$BATS_TEST_TMPDIR/root.conflict.before"
  cp "$d/.lsp.json" "$BATS_TEST_TMPDIR/plugin.conflict.before"
  run_audit "$proj" --fix
  [ "$status" -eq 1 ]
  cmp "$BATS_TEST_TMPDIR/root.conflict.before" "$proj/.lsp.json"
  cmp "$BATS_TEST_TMPDIR/plugin.conflict.before" "$d/.lsp.json"
}

@test "--apply with an empty list only migrates the root .lsp.json" {
  local proj="$BATS_TEST_TMPDIR/p_mig_only"
  mkdir -p "$proj"
  printf 'x\n' > "$proj/a.py"
  printf 'x\n' > "$proj/b.go"
  cat > "$proj/.lsp.json" <<'JSON'
{ "pylsp": { "command": "pylsp", "args": [], "extensionToLanguage": { ".py": "python" }, "startupTimeout": 60000 } }
JSON
  run_audit "$proj" --apply ""
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.applied == []'
  echo "$output" | jq -e '.migratedFromRoot == true'
  [ ! -e "$proj/.lsp.json" ]
  local f="$proj/.claude/skills/lsp/.lsp.json"
  jq -e '.pylsp.extensionToLanguage[".py"] == "python"' "$f"
  jq -e 'has("gopls") | not' "$f"
}

@test "a root that is itself a plugin keeps its own .lsp.json (not legacy, never deleted)" {
  local proj="$BATS_TEST_TMPDIR/p_plugin_root"
  mkdir -p "$proj/.claude-plugin"
  printf '{"name":"x"}\n' > "$proj/.claude-plugin/plugin.json"
  printf 'x\n' > "$proj/a.py"
  cat > "$proj/.lsp.json" <<'JSON'
{ "pylsp": { "command": "pylsp", "args": [], "extensionToLanguage": { ".py": "python" }, "startupTimeout": 60000 } }
JSON
  cp "$proj/.lsp.json" "$BATS_TEST_TMPDIR/root.pluginroot.before"
  run_audit "$proj"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.legacyRootLspJson == false'
  run_audit "$proj" --fix
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.migratedFromRoot == false'
  cmp "$BATS_TEST_TMPDIR/root.pluginroot.before" "$proj/.lsp.json"
}

@test "a shared server id differing only in key order is not a conflict" {
  local proj="$BATS_TEST_TMPDIR/p_mig_order"
  local d="$proj/.claude/skills/lsp"
  mkdir -p "$d"
  printf 'x\n' > "$proj/a.ts"
  printf '%s\n' '{"vtsls":{"command":"npx","args":["-y","@vtsls/language-server@0.3.0","--stdio"],"extensionToLanguage":{".ts":"typescript"},"startupTimeout":60000}}' > "$proj/.lsp.json"
  printf '%s\n' '{"vtsls":{"startupTimeout":60000,"extensionToLanguage":{".ts":"typescript"},"args":["-y","@vtsls/language-server@0.3.0","--stdio"],"command":"npx"}}' > "$d/.lsp.json"
  run_audit "$proj" --fix
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.migratedFromRoot == true'
  [ ! -e "$proj/.lsp.json" ]
  jq -e '.vtsls.extensionToLanguage[".ts"] == "typescript"' "$d/.lsp.json"
}

@test "a failing root-file delete exits 1 with a clean diagnostic, plugin files kept" {
  [ "$(id -u)" -ne 0 ] || skip "root ignores directory permissions"
  local proj="$BATS_TEST_TMPDIR/p_unlink_fail"
  local d="$proj/.claude/skills/lsp"
  mkdir -p "$d/.claude-plugin"
  printf 'x\n' > "$proj/a.py"
  printf '{}\n' > "$d/.lsp.json"
  printf '{"name":"lsp"}\n' > "$d/.claude-plugin/plugin.json"
  cat > "$proj/.lsp.json" <<'JSON'
{ "pylsp": { "command": "pylsp", "args": [], "extensionToLanguage": { ".py": "python" }, "startupTimeout": 60000 } }
JSON
  chmod 555 "$proj"
  run_audit "$proj" --fix
  chmod 755 "$proj"
  [ "$status" -eq 1 ]
  [[ "$output" == *"could not delete"* ]]
  [[ "$output" != *"at Object."* ]]
  jq -e '.pylsp.extensionToLanguage[".py"] == "python"' "$d/.lsp.json"
}

@test "a plugin .lsp.json symlinked to the root file fails closed, root file kept" {
  local proj="$BATS_TEST_TMPDIR/p_symlink"
  local d="$proj/.claude/skills/lsp"
  mkdir -p "$d"
  printf 'x\n' > "$proj/a.py"
  cat > "$proj/.lsp.json" <<'JSON'
{ "pylsp": { "command": "pylsp", "args": [], "extensionToLanguage": { ".py": "python" }, "startupTimeout": 60000 } }
JSON
  cp "$proj/.lsp.json" "$BATS_TEST_TMPDIR/root.symlink.before"
  ln -s ../../../.lsp.json "$d/.lsp.json"
  run_audit "$proj" --fix
  [ "$status" -eq 1 ]
  cmp "$BATS_TEST_TMPDIR/root.symlink.before" "$proj/.lsp.json"
}

# --- lsp-audit orchestrator skill ---

@test "lsp-audit SKILL.md exists" {
  [ -f "$PLUGIN/skills/lsp-audit/SKILL.md" ]
}

@test "lsp-audit SKILL.md has name, description, argument-hint frontmatter" {
  local f="$PLUGIN/skills/lsp-audit/SKILL.md"
  run rg_or_grep -E '^name:[[:space:]]*lsp-audit' "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -E '^description:' "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -E '^argument-hint:' "$f"; [ "$status" -eq 0 ]
}

@test "lsp-audit is model-invocable (no disable-model-invocation)" {
  run rg_or_grep -E '^disable-model-invocation:[[:space:]]*true' "$PLUGIN/skills/lsp-audit/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "lsp-audit runs inline (no context: fork)" {
  run rg_or_grep -E '^context:[[:space:]]*fork' "$PLUGIN/skills/lsp-audit/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "lsp-audit gates via AskUserQuestion" {
  run rg_or_grep -F 'AskUserQuestion' "$PLUGIN/skills/lsp-audit/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "lsp-audit allowed-tools include Bash, Read, AskUserQuestion" {
  local f="$PLUGIN/skills/lsp-audit/SKILL.md"
  run rg_or_grep -E '^allowed-tools:.*Bash' "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -E '^allowed-tools:.*Read' "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -E '^allowed-tools:.*AskUserQuestion' "$f"; [ "$status" -eq 0 ]
}

@test "lsp-audit carries the review-skip justification for unscoped Bash" {
  run rg_or_grep -F 'review-skip(F1)' "$PLUGIN/skills/lsp-audit/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "lsp-audit has a Read step for audit-lsp.reference.md" {
  run rg_or_grep -F 'audit-lsp.reference.md' "$PLUGIN/skills/lsp-audit/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "lsp-audit references its bundled script via CLAUDE_SKILL_DIR" {
  run rg_or_grep -F '${CLAUDE_SKILL_DIR}/scripts/audit-lsp.mjs' "$PLUGIN/skills/lsp-audit/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "lsp-audit has no load-time !-injection trigger" {
  run rg_or_grep -nE '!`' "$PLUGIN/skills/lsp-audit/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "lsp-audit points at the cc-reference LSP schema doc, not a local restatement" {
  run rg_or_grep -F 'claude-code-plugins-lsp-reference.md' "$PLUGIN/skills/lsp-audit/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "lsp-audit SKILL.md targets the project-scope lsp plugin path" {
  run rg_or_grep -F '.claude/skills/lsp' "$PLUGIN/skills/lsp-audit/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "lsp-audit SKILL.md gates the legacy root migration on legacyRootLspJson" {
  local f="$PLUGIN/skills/lsp-audit/SKILL.md"
  run rg_or_grep -F 'legacyRootLspJson' "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -F 'migratedFromRoot' "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -F 'pluginManifestMissing' "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -F 'apply ""' "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -F 'lsp@skills-dir' "$f"; [ "$status" -eq 0 ]
}

# --- lsp-audit doc/manifest sync ---

@test "plugin.json version was bumped for lsp-audit (minor, off 1.7.11)" {
  run jq -r '.version' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [ "$output" != "1.7.11" ]
}

@test "plugin.json version was bumped for lsp-audit plugin target (minor, off 1.9.0)" {
  run jq -r '.version' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [ "$output" != "1.9.0" ]
}

@test "lsp-audit docs and manifest describe the project-scope lsp plugin target" {
  run rg_or_grep -F '.claude/skills/lsp' "$PLUGIN/CLAUDE.md"; [ "$status" -eq 0 ]
  run rg_or_grep -F '.claude/skills/lsp' "$PLUGIN/README.md"; [ "$status" -eq 0 ]
  run jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *".claude/skills/lsp/"* ]]
  [[ "$output" == *"lsp-audit"* ]]
  [[ "$output" == *"repository-audit"* ]]
  [[ "$output" == *"(CC docs read: "* ]]
}

@test "plugin.json description mentions lsp-audit" {
  run jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *"lsp-audit"* ]]
}

@test "claude-code-knowledge CLAUDE.md boundary rule lists lsp-audit" {
  run rg_or_grep -F 'lsp-audit' "$PLUGIN/CLAUDE.md"
  [ "$status" -eq 0 ]
}

@test "claude-code-knowledge README lists lsp-audit in the Skills table" {
  run rg_or_grep -F '`lsp-audit`' "$PLUGIN/README.md"
  [ "$status" -eq 0 ]
}

@test "root README plugin row mentions lsp-audit" {
  run rg_or_grep -F 'claude-code-knowledge](plugins/claude-code-knowledge/README.md)' "$REPO_ROOT/README.md"
  [ "$status" -eq 0 ]
  [[ "$output" == *"lsp-audit"* ]]
}

# --- cc-reference LSP docs: no project-root scope ---

@test "LSP reference documents no project-root scope and keeps one not-loaded directive" {
  local f="$REFS/claude-code-plugins-lsp-reference.md"
  run rg_or_grep -F 'Project-scoped' "$f"; [ "$status" -ne 0 ]
  run rg_or_grep -F 'has no path variable substitution' "$f"; [ "$status" -ne 0 ]
  run rg_or_grep -F 'is not loaded by Claude Code' "$f"; [ "$status" -eq 0 ]
}

@test "cc-reference SKILL.md LSP index carries no project-root scope or example" {
  run rg_or_grep -F 'project-scoped (undocumented' "$SKILL/SKILL.md"; [ "$status" -ne 0 ]
  run rg_or_grep -F 'Example (project-root' "$SKILL/SKILL.md"; [ "$status" -ne 0 ]
  run rg_or_grep -F 'Example (plugin-scoped .lsp.json)' "$SKILL/SKILL.md"; [ "$status" -eq 0 ]
  run rg_or_grep -F 'project-root .lsp.json not loaded' "$SKILL/SKILL.md"; [ "$status" -eq 0 ]
}

@test "update-cc-references preserves the LSP not-loaded directive" {
  run rg_or_grep -F 'project-root `.lsp.json` is not loaded' "$MAINT"
  [ "$status" -eq 0 ]
}

# --- repository-audit orchestrator skill ---

@test "repository-audit SKILL.md exists" {
  [ -f "$PLUGIN/skills/repository-audit/SKILL.md" ]
}

@test "repository-audit SKILL.md has name, description, argument-hint frontmatter" {
  local f="$PLUGIN/skills/repository-audit/SKILL.md"
  run rg_or_grep -E '^name:[[:space:]]*repository-audit' "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -E '^description:' "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -E '^argument-hint:' "$f"; [ "$status" -eq 0 ]
}

@test "repository-audit argument-hint begins with [--fix]" {
  run rg_or_grep -E '^argument-hint:[[:space:]]*\[--fix\]' "$PLUGIN/skills/repository-audit/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "repository-audit runs inline (no context: fork)" {
  run rg_or_grep -E '^context:[[:space:]]*fork' "$PLUGIN/skills/repository-audit/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "repository-audit is model-invocable (no disable-model-invocation)" {
  run rg_or_grep -E '^disable-model-invocation:[[:space:]]*true' "$PLUGIN/skills/repository-audit/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "repository-audit has no load-time !-injection trigger" {
  run rg_or_grep -nE '!`' "$PLUGIN/skills/repository-audit/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "repository-audit carries the AskUserQuestion mandate" {
  run rg_or_grep -F 'AskUserQuestion' "$PLUGIN/skills/repository-audit/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "repository-audit allowed-tools include Bash, Read, Skill, AskUserQuestion" {
  local f="$PLUGIN/skills/repository-audit/SKILL.md"
  run rg_or_grep -E '^allowed-tools:.*Bash' "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -E '^allowed-tools:.*Read' "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -E '^allowed-tools:.*Skill' "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -E '^allowed-tools:.*AskUserQuestion' "$f"; [ "$status" -eq 0 ]
}

@test "repository-audit carries the review-skip justification for unscoped Bash" {
  run rg_or_grep -F 'review-skip(F1)' "$PLUGIN/skills/repository-audit/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "repository-audit allowed-tools include Edit and Write for manual-task application" {
  local f="$PLUGIN/skills/repository-audit/SKILL.md"
  run rg_or_grep -E '^allowed-tools:.*Edit' "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -E '^allowed-tools:.*Write' "$f"; [ "$status" -eq 0 ]
}

@test "repository-audit offers memory-audit manual tasks via AskUserQuestion, auto-selected under --fix" {
  local f="$PLUGIN/skills/repository-audit/SKILL.md"
  run rg_or_grep -F "### Offer memory-audit" "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -F '`$FIX` set' "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -F 'multiSelect: true' "$f"; [ "$status" -eq 0 ]
}

@test "memory-audit report lists manual to-dos as id · path · recommendation lines" {
  run rg_or_grep -F '<id> · <path> · <recommendation>' "$PLUGIN/skills/memory-audit/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "repository-audit invokes both nested audits by qualified name" {
  local f="$PLUGIN/skills/repository-audit/SKILL.md"
  run rg_or_grep -F 'claude-code-knowledge:lsp-audit' "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -F 'claude-code-knowledge:memory-audit' "$f"; [ "$status" -eq 0 ]
}

# --- repository-audit doc/manifest sync ---

@test "plugin.json version was bumped for repository-audit (minor, off 1.8.3)" {
  run jq -r '.version' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [ "$output" != "1.8.3" ]
}

@test "plugin.json version was bumped for repository-audit manual-task selection (minor, off 1.10.0)" {
  run jq -r '.version' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [ "$output" != "1.10.0" ]
}

@test "plugin.json description mentions repository-audit" {
  run jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *"repository-audit"* ]]
}

@test "claude-code-knowledge CLAUDE.md boundary rule lists repository-audit" {
  run rg_or_grep -F 'repository-audit' "$PLUGIN/CLAUDE.md"
  [ "$status" -eq 0 ]
}

@test "claude-code-knowledge README lists repository-audit in the Skills table" {
  run rg_or_grep -F '`repository-audit`' "$PLUGIN/README.md"
  [ "$status" -eq 0 ]
}

@test "root README plugin row mentions repository-audit" {
  run rg_or_grep -F 'claude-code-knowledge](plugins/claude-code-knowledge/README.md)' "$REPO_ROOT/README.md"
  [ "$status" -eq 0 ]
  [[ "$output" == *"repository-audit"* ]]
}

# --- init-dev-environment template (templates/init-dev-environment/install.sh) ---
# Hermetic: install.sh runs under env -i on the MOCKBIN PATH with the isolated
# HOME and an explicit TMPDIR. No real curl is ever on that PATH, so a recipe
# that would hit the network fails fast instead. Stub bodies use $TMPDIR and
# $HOME, never $BATS_TEST_TMPDIR (env -i wipes it from stub processes).

install_sh() { printf '%s' "$PLUGIN/skills/repository-audit/templates/init-dev-environment/install.sh"; }

# run_install_sh <arg>... — run install.sh on the isolated MOCKBIN PATH/HOME/TMPDIR.
run_install_sh() {
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" "$MOCKBIN/bash" "$(install_sh)" "$@"
}

# link_tools <name>... — symlink extra host binaries into MOCKBIN for one test.
link_tools() {
  local t src
  for t in "$@"; do
    src="$(command -v "$t")" && ln -sf "$src" "$MOCKBIN/$t"
  done
}

# rustup_proxy_fixture — like rustup's real ~/.cargo/bin/rust-analyzer proxy,
# the stub exists without the component and exits 1 until $TMPDIR/ra.component
# exists; plus a ~/.cargo/bin/cargo stub that exits 0.
rustup_proxy_fixture() {
  local cb="$HOME/.cargo/bin"
  mkdir -p "$cb"
  printf '%s\n' '#!/usr/bin/env bash' \
    'if [ ! -e "$TMPDIR/ra.component" ]; then echo "error: Unknown binary rust-analyzer in official toolchain" >&2; exit 1; fi' \
    'echo "rust-analyzer 1.0.0"' > "$cb/rust-analyzer"
  printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$cb/cargo"
  chmod +x "$cb/rust-analyzer" "$cb/cargo"
}

@test "install.sh passes bash -n" {
  run bash -n "$(install_sh)"
  [ "$status" -eq 0 ]
}

@test "install.sh never uses sudo or touches shell rc files on a non-comment line" {
  [ -f "$(install_sh)" ]
  run bash -c "grep -v '^[[:space:]]*#' \"\$1\" | grep -nE 'sudo|\\.bashrc|\\.bash_profile|\\.zshrc|\\.profile'" _ "$(install_sh)"
  [ "$status" -ne 0 ]
}

@test "install.sh --dry-run reports present and missing tools and installs nothing" {
  run_install_sh --dry-run node pnpm
  [ "$status" -eq 0 ]
  [[ "$output" == *"present: node"* ]]
  [[ "$output" == *"missing: pnpm"* ]]
  [[ "$output" != *"note:"* ]]
  [ ! -e "$HOME/.local" ]
}

@test "install.sh --dry-run notes a present tool reachable only via the dirs it appended to PATH" {
  mkdir -p "$HOME/.local/bin"
  printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$HOME/.local/bin/pnpm"
  chmod +x "$HOME/.local/bin/pnpm"
  run_install_sh --dry-run node pnpm
  [ "$status" -eq 0 ]
  [[ "$output" == *"present: pnpm"* ]]
  [[ "$output" == *"note: not on PATH"*" pnpm;"* ]]
  [[ "$output" != *" node;"* ]]
}

@test "install.sh honours --dry-run in any argument position and installs nothing" {
  link_tools mkdir
  make_stub npm 'echo "$*" >> "$TMPDIR/npm.args"'
  run_install_sh node pnpm --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" == *"present: node"* ]]
  [[ "$output" == *"missing: pnpm"* ]]
  [[ "$output" != *"unknown tool id"* ]]
  [ ! -e "$BATS_TEST_TMPDIR/npm.args" ]
  [ ! -e "$HOME/.local" ]
}

@test "install.sh: an unknown tool id prints FAILED (unknown tool id) and exits 1" {
  run_install_sh nope
  [ "$status" -eq 1 ]
  [[ "$output" == *"FAILED: nope (unknown tool id)"* ]]
}

@test "install.sh installs pnpm via npm --prefix ~/.local and prints the PATH note" {
  link_tools mkdir chmod
  make_stub npm \
    'echo "$*" >> "$TMPDIR/npm.args"' \
    'printf "%s\n" "#!/usr/bin/env bash" > "$HOME/.local/bin/pnpm"' \
    'chmod +x "$HOME/.local/bin/pnpm"'
  run_install_sh pnpm
  [ "$status" -eq 0 ]
  [[ "$output" == *"present: node"* ]]
  [[ "$output" == *"installed: pnpm"* ]]
  [[ "$output" == *"note:"* ]]
  grep -qxF "install -g --prefix $HOME/.local pnpm" "$BATS_TEST_TMPDIR/npm.args"
}

@test "install.sh prints FAILED and exits 1 when the pnpm recipe fails" {
  link_tools mkdir
  make_stub npm 'exit 1'
  run_install_sh pnpm
  [ "$status" -eq 1 ]
  [[ "$output" == *"FAILED: pnpm"* ]]
}

@test "install.sh names npm when node is present without npm and the pnpm recipe cannot run" {
  link_tools mkdir
  run_install_sh pnpm
  [ "$status" -eq 1 ]
  [[ "$output" == *"present: node"* ]]
  [[ "$output" == *"npm not found"* ]]
  [[ "$output" == *"FAILED: pnpm"* ]]
}

@test "install.sh --dry-run treats a bare rustup rust-analyzer proxy as missing (D21)" {
  rustup_proxy_fixture
  run_install_sh --dry-run rust-analyzer
  [ "$status" -eq 0 ]
  [[ "$output" == *"missing: rust-analyzer"* ]]
  [[ "$output" != *"present: rust-analyzer"* ]]
  [ ! -e "$BATS_TEST_TMPDIR/rustup.args" ]
}

@test "install.sh adds the rust-analyzer component over the rustup proxy, then dry-run agrees (D21)" {
  rustup_proxy_fixture
  printf '%s\n' '#!/usr/bin/env bash' 'echo "$*" >> "$TMPDIR/rustup.args"' ': > "$TMPDIR/ra.component"' > "$HOME/.cargo/bin/rustup"
  chmod +x "$HOME/.cargo/bin/rustup"
  link_tools mkdir ln
  run_install_sh rust-analyzer
  [ "$status" -eq 0 ]
  [[ "$output" == *"present: cargo"* ]]
  [[ "$output" == *"installed: rust-analyzer"* ]]
  [ "$(cat "$BATS_TEST_TMPDIR/rustup.args")" = "component add rust-analyzer" ]
  [ -L "$HOME/.local/bin/rust-analyzer" ]
  [ "$(readlink "$HOME/.local/bin/rust-analyzer")" = "$HOME/.cargo/bin/rust-analyzer" ]
  run_install_sh --dry-run rust-analyzer
  [ "$status" -eq 0 ]
  [[ "$output" == *"present: rust-analyzer"* ]]
}

@test "install.sh --dry-run treats a rustup cargo proxy without a toolchain as missing" {
  local cb="$HOME/.cargo/bin"
  mkdir -p "$cb"
  printf '%s\n' '#!/usr/bin/env bash' 'echo "error: rustup could not choose a version of cargo to run" >&2' 'exit 1' > "$cb/cargo"
  chmod +x "$cb/cargo"
  run_install_sh --dry-run cargo
  [ "$status" -eq 0 ]
  [[ "$output" == *"missing: cargo"* ]]
  [[ "$output" != *"present: cargo"* ]]
}

@test "install.sh bootstraps rustup before the rust-analyzer component when only a distro cargo exists" {
  link_tools mkdir mktemp rm
  make_stub cargo 'exit 0'
  make_stub curl 'echo "$*" >> "$TMPDIR/curl.args"' 'exit 1'
  run_install_sh rust-analyzer
  [ "$status" -eq 1 ]
  [[ "$output" == *"present: cargo"* ]]
  [[ "$output" == *"FAILED: rust-analyzer"* ]]
  grep -qF "https://sh.rustup.rs" "$BATS_TEST_TMPDIR/curl.args"
}

@test "install.sh runs nothing and links nothing when the rustup download fails" {
  link_tools mkdir mktemp rm ln sh
  make_stub curl 'exit 1'
  run_install_sh cargo
  [ "$status" -eq 1 ]
  [[ "$output" == *"FAILED: cargo"* ]]
  [ ! -L "$HOME/.local/bin/cargo" ]
}

@test "install.sh installs uv by running the downloaded script with UV_INSTALL_DIR set" {
  link_tools mkdir mktemp rm chmod sh
  printf '%s\n' 'mkdir -p "$UV_INSTALL_DIR"' 'printf "#!/usr/bin/env bash\n" > "$UV_INSTALL_DIR/uv"' 'chmod +x "$UV_INSTALL_DIR/uv"' > "$BATS_TEST_TMPDIR/uv-install.sh"
  make_stub curl \
    'echo "$*" >> "$TMPDIR/curl.args"' \
    'while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out=$2; shift; done' \
    'cat "$TMPDIR/uv-install.sh" > "$out"'
  run_install_sh uv
  [ "$status" -eq 0 ]
  [[ "$output" == *"installed: uv"* ]]
  grep -qF "https://astral.sh/uv/install.sh" "$BATS_TEST_TMPDIR/curl.args"
  [ -x "$HOME/.local/bin/uv" ]
}

@test "install.sh installs yarn as a corepack shim in ~/.local/bin, not Classic via npm" {
  link_tools mkdir chmod
  make_stub npm 'echo "$*" >> "$TMPDIR/npm.args"'
  make_stub corepack \
    'echo "$*" >> "$TMPDIR/corepack.args"' \
    'printf "%s\n" "#!/usr/bin/env bash" > "$HOME/.local/bin/yarn"' \
    'chmod +x "$HOME/.local/bin/yarn"'
  run_install_sh yarn
  [ "$status" -eq 0 ]
  [[ "$output" == *"installed: yarn"* ]]
  [ "$(cat "$BATS_TEST_TMPDIR/corepack.args")" = "enable --install-directory $HOME/.local/bin yarn" ]
  [ ! -e "$BATS_TEST_TMPDIR/npm.args" ]
}

@test "install.sh fetches corepack through npm when it is missing, then enables the yarn shim" {
  link_tools mkdir chmod
  printf '%s\n' '#!/usr/bin/env bash' 'echo "$*" >> "$TMPDIR/corepack.args"' 'printf "#!/usr/bin/env bash\n" > "$HOME/.local/bin/yarn"' 'chmod +x "$HOME/.local/bin/yarn"' > "$BATS_TEST_TMPDIR/corepack.sh"
  make_stub npm \
    'echo "$*" >> "$TMPDIR/npm.args"' \
    'cat "$TMPDIR/corepack.sh" > "$HOME/.local/bin/corepack"' \
    'chmod +x "$HOME/.local/bin/corepack"'
  run_install_sh yarn
  [ "$status" -eq 0 ]
  [[ "$output" == *"installed: yarn"* ]]
  [ "$(cat "$BATS_TEST_TMPDIR/npm.args")" = "install -g --prefix $HOME/.local corepack" ]
  [ "$(cat "$BATS_TEST_TMPDIR/corepack.args")" = "enable --install-directory $HOME/.local/bin yarn" ]
}

@test "install.sh node honours a numeric .nvmrc pin, falls back to the newest LTS, and fails on an unmatched pin" {
  local proj="$BATS_TEST_TMPDIR/p_node" d
  d="$proj/.claude/skills/init-dev-environment"
  mkdir -p "$d"
  cp "$(install_sh)" "$d/install.sh"
  {
    printf 'version\tdate\tfiles\tnpm\tv8\tuv\tzlib\topenssl\tmodules\tlts\tsecurity\n'
    printf '%s\t2024-01-01\tf\tn\tv\tu\tz\to\tm\t%s\t-\n' v22.5.0 - v20.11.1 Iron v18.19.1 Hydrogen v18.19.0 Hydrogen
  } > "$BATS_TEST_TMPDIR/index.tab"
  link_tools mkdir uname tr awk mktemp rm dirname
  rm -f "$MOCKBIN/node"
  make_stub curl 'case "$*" in *index.tab*) cat "$TMPDIR/index.tab" ;; *) echo "$*" >> "$TMPDIR/curl.args"; exit 1 ;; esac'
  printf 'v18\n' > "$proj/.nvmrc"
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" "$MOCKBIN/bash" "$d/install.sh" node
  [ "$status" -eq 1 ]
  grep -qF "https://nodejs.org/dist/v18.19.1/node-v18.19.1-" "$BATS_TEST_TMPDIR/curl.args"
  rm -f "$BATS_TEST_TMPDIR/curl.args"
  printf 'lts/*\n' > "$proj/.nvmrc"
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" "$MOCKBIN/bash" "$d/install.sh" node
  [ "$status" -eq 1 ]
  grep -qF "https://nodejs.org/dist/v20.11.1/node-v20.11.1-" "$BATS_TEST_TMPDIR/curl.args"
  rm -f "$BATS_TEST_TMPDIR/curl.args"
  printf '99\n' > "$proj/.nvmrc"
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" "$MOCKBIN/bash" "$d/install.sh" node
  [ "$status" -eq 1 ]
  [[ "$output" == *"no Node release matches the project's pin: 99"* ]]
  [[ "$output" == *"FAILED: node"* ]]
  [ ! -e "$BATS_TEST_TMPDIR/curl.args" ]
}

# --- repository-audit tool detection (scripts/detect-tools.mjs) ---
# Hermetic: the detector spawns no child process (pure fs), so tests call the
# real `node` directly against temp project dirs under $BATS_TEST_TMPDIR.

detect_script() { printf '%s' "$PLUGIN/skills/repository-audit/scripts/detect-tools.mjs"; }
run_detect() { run node "$(detect_script)" "$@"; }

# detect_fixture <dir> — package.json, pnpm-lock.yaml and sub/Cargo.toml signal
# files; a root .lsp.json using gopls and npx; a root .mcp.json using docker,
# git, curl and a project-local ${CLAUDE_PLUGIN_ROOT} launcher path.
detect_fixture() {
  mkdir -p "$1/sub"
  printf '{}\n' > "$1/package.json"
  printf 'lockfileVersion: 9.0\n' > "$1/pnpm-lock.yaml"
  printf '[package]\n' > "$1/sub/Cargo.toml"
  printf '%s\n' '{"gopls":{"command":"gopls"},"ts":{"command":"npx"}}' > "$1/.lsp.json"
  printf '%s\n' '{"mcpServers":{"d":{"command":"docker"},"g":{"command":"git"},"c":{"command":"curl"},"x":{"command":"${CLAUDE_PLUGIN_ROOT}/bin/x"}}}' > "$1/.mcp.json"
}

@test "detect-tools.mjs exists and passes node --check" {
  local s; s="$(detect_script)"
  [ -f "$s" ]
  run node --check "$s"
  [ "$status" -eq 0 ]
}

@test "tool-map.json is valid JSON with the expected catalog shape" {
  local m="$PLUGIN/skills/repository-audit/scripts/tool-map.json"
  run jq empty "$m"
  [ "$status" -eq 0 ]
  run jq -e 'all(.[]; (.files|type=="array") and (.commands|type=="array") and all(.files[], .commands[]; type=="string"))' "$m"
  [ "$status" -eq 0 ]
  run jq -e '[.[].commands[]] | length == (unique|length)' "$m"
  [ "$status" -eq 0 ]
  run jq -e '[.[].commands[]] | any(. == "git" or . == "bash" or . == "sh" or . == "curl" or . == "claude") | not' "$m"
  [ "$status" -eq 0 ]
}

@test "detection: signal files and config commands map to catalog tools and manual to-dos" {
  local proj="$BATS_TEST_TMPDIR/p_detect"
  detect_fixture "$proj"
  run_detect "$proj"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '[.tools[].id] == ["node","pnpm","cargo","gopls"]'
  echo "$output" | jq -e '.tools[] | select(.id=="cargo") | .evidence | index("sub/Cargo.toml") != null'
  echo "$output" | jq -e '(.tools[] | select(.id=="node") | .evidence) == ["package.json", ".lsp.json: npx"]'
  echo "$output" | jq -e '.manual | map(.command) == ["docker"]'
  echo "$output" | jq -e '.skillExists == false'
  # git, curl (assumed present) and the path command appear nowhere
  echo "$output" | jq -e '[.tools, .manual | .. | strings | select(test("git|curl|CLAUDE_PLUGIN_ROOT"))] | length == 0'
}

@test "detection: command names outside the token regex are dropped; lookups are Map-only" {
  local proj="$BATS_TEST_TMPDIR/p_tokens"
  mkdir -p "$proj"
  local long; long="$(printf 'a%.0s' {1..65})"
  jq -n --arg long "$long" '{mcpServers: {a: {command: "x`id`"}, b: {command: "a b"}, c: {command: $long}, d: {command: "constructor"}}}' > "$proj/.mcp.json"
  run_detect "$proj"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.tools == []'
  echo "$output" | jq -e '.manual | map(.command) == ["constructor"]'
}

@test "detection: pruned directories contribute nothing" {
  local proj="$BATS_TEST_TMPDIR/p_tprune"
  mkdir -p "$proj/node_modules/x" "$proj/.claude/worktrees/w"
  printf 'module x\n' > "$proj/node_modules/x/go.mod"
  printf '[package]\n' > "$proj/.claude/worktrees/w/Cargo.toml"
  run_detect "$proj"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.tools == [] and .manual == []'
}

@test "detection: virtualenv, tox and build-output directories contribute nothing" {
  local proj="$BATS_TEST_TMPDIR/p_venv"
  mkdir -p "$proj/.venv/lib/jup" "$proj/venv/x" "$proj/target/y" "$proj/.tox/py3" "$proj/src/site-packages/z"
  printf '{}\n' > "$proj/.venv/lib/jup/package.json"
  printf '{}\n' > "$proj/venv/x/package.json"
  printf '[package]\n' > "$proj/target/y/Cargo.toml"
  printf 'x\n' > "$proj/.tox/py3/requirements.txt"
  printf '{}\n' > "$proj/src/site-packages/z/package.json"
  printf 'x\n' > "$proj/requirements.txt"
  run_detect "$proj"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '[.tools[].id] == ["python3"]'
}

@test "detection: a python launcher command maps to python, python3 to python3" {
  local proj="$BATS_TEST_TMPDIR/p_pylauncher"
  mkdir -p "$proj"
  printf '%s\n' '{"mcpServers":{"a":{"command":"python"}}}' > "$proj/.mcp.json"
  run_detect "$proj"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '[.tools[].id] == ["python"]'
  printf '%s\n' '{"mcpServers":{"a":{"command":"python3"}}}' > "$proj/.mcp.json"
  run_detect "$proj"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '[.tools[].id] == ["python3"]'
}

@test "detection: LSP server commands in the lsp plugin's .lsp.json (.claude/skills/lsp/) count" {
  local proj="$BATS_TEST_TMPDIR/p_lspplugin"
  mkdir -p "$proj/.claude/skills/lsp"
  printf '%s\n' '{"go":{"command":"gopls"},"py":{"command":"pylsp"}}' > "$proj/.claude/skills/lsp/.lsp.json"
  run_detect "$proj"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '[.tools[].id] == ["gopls","pylsp"]'
  echo "$output" | jq -e '(.tools[] | select(.id=="gopls") | .evidence) == [".claude/skills/lsp/.lsp.json: gopls"]'
  printf '%s' '{ not valid' > "$proj/.claude/skills/lsp/.lsp.json"
  run_detect "$proj"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Malformed"*".lsp.json"* ]]
}

@test "detection: an empty project reports nothing, in the canonical JSON format" {
  local proj="$BATS_TEST_TMPDIR/p_empty"
  mkdir -p "$proj"
  run_detect "$proj"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.tools == [] and .manual == [] and .skillExists == false'
  node "$(detect_script)" "$proj" > "$BATS_TEST_TMPDIR/out.json"
  run node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8");process.exit(t===JSON.stringify(JSON.parse(t),null,2)+"\n"?0:1)' "$BATS_TEST_TMPDIR/out.json"
  [ "$status" -eq 0 ]
}

@test "detection: malformed .mcp.json or non-object .lsp.json exits 1 and --write creates nothing" {
  local proj="$BATS_TEST_TMPDIR/p_badcfg"
  mkdir -p "$proj"
  printf '{}\n' > "$proj/package.json"
  printf '%s' '{ not valid json' > "$proj/.mcp.json"
  run_detect "$proj"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Malformed"*".mcp.json"* ]]
  run_detect "$proj" --write
  [ "$status" -eq 1 ]
  [ ! -e "$proj/.claude/skills" ]
  rm "$proj/.mcp.json"
  printf '[]\n' > "$proj/.lsp.json"
  run_detect "$proj"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Malformed"*".lsp.json"*"an array"* ]]
}

# --- init-dev-environment generation (detect-tools.mjs --write, SKILL.md.tmpl) ---

@test "detect-tools.reference.md exists and documents the script and its bundled templates" {
  local r="$PLUGIN/skills/repository-audit/scripts/detect-tools.reference.md"
  [ -f "$r" ]
  run rg_or_grep -F 'detect-tools.mjs' "$r"; [ "$status" -eq 0 ]
  run rg_or_grep -F 'install.sh' "$r"; [ "$status" -eq 0 ]
  run rg_or_grep -F 'Bundled templates' "$r"; [ "$status" -eq 0 ]
}

@test "--write creates the init-dev-environment skill atomically (0755, byte-identical install.sh)" {
  local proj="$BATS_TEST_TMPDIR/p_write"
  detect_fixture "$proj"
  [ ! -e "$proj/.claude" ]
  run_detect "$proj" --write
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.wrote == true and .skillsDirCreated == true'
  local d="$proj/.claude/skills/init-dev-environment"
  [ -f "$d/SKILL.md" ]
  [ -f "$d/install.sh" ]
  cmp "$d/install.sh" "$(install_sh)"
  rg_or_grep -qF 'name: init-dev-environment' "$d/SKILL.md"
  rg_or_grep -qF 'install.sh --dry-run node pnpm cargo gopls' "$d/SKILL.md"
  rg_or_grep -qF '(install manually): docker' "$d/SKILL.md"
  run rg_or_grep -F '@@' "$d/SKILL.md"; [ "$status" -ne 0 ]
  run rg_or_grep -nE '!`' "$d/SKILL.md"; [ "$status" -ne 0 ]
  run node -e 'process.stdout.write((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$d"
  [ "$output" = "755" ]
  run bash -c 'ls -d "$1"/.claude/.init-dev-environment-* "$1"/.claude/skills/.init-dev-environment-* 2>/dev/null' _ "$proj"
  [ -z "$output" ]
}

@test "--write next to an existing .claude/skills reports skillsDirCreated false" {
  local proj="$BATS_TEST_TMPDIR/p_write_existing"
  detect_fixture "$proj"
  mkdir -p "$proj/.claude/skills/other"
  run_detect "$proj" --write
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.wrote == true and .skillsDirCreated == false'
  [ -f "$proj/.claude/skills/init-dev-environment/SKILL.md" ]
}

@test "--write never overwrites an existing init-dev-environment directory" {
  local proj="$BATS_TEST_TMPDIR/p_write_kept"
  detect_fixture "$proj"
  mkdir -p "$proj/.claude/skills/init-dev-environment"
  printf 'hand edit\n' > "$proj/.claude/skills/init-dev-environment/SKILL.md"
  run_detect "$proj" --write
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.skillExists == true and .wrote == false and .skillsDirCreated == false'
  [ "$(cat "$proj/.claude/skills/init-dev-environment/SKILL.md")" = "hand edit" ]
  [ ! -e "$proj/.claude/skills/init-dev-environment/install.sh" ]
}

@test "--write with no detected tools writes nothing" {
  local proj="$BATS_TEST_TMPDIR/p_write_none"
  mkdir -p "$proj"
  run_detect "$proj" --write
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.tools == [] and .wrote == false and .skillsDirCreated == false'
  [ ! -e "$proj/.claude" ]
}

@test "--add extends an existing skill with only the confirmed missing ids, byte-identical to a fresh generation" {
  local proj="$BATS_TEST_TMPDIR/p_add" fresh="$BATS_TEST_TMPDIR/p_add_fresh"
  local d="$BATS_TEST_TMPDIR/p_add/.claude/skills/init-dev-environment"
  mkdir -p "$proj"
  printf '{}\n' > "$proj/package.json"
  printf 'lockfileVersion: 9.0\n' > "$proj/pnpm-lock.yaml"
  run_detect "$proj" --write
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.wrote == true and .missingTools == null'
  run_detect "$proj"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.skillExists == true and .missingTools == []'
  detect_fixture "$proj"
  printf 'old\n' > "$d/install.sh"
  chmod 755 "$d/install.sh"
  printf 'keep\n' > "$d/notes.md"
  run_detect "$proj"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.missingTools == ["cargo","gopls"]'
  run_detect "$proj" --add "gopls,yarn,docker,node,constructor"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.added == ["gopls"]'
  rg_or_grep -qF 'install.sh --dry-run node pnpm gopls' "$d/SKILL.md"
  cmp "$d/install.sh" "$(install_sh)"
  run node -e 'process.stdout.write((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$d/install.sh"
  [ "$output" = "755" ]
  [ "$(cat "$d/notes.md")" = "keep" ]
  run bash -c 'ls -d "$1"/.claude/.init-dev-environment-* "$1"/.claude/skills/.init-dev-environment-* 2>/dev/null' _ "$proj"
  [ -z "$output" ]
  run rg_or_grep -F '@@' "$d/SKILL.md"; [ "$status" -ne 0 ]
  run_detect "$proj" --add cargo
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.added == ["cargo"]'
  run_detect "$proj"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.missingTools == []'
  detect_fixture "$fresh"
  run_detect "$fresh" --write
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.wrote == true'
  cmp "$d/SKILL.md" "$fresh/.claude/skills/init-dev-environment/SKILL.md"
}

@test "--add leaves an unreadable or absent skill untouched" {
  local proj="$BATS_TEST_TMPDIR/p_add_kept"
  local d="$BATS_TEST_TMPDIR/p_add_kept/.claude/skills/init-dev-environment"
  local injected='    bash ${CLAUDE_SKILL_DIR}/install.sh --dry-run node $(id)'
  detect_fixture "$proj"
  mkdir -p "$d"
  printf 'hand edit\n' > "$d/SKILL.md"
  run_detect "$proj"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.skillExists == true and .missingTools == null'
  run_detect "$proj" --add "node,cargo"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.added == []'
  [ "$(cat "$d/SKILL.md")" = "hand edit" ]
  [ ! -e "$d/install.sh" ]
  printf '%s\n' "$injected" > "$d/SKILL.md"
  run_detect "$proj"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.missingTools == null'
  run_detect "$proj" --add node
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.added == []'
  [ "$(cat "$d/SKILL.md")" = "$injected" ]
  rm -rf "$d"
  run_detect "$proj" --add node
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.added == [] and .skillExists == false'
  [ ! -e "$d" ]
}

@test "--add does not swallow a following flag or project-root path as its id list" {
  local proj="$BATS_TEST_TMPDIR/p_add_argv"
  local d="$BATS_TEST_TMPDIR/p_add_argv/.claude/skills/init-dev-environment"
  mkdir -p "$proj"
  printf '{}\n' > "$proj/package.json"
  run_detect "$proj" --write
  [ "$status" -eq 0 ]
  detect_fixture "$proj"
  # `--add <root>`: the path stays the project root, the list is empty
  run_detect --add "$proj"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e --arg r "$proj" '.root == $r and .missingTools == ["pnpm","cargo","gopls"] and .added == []'
  # `<root> --add --write`: --write is still parsed as a flag
  run_detect "$proj" --add --write
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.added == [] and .wrote == false and .skillsDirCreated == false'
  grep -qxF '    bash ${CLAUDE_SKILL_DIR}/install.sh --dry-run node' "$d/SKILL.md"
}

@test "--add exits 1 on malformed config or a failed replace, leaving the skill untouched and no temp dir" {
  local proj="$BATS_TEST_TMPDIR/p_add_fail"
  local d="$BATS_TEST_TMPDIR/p_add_fail/.claude/skills/init-dev-environment"
  mkdir -p "$proj"
  printf '{}\n' > "$proj/package.json"
  run_detect "$proj" --write
  [ "$status" -eq 0 ]
  detect_fixture "$proj"
  local before; before="$(cat "$d/SKILL.md")"
  # malformed .mcp.json: detect() throws before any write
  cp "$proj/.mcp.json" "$BATS_TEST_TMPDIR/mcp.good"
  printf '%s' '{ not valid json' > "$proj/.mcp.json"
  run_detect "$proj" --add pnpm
  [ "$status" -eq 1 ]
  [[ "$output" == *"Malformed"*".mcp.json"* ]]
  [ "$(cat "$d/SKILL.md")" = "$before" ]
  cp "$BATS_TEST_TMPDIR/mcp.good" "$proj/.mcp.json"
  # malformed .lsp.json (non-object) fails the same way
  printf '[]\n' > "$proj/.lsp.json"
  run_detect "$proj" --add pnpm
  [ "$status" -eq 1 ]
  [[ "$output" == *"Malformed"*".lsp.json"* ]]
  [ "$(cat "$d/SKILL.md")" = "$before" ]
  printf '%s\n' '{"gopls":{"command":"gopls"}}' > "$proj/.lsp.json"
  # replace failure: install.sh is swapped first, so a non-empty directory in
  # its place fails the first rename and SKILL.md must stay as it was
  rm "$d/install.sh"
  mkdir -p "$d/install.sh"
  printf 'x\n' > "$d/install.sh/blocker"
  run_detect "$proj" --add pnpm
  [ "$status" -eq 1 ]
  [[ "$output" == *"Failed to update"* ]]
  [ "$(cat "$d/SKILL.md")" = "$before" ]
  [ -f "$d/install.sh/blocker" ]
  run bash -c 'ls -d "$1"/.claude/.init-dev-environment-* "$1"/.claude/skills/.init-dev-environment-* 2>/dev/null' _ "$proj"
  [ -z "$output" ]
}

@test "SKILL.md.tmpl: frontmatter, model-invocable, inline, no bang-backtick or plugin-root token" {
  local t="$PLUGIN/skills/repository-audit/templates/init-dev-environment/SKILL.md.tmpl"
  [ -f "$t" ]
  run rg_or_grep -E '^name:[[:space:]]*init-dev-environment$' "$t"; [ "$status" -eq 0 ]
  run rg_or_grep -E '^description:' "$t"; [ "$status" -eq 0 ]
  run rg_or_grep -E '^description:.*: ' "$t"; [ "$status" -ne 0 ]
  run rg_or_grep -E '^disable-model-invocation:[[:space:]]*true' "$t"; [ "$status" -ne 0 ]
  run rg_or_grep -E '^context:[[:space:]]*fork' "$t"; [ "$status" -ne 0 ]
  run rg_or_grep -nE '!`' "$t"; [ "$status" -ne 0 ]
  run rg_or_grep -F 'CLAUDE_PLUGIN_ROOT' "$t"; [ "$status" -ne 0 ]
  run rg_or_grep -F 'AskUserQuestion' "$t"; [ "$status" -eq 0 ]
  run rg_or_grep -F '@@TOOLS@@' "$t"; [ "$status" -eq 0 ]
  run rg_or_grep -F 'run_in_background' "$t"; [ "$status" -eq 0 ]
}

@test "tool-map.json ids each have an install_<id> recipe in install.sh" {
  local m="$PLUGIN/skills/repository-audit/scripts/tool-map.json" s id fn
  s="$(install_sh)"
  for id in $(jq -r 'keys_unsorted[]' "$m"); do
    fn="install_${id//-/_}"
    rg_or_grep -qE "^${fn}\(\)" "$s" || { echo "missing recipe: $fn"; return 1; }
  done
}

# --- repository-audit tool-detection phase (SKILL.md steps 5-7) ---

@test "repository-audit wires the tool-detection phase and the Dev environment report section" {
  local f="$PLUGIN/skills/repository-audit/SKILL.md" tok
  for tok in 'init-dev-environment' 'detect-tools.reference.md' '${CLAUDE_SKILL_DIR}/scripts/detect-tools.mjs' '--write' '--add' 'skillExists' 'missingTools' 'skillsDirCreated' 'Dev environment' 'Dev tool' 'multiSelect: false'; do
    rg_or_grep -qF -- "$tok" "$f" || { echo "missing: $tok"; return 1; }
  done
  [ "$(wc -l < "$f")" -lt 500 ]
}

# --- init-dev-environment doc/manifest sync ---

@test "plugin.json version was bumped for init-dev-environment (minor, off 1.9.0)" {
  run jq -r '.version' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [ "$output" != "1.9.0" ]
}

@test "plugin.json version was bumped for init-dev-environment coverage check (minor, off 1.11.0)" {
  run jq -r '.version' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [ "$output" != "1.11.0" ]
}

@test "plugin.json description mentions init-dev-environment" {
  run jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *"init-dev-environment"* ]]
}

@test "claude-code-knowledge CLAUDE.md boundary rule mentions init-dev-environment" {
  run rg_or_grep -F 'init-dev-environment' "$PLUGIN/CLAUDE.md"
  [ "$status" -eq 0 ]
}

@test "claude-code-knowledge README mentions init-dev-environment" {
  run rg_or_grep -F 'init-dev-environment' "$PLUGIN/README.md"
  [ "$status" -eq 0 ]
}

@test "root README plugin row mentions init-dev-environment" {
  run rg_or_grep -F 'claude-code-knowledge](plugins/claude-code-knowledge/README.md)' "$REPO_ROOT/README.md"
  [ "$status" -eq 0 ]
  [[ "$output" == *"init-dev-environment"* ]]
}
