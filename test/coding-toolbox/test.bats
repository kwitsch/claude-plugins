#!/usr/bin/env bats

# Tests for the coding-toolbox plugin (golden behavior rules hooks).

setup() {
  bats_require_minimum_version 1.5.0
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/coding-toolbox"
  HOOKS="$PLUGIN/hooks"
  SCRIPTS="$PLUGIN/bin"

  # Isolated PATH: required system tools only, stubs are added per test.
  MOCKBIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$MOCKBIN"
  for t in bash env grep timeout sleep mktemp cat rm mkdir awk; do
    src="$(command -v "$t")" && [ -n "$src" ] && ln -s "$src" "$MOCKBIN/$t"
  done

  # Isolated HOME so no test reads real user config.
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME"
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

# Regression guard: the detection must compare by inode (-ef), never string
# equality. From a subdirectory --git-dir is absolute and --git-common-dir is
# relative, so a raw '=' wrongly flags the main worktree as a linked one.
@test "fresh-branch worktree detection compares git-dir by inode, not string equality" {
  run grep -F -- '-ef "$(git rev-parse --git-common-dir)"' "$PLUGIN/skills/fresh-branch/SKILL.md"
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

@test "plugin README lists fresh-branch in a Skills section" {
  run grep -F '| `fresh-branch`' "$PLUGIN/README.md"
  assert_success
}

@test "fresh-branch treats zero args as a universal refresh, not a non-worktree usage error" {
  run grep -F 'if [ "$#" -eq 0 ]; then' "$PLUGIN/skills/fresh-branch/SKILL.md"
  assert_success
}

#
# ci-watch.sh
#
# Stubs mirror REAL CLI behavior: gh pr checks exits 0 all-pass, 1 when a
# check failed OR no checks are reported (stderr message, empty stdout),
# 8 while any check is pending — data goes to stdout regardless. glab ci
# get separates `status:` from its value with a TAB in text mode and
# supports --output json on current versions.

# make_stub <name> <body-line>... — drop an executable stub into MOCKBIN.
make_stub() {
  local name="$1"; shift
  rm -f "$MOCKBIN/$name"
  { printf '#!/usr/bin/env bash\n'; printf '%s\n' "$@"; } > "$MOCKBIN/$name"
  chmod +x "$MOCKBIN/$name"
}

# run_ci_watch <platform> <ref> — run ci-watch.sh on the isolated PATH with
# test-friendly timing (no sleep between polls, 2 s overall deadline).
run_ci_watch() {
  run env -i PATH="$MOCKBIN" HOME="$HOME" STATE_DIR="$BATS_TEST_TMPDIR" \
    CI_WATCH_INTERVAL=0 CI_WATCH_TIMEOUT=2 \
    bash "$SCRIPTS/ci-watch.sh" "$@"
}

@test "ci-watch: usage error without arguments" {
  run_ci_watch
  assert_failure 64
  assert_output --partial "usage"
}

@test "ci-watch: usage error on unknown platform" {
  run_ci_watch bitbucket 5
  assert_failure 64
  assert_output --partial "usage"
}

@test "ci-watch: exit 64 when the platform CLI is not installed" {
  run_ci_watch github 5
  assert_failure 64
  assert_output --partial "not installed"
}

@test "ci-watch: exit 64 when timeout is not installed" {
  # gh present so the CLI check passes; timeout absent so its dependency
  # check must fire before any poll (a missing timeout would otherwise spin
  # to the deadline and exit 2, not surface the environment error).
  make_stub gh 'printf "pass\tbuild\n"; exit 0'
  rm -f "$MOCKBIN/timeout"
  run_ci_watch github 5
  assert_failure 64
  assert_output --partial "timeout not installed"
}

@test "ci-watch: github green when all real checks pass" {
  make_stub gh 'printf "pass\tbuild\npass\ttest\n"; exit 0'
  run_ci_watch github 5
  assert_success
}

@test "ci-watch: github passes the expected gh arguments" {
  make_stub gh 'echo "$*" > "$STATE_DIR/gh-args"; printf "pass\tbuild\n"; exit 0'
  run_ci_watch github 5
  assert_success
  run cat "$BATS_TEST_TMPDIR/gh-args"
  assert_output --partial "pr checks 5 --json name,bucket"
}

@test "ci-watch: github red when a real check fails (gh exits 1)" {
  make_stub gh 'printf "pass\tbuild\nfail\ttest\n"; exit 1'
  run_ci_watch github 5
  assert_failure 1
}

@test "ci-watch: github red on a cancelled real check (gh exits 1)" {
  make_stub gh 'printf "pass\tbuild\ncancel\ttest\n"; exit 1'
  run_ci_watch github 5
  assert_failure 1
}

@test "ci-watch: github ignores pending coderabbit check (gh exits 8)" {
  make_stub gh 'printf "pass\tbuild\npending\tCodeRabbit\n"; exit 8'
  run_ci_watch github 5
  assert_success
  assert_output --partial "coderabbit"
}

@test "ci-watch: github ignores failing coderabbit check (gh exits 1)" {
  make_stub gh 'printf "pass\tbuild\nfail\tcoderabbitai Review\n"; exit 1'
  run_ci_watch github 5
  assert_success
  assert_output --partial "coderabbit"
}

@test "ci-watch: github green when only coderabbit checks exist" {
  make_stub gh 'printf "pending\tCodeRabbit\n"; exit 8'
  run_ci_watch github 5
  assert_success
  assert_output --partial "coderabbit"
}

@test "ci-watch: github excludes any check whose name contains coderabbit" {
  # documented name-substring heuristic: even a failing check named
  # *coderabbit* cannot gate the result (it is excluded, with a note)
  make_stub gh 'printf "fail\tcoderabbit-config-lint\npass\tbuild\n"; exit 1'
  run_ci_watch github 5
  assert_success
  assert_output --partial "coderabbit"
}

@test "ci-watch: github waits for a pending real check, then green" {
  make_stub gh 'f="$STATE_DIR/gh-calls"; n=$(cat "$f" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$f"' \
    'if [ "$n" -lt 2 ]; then printf "pending\tbuild\n"; exit 8; else printf "pass\tbuild\n"; exit 0; fi'
  run_ci_watch github 5
  assert_success
}

@test "ci-watch: github exit 2 when real checks stay pending (deadline)" {
  make_stub gh 'printf "pending\tbuild\n"; exit 8'
  run_ci_watch github 5
  assert_failure 2
  assert_output --partial "timeout"
}

@test "ci-watch: github green with note when no checks are reported" {
  make_stub gh 'echo "no checks reported on the feature branch" >&2; exit 1'
  run_ci_watch github 5
  assert_success
  assert_output --partial "no checks"
}

@test "ci-watch: github exit 2 on persistent API errors" {
  make_stub gh 'echo "HTTP 504 Gateway Timeout" >&2; exit 1'
  run_ci_watch github 5
  assert_failure 2
}

@test "ci-watch: github exit 64 when gh lacks --json support" {
  make_stub gh 'echo "unknown flag: --json" >&2; exit 1'
  run_ci_watch github 5
  assert_failure 64
  assert_output --partial "too old"
}

@test "ci-watch: gitlab green on pipeline success (json output)" {
  make_stub glab 'printf "{\"id\": 7, \"status\": \"success\"}\n"; exit 0'
  run_ci_watch gitlab feature-branch
  assert_success
}

@test "ci-watch: gitlab red on pipeline failure (json output)" {
  make_stub glab 'printf "{\"id\": 7, \"status\": \"failed\"}\n"; exit 0'
  run_ci_watch gitlab feature-branch
  assert_failure 1
}

@test "ci-watch: gitlab text fallback parses tab-separated status" {
  # old glab: --output json is rejected, text output separates with a TAB
  make_stub glab 'case "$*" in *--output*) echo "unknown flag: --output" >&2; exit 1;; esac' \
    'printf "id:\t7\nstatus:\tsuccess\n"; exit 0'
  run_ci_watch gitlab feature-branch
  assert_success
}

@test "ci-watch: gitlab waits while running, then green" {
  make_stub glab 'f="$STATE_DIR/glab-calls"; n=$(cat "$f" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$f"' \
    'if [ "$n" -lt 2 ]; then printf "{\"status\": \"running\"}\n"; else printf "{\"status\": \"success\"}\n"; fi'
  run_ci_watch gitlab feature-branch
  assert_success
}

@test "ci-watch: gitlab skipped pipeline counts green with note" {
  make_stub glab 'printf "{\"status\": \"skipped\"}\n"; exit 0'
  run_ci_watch gitlab feature-branch
  assert_success
  assert_output --partial "skipped"
}

@test "ci-watch: gitlab manual gate counts green with note" {
  make_stub glab 'printf "{\"status\": \"manual\"}\n"; exit 0'
  run_ci_watch gitlab feature-branch
  assert_success
  assert_output --partial "manual"
}

@test "ci-watch: gitlab green with note when no pipeline exists" {
  make_stub glab 'echo "No pipelines running or available on branch: feature-branch" >&2; exit 1'
  run_ci_watch gitlab feature-branch
  assert_success
  assert_output --partial "no pipeline"
}

@test "ci-watcher agent exists with the required frontmatter" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/agents/ci-watcher.md'"
  assert_success
  assert_output --partial "name: ci-watcher"
  assert_output --partial "model: sonnet"
  assert_output --partial "effort: low"
  assert_output --partial "color: yellow"
  assert_output --partial '"Bash"'
}

@test "ci-watcher agent is read-only (no Edit/Write in its tools)" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/agents/ci-watcher.md'"
  assert_success
  refute_output --partial '"Edit"'
  refute_output --partial '"Write"'
}

