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

# --- cc-memory orchestrator skill ---

@test "cc-memory SKILL.md exists" {
  [ -f "$PLUGIN/skills/cc-memory/SKILL.md" ]
}

@test "cc-memory SKILL.md has name and argument-hint frontmatter" {
  run rg_or_grep -E '^name:[[:space:]]*cc-memory' "$PLUGIN/skills/cc-memory/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E '^argument-hint:' "$PLUGIN/skills/cc-memory/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-memory runs inline (NOT context: fork)" {
  run rg_or_grep -E '^context:[[:space:]]*fork' "$PLUGIN/skills/cc-memory/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "cc-memory reuses cc-reviewer with component_type memory" {
  run rg_or_grep -F 'cc-reviewer' "$PLUGIN/skills/cc-memory/SKILL.md"
  [ "$status" -eq 0 ]
  run rg_or_grep -E 'component_type:[[:space:]]*memory' "$PLUGIN/skills/cc-memory/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-memory SKILL.md points at analysis-workflow.md" {
  run rg_or_grep -F '${CLAUDE_SKILL_DIR}/analysis-workflow.md' "$PLUGIN/skills/cc-memory/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-memory gates application through AskUserQuestion" {
  run rg_or_grep -F 'AskUserQuestion' "$PLUGIN/skills/cc-memory/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-memory discovery is runtime Bash, not load-time !-injection" {
  run rg_or_grep -nE '!`' "$PLUGIN/skills/cc-memory/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "cc-memory is model-invocable (no disable-model-invocation)" {
  run rg_or_grep -E '^disable-model-invocation:[[:space:]]*true' "$PLUGIN/skills/cc-memory/SKILL.md"
  [ "$status" -ne 0 ]
}

@test "cc-memory is cc-reference-grounded" {
  run rg_or_grep -F 'cc-reference' "$PLUGIN/skills/cc-memory/SKILL.md"
  [ "$status" -eq 0 ]
}

@test "cc-memory analysis-workflow.md dispatch prompt asks reviewer for leanness/split findings" {
  local f="$PLUGIN/skills/cc-memory/analysis-workflow.md"
  run rg_or_grep -F 'leanness' "$f";            [ "$status" -eq 0 ]
  run rg_or_grep -F 'splittab' "$f";            [ "$status" -eq 0 ]
  run rg_or_grep -F '.claude/rules/' "$f";      [ "$status" -eq 0 ]
  run rg_or_grep -E '\bpaths:' "$f";            [ "$status" -eq 0 ]
  run rg_or_grep -F 'uncovered: false' "$f";    [ "$status" -eq 0 ]
  run rg_or_grep -iF 'never `high`' "$f";       [ "$status" -eq 0 ]
}

@test "cc-memory report has claude-md-improver-style summary + per-file blocks" {
  local f="$PLUGIN/skills/cc-memory/SKILL.md"
  run rg_or_grep -F '### Summary' "$f";                  [ "$status" -eq 0 ]
  run rg_or_grep -F 'Recommended actions' "$f";          [ "$status" -eq 0 ]
  run rg_or_grep -iF 'files needing update' "$f";        [ "$status" -eq 0 ]
}

@test "cc-memory default scope discovers CLAUDE.md and .claude/rules files" {
  local f="$PLUGIN/skills/cc-memory/SKILL.md"
  run rg_or_grep -F "name CLAUDE.md -o -path '*/.claude/rules/*.md'" "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -F '.claude/rules/*.md' "$f";                            [ "$status" -eq 0 ]
}

@test "plugin.json description mentions the authoring capability" {
  run jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *"author"* ]]
}

# --- cc-memory analysis-workflow (Workflow refactor) ---

@test "cc-memory analysis-workflow.md reference file exists and is non-empty" {
  [ -s "$PLUGIN/skills/cc-memory/analysis-workflow.md" ]
}

@test "cc-memory analysis-workflow.md defines the Workflow script (Analyze + Aggregate phases, schemas, computeGrade backfill)" {
  local f="$PLUGIN/skills/cc-memory/analysis-workflow.md"
  run rg_or_grep -F "phase('Analyze')" "$f";     [ "$status" -eq 0 ]
  run rg_or_grep -F "phase('Aggregate')" "$f";    [ "$status" -eq 0 ]
  run rg_or_grep -F 'FINDINGS_SCHEMA' "$f";       [ "$status" -eq 0 ]
  run rg_or_grep -F 'AGGREGATE_SCHEMA' "$f";      [ "$status" -eq 0 ]
  run rg_or_grep -F 'computeGrade' "$f";          [ "$status" -eq 0 ]
  run rg_or_grep -iF 'Agent-tool fallback' "$f";  [ "$status" -eq 0 ]
}

@test "cc-memory analysis-workflow.md pins both agent() call sites to sonnet" {
  local f="$PLUGIN/skills/cc-memory/analysis-workflow.md"
  run rg_or_grep -F "schema: FINDINGS_SCHEMA, model: 'sonnet'" "$f";  [ "$status" -eq 0 ]
  run rg_or_grep -F "schema: AGGREGATE_SCHEMA, model: 'sonnet'" "$f"; [ "$status" -eq 0 ]
}

@test "cc-memory analysis-workflow.md backfill keeps manual to-dos and computes summary in code" {
  local f="$PLUGIN/skills/cc-memory/analysis-workflow.md"
  run rg_or_grep -F 'recommendedActions: covered.map(f => f.recommendation)' "$f"; [ "$status" -eq 0 ]
  run rg_or_grep -F 'const filesNeedingUpdate =' "$f";                            [ "$status" -eq 0 ]
  run rg_or_grep -F 'const filesFailed =' "$f";                                   [ "$status" -eq 0 ]
  run rg_or_grep -F "label: 'aggregate:retry'" "$f";                              [ "$status" -eq 0 ]
}

@test "plugin.json version was bumped for cc-memory Workflow refactor (patch)" {
  run jq -r '.version' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
  [ "$output" != "1.7.3" ]
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
  [ "$output" != "1.7.8" ]
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

@test "cc-memory skill has no context-mode reference" {
  [ -f "$PLUGIN/skills/cc-memory/SKILL.md" ]
  run rg_or_grep -c "context-mode" "$PLUGIN/skills/cc-memory/SKILL.md"
  [ "$status" -eq 1 ]
}