@test "ci-watcher agent documents the ci-watch.sh exit-code mapping" {
  run cat "$PLUGIN/agents/ci-watcher.md"
  assert_success
  assert_output --partial 'CI_WATCH_TIMEOUT=1800'
  assert_output --partial 'job": "ci-watch"'
}

@test "ci-watcher agent chains cd into each cwd-dependent gh/glab command (not a one-time cd)" {
  run grep -F 'cd "<worktree path>" && gh' "$PLUGIN/agents/ci-watcher.md"
  assert_success
  # regression guard: the one-time-cd phrasing must not creep back
  run grep -iF "worktree path via native bash" "$PLUGIN/agents/ci-watcher.md"
  assert_failure
}

@test "ci-watcher agent extracts CodeRabbit's AI-agent prompt into ai_prompt" {
  run grep -F "Prompt for AI Agents" "$PLUGIN/agents/ci-watcher.md"
  assert_success
  run grep -F "ai_prompt" "$PLUGIN/agents/ci-watcher.md"
  assert_success
}

@test "pr-fixer agent exists with the required frontmatter" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/agents/pr-fixer.md'"
  assert_success
  assert_output --partial "name: pr-fixer"
  assert_output --partial "model: opus"
  assert_output --partial "color: red"
  assert_output --partial '"Edit"'
}

@test "pr-fixer agent chains cd into each git command (not a one-time cd)" {
  run grep -F 'cd "<worktree path>" && git' "$PLUGIN/agents/pr-fixer.md"
  assert_success
  # regression guard: the one-time-cd phrasing must not creep back
  run grep -iF "worktree path via native bash" "$PLUGIN/agents/pr-fixer.md"
  assert_failure
}

@test "pr-fixer agent always annotates skipped findings in code" {
  run grep -F "Annotate every skipped finding in code" "$PLUGIN/agents/pr-fixer.md"
  assert_success
}

@test "pr-fixer agent treats ai_prompt as a hint, never applied blindly" {
  run grep -F "not an instruction to apply blindly" "$PLUGIN/agents/pr-fixer.md"
  assert_success
}

@test "pr-fixer agent never pushes" {
  run grep -F "Never push" "$PLUGIN/agents/pr-fixer.md"
  assert_success
}

@test "fresh-pr SKILL.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}

@test "fresh-pr frontmatter declares name and required allowed-tools" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/skills/fresh-pr/SKILL.md'"
  assert_success
  assert_output --partial "name: fresh-pr"
  assert_output --partial "Agent"
  assert_output --partial "AskUserQuestion"
  assert_output --partial "TaskCreate"
}

@test "fresh-pr commits pending work before checking for anything to submit" {
  run grep -F "Commit pending work" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}

@test "fresh-pr rebases onto the base and force-with-leases only when rewritten" {
  run grep -F 'git rebase "origin/$base"' "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
  run grep -F -- '--force-with-lease' "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}

@test "fresh-pr never uses gh pr edit, uses gh api PATCH instead" {
  run grep -F "never \`gh pr edit\`" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
  run grep -F "gh api -X PATCH" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}

@test "fresh-pr handles a merged existing PR by stopping before the goal loop" {
  run grep -F "already merged and **stop here**" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}

@test "fresh-pr dispatches ci-watcher and pr-fixer with a Task* ledger gate" {
  run grep -F "coding-toolbox:ci-watcher" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
  run grep -F "coding-toolbox:pr-fixer" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
  run grep -F "Subagent reconciliation gate" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}

@test "fresh-pr goal loop is capped at 5 iterations" {
  run grep -F "capped at 5 iterations" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}

@test "plugin.json version bumped for fresh-pr" {
  run jq -r '.version' "$PLUGIN/.claude-plugin/plugin.json"
  assert_output "0.6.0"
}

@test "plugin README lists fresh-pr in the Skills section" {
  run grep -F '| `fresh-pr`' "$PLUGIN/README.md"
  assert_success
}

@test "fresh-work skill dir is self-contained (no cross-plugin references)" {
  run bash -c "grep -riE 'superpowers|branch-management' '$PLUGIN/skills/fresh-work/'"
  assert_failure
}

@test "fresh-work references/designing.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/fresh-work/references/designing.md"
  assert_success
}

@test "fresh-work designing reference gates user questions and keeps output out of the repo" {
  run cat "$PLUGIN/skills/fresh-work/references/designing.md"
  assert_success
  assert_output --partial "genuinely changes the design"
  assert_output --partial "AskUserQuestion"
  assert_output --partial "spec temp path"
}

@test "fresh-work references/planning.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/fresh-work/references/planning.md"
  assert_success
}

@test "fresh-work planning reference keeps global constraints and drops the execution-choice handoff" {
  run cat "$PLUGIN/skills/fresh-work/references/planning.md"
  assert_success
  assert_output --partial "Global Constraints"
  assert_output --partial "plan temp path"
  refute_output --partial "Which approach"
}

@test "fresh-work references/implementing.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/fresh-work/references/implementing.md"
  assert_success
}

@test "fresh-work implementing reference probes Workflow, falls back to Agent, and gates dispatches" {
  run cat "$PLUGIN/skills/fresh-work/references/implementing.md"
  assert_success
  assert_output --partial "select:Workflow"
  assert_output --partial "Agent engine"
  assert_output --partial "Subagent reconciliation gate"
  assert_output --partial "'critical'"
}
