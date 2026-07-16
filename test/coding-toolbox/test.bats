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
  # `rg` is NOT required (the loop below only symlinks tools actually present
  # on the host, so its absence is a silent no-op) -- but forwarding it when
  # present lets ci-watch.sh's own rg_or_grep() take its rg-preferred branch
  # under this suite too, instead of only ever exercising the grep fallback.
  MOCKBIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$MOCKBIN"
  for t in bash env grep rg timeout sleep mktemp cat rm mkdir awk; do
    src="$(command -v "$t")" && [ -n "$src" ] && ln -s "$src" "$MOCKBIN/$t"
  done

  # Isolated HOME so no test reads real user config.
  export HOME="$BATS_TEST_TMPDIR/home"
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
  run rg_or_grep -F "[coding-toolbox](plugins/coding-toolbox/README.md)" "$REPO_ROOT/README.md"
  assert_success
}

@test "plugin is in the test.yml matrix" {
  run rg_or_grep -E "^\s*-\s*coding-toolbox\s*$" "$REPO_ROOT/.github/workflows/test.yml"
  assert_success
}

@test "golden-rules.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/setup-rules/references/golden-rules.md"
  assert_success
}

@test "golden-rules.md covers all four axes and cites all three sourced axes" {
  run cat "$PLUGIN/skills/setup-rules/references/golden-rules.md"
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

@test "golden-rules.md forbids ending a turn with a bare '?'" {
  run cat "$PLUGIN/skills/setup-rules/references/golden-rules.md"
  assert_success
  assert_output --partial 'bare "?"'
}

@test "hooks.json is valid JSON" {
  run jq empty "$HOOKS/hooks.json"
  assert_success
}

@test "Stop hook has no matcher and is wired to the interaction_gate mcp_tool" {
  run jq -e '.hooks.Stop[0] | (has("matcher") | not) and (.hooks[0].type == "mcp_tool") and (.hooks[0].server == "plugin:coding-toolbox:coding-toolbox-hooks") and (.hooks[0].tool == "interaction_gate")' "$HOOKS/hooks.json"
  assert_success
}

@test ".mcp.json registers coding-toolbox-hooks -> bin/mjs-launch.sh mcp/server.mjs" {
  run jq -e '.mcpServers["coding-toolbox-hooks"].command | endswith("bin/mjs-launch.sh")' "$PLUGIN/.mcp.json"
  assert_success
  run jq -e '.mcpServers["coding-toolbox-hooks"].args == ["${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs"]' "$PLUGIN/.mcp.json"
  assert_success
}

@test "mcp/server.mjs is executable (repo rule)" {
  [ -x "$PLUGIN/mcp/server.mjs" ]
}

# --- bin/mjs-launch.sh (runtime launcher: bun-preferred, node fallback) -----

@test "bin/mjs-launch.sh is executable (repo rule)" {
  [ -x "$SCRIPTS/mjs-launch.sh" ]
}

@test "bin/mjs-launch.sh has a bash shebang and passes bash -n" {
  run head -n1 "$SCRIPTS/mjs-launch.sh"
  assert_output '#!/usr/bin/env bash'
  run bash -n "$SCRIPTS/mjs-launch.sh"
  assert_success
}

@test "bin/mjs-launch.sh errors on missing argument (exit 64)" {
  run "$SCRIPTS/mjs-launch.sh"
  assert_failure 64
  assert_output --partial "missing argument"
}

# The `env -i ... HOME="$HOME" ...` idiom below (through the ~/.local/bin test) is safe:
# setup() already redirects HOME to "$BATS_TEST_TMPDIR/home", so it's never the host home
# and the ~/.local/bin writes stay isolated -- CodeRabbit PRRT_kwDOSsj0xM6RhOov false positive.
@test "bin/mjs-launch.sh errors when neither bun nor node is on PATH" {
  local fakebin="$BATS_TEST_TMPDIR/fakebin-none"
  mkdir -p "$fakebin"
  for t in bash env; do
    src="$(command -v "$t" 2>/dev/null)" && ln -s "$src" "$fakebin/$t"
  done
  run env -i PATH="$fakebin" HOME="$HOME" "$SCRIPTS/mjs-launch.sh" /some/script.mjs
  assert_failure 1
  assert_output --partial "neither bun nor node is available"
}

@test "bin/mjs-launch.sh falls back to node when bun is absent" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local fakebin="$BATS_TEST_TMPDIR/fakebin-node"
  mkdir -p "$fakebin"
  for t in bash env node; do
    src="$(command -v "$t" 2>/dev/null)" && ln -s "$src" "$fakebin/$t"
  done
  run env -i PATH="$fakebin" HOME="$HOME" "$SCRIPTS/mjs-launch.sh" --version
  assert_success
}

@test "bin/mjs-launch.sh prefers bun over node when both are on PATH" {
  command -v bun >/dev/null 2>&1 || skip "bun not installed"
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local fakebin="$BATS_TEST_TMPDIR/fakebin-both"
  mkdir -p "$fakebin"
  for t in bash env node bun; do
    src="$(command -v "$t" 2>/dev/null)" && ln -s "$src" "$fakebin/$t"
  done
  local probe="$BATS_TEST_TMPDIR/which-runtime.mjs"
  printf 'console.log(typeof Bun !== "undefined" ? "bun" : "node")\n' > "$probe"
  run env -i PATH="$fakebin" HOME="$HOME" "$SCRIPTS/mjs-launch.sh" "$probe"
  assert_success
  assert_output "bun"
}

@test "bin/mjs-launch.sh appends ~/.local/bin after the inherited PATH, so a system-PATH tool wins over a same-named one there" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local fakebin="$BATS_TEST_TMPDIR/fakebin-syspath"
  mkdir -p "$fakebin" "$HOME/.local/bin"
  for t in bash env node; do
    src="$(command -v "$t" 2>/dev/null)" && ln -s "$src" "$fakebin/$t"
  done
  printf '#!/usr/bin/env bash\necho system-path-tool\n' > "$fakebin/dupe-tool"
  chmod +x "$fakebin/dupe-tool"
  printf '#!/usr/bin/env bash\necho stale-local-bin-tool\n' > "$HOME/.local/bin/dupe-tool"
  chmod +x "$HOME/.local/bin/dupe-tool"
  local probe="$BATS_TEST_TMPDIR/which-tool.mjs"
  printf 'import { execSync } from "node:child_process";\nconsole.log(execSync("command -v dupe-tool").toString().trim());\n' > "$probe"
  run env -i PATH="$fakebin" HOME="$HOME" "$SCRIPTS/mjs-launch.sh" "$probe"
  assert_success
  assert_output "$fakebin/dupe-tool"
}

@test "bin/mjs-launch.sh launches server.mjs correctly (interaction_gate listed over stdio)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  run bash -c '
    printf "%s\n%s\n" \
      "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}" \
      "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}" \
      | "'"$SCRIPTS/mjs-launch.sh"'" "'"$PLUGIN/mcp/server.mjs"'"
  '
  assert_success
  assert_output --partial '"interaction_gate"'
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
  run bash -c "rg_or_grep -m1 '^## ' '$PLUGIN/README.md'"
  assert_success
  assert_output "## Install"
}

@test "plugin README contains the install command" {
  run rg_or_grep -F "/plugin install coding-toolbox@kwitsch-plugins" "$PLUGIN/README.md"
  assert_success
}

@test "plugin README has no ## Hooks section" {
  run rg_or_grep -E "^## Hooks" "$PLUGIN/README.md"
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
  run rg_or_grep -F 'git rev-parse --git-dir' "$PLUGIN/skills/fresh-branch/SKILL.md"
  assert_success
}

# Regression guard: the detection must compare by inode (-ef), never string
# equality. From a subdirectory --git-dir is absolute and --git-common-dir is
# relative, so a raw '=' wrongly flags the main worktree as a linked one.
@test "fresh-branch worktree detection compares git-dir by inode, not string equality" {
  run rg_or_grep -F -- '-ef "$(git rev-parse --git-common-dir)"' "$PLUGIN/skills/fresh-branch/SKILL.md"
  assert_success
}

@test "fresh-branch script carries the documented exit-code contract" {
  run rg_or_grep -F 'Exit: 0 ok' "$PLUGIN/skills/fresh-branch/SKILL.md"
  assert_success
}

@test "fresh-branch script auto-stashes and pops uncommitted changes" {
  run rg_or_grep -F 'git stash push -u' "$PLUGIN/skills/fresh-branch/SKILL.md"
  assert_success
  run rg_or_grep -F 'git stash pop' "$PLUGIN/skills/fresh-branch/SKILL.md"
  assert_success
}

@test "fresh-branch worktree path rebases instead of switching branches" {
  run rg_or_grep -F 'git rebase "origin/$base"' "$PLUGIN/skills/fresh-branch/SKILL.md"
  assert_success
}

@test "fresh-branch checks branch-name collision before touching the tree" {
  run rg_or_grep -F 'refs/heads/$branch' "$PLUGIN/skills/fresh-branch/SKILL.md"
  assert_success
}

@test "plugin README lists fresh-branch in a Skills section" {
  run rg_or_grep -F '| `fresh-branch`' "$PLUGIN/README.md"
  assert_success
}

@test "fresh-branch treats zero args as a universal refresh, not a non-worktree usage error" {
  run rg_or_grep -F 'if [ "$#" -eq 0 ]; then' "$PLUGIN/skills/fresh-branch/SKILL.md"
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
    CI_WATCH_INTERVAL=0 CI_WATCH_TIMEOUT=2 CI_WATCH_CODERABBIT_TIMEOUT=2 \
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

@test "ci-watch: --coderabbit-check exits 0 once the coderabbit check concludes" {
  make_stub gh 'f="$STATE_DIR/gh-calls"; n=$(cat "$f" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$f"' \
    'if [ "$n" -lt 2 ]; then printf "pass\tbuild\npending\tCodeRabbit\n"; exit 8; else printf "pass\tbuild\npass\tCodeRabbit\n"; exit 0; fi'
  run_ci_watch github 5 --coderabbit-check
  assert_success
  assert_output --partial "CodeRabbit"
}

@test "ci-watch: --coderabbit-check exits 2 when the coderabbit check stays pending (deadline)" {
  make_stub gh 'printf "pass\tbuild\npending\tCodeRabbit\n"; exit 8'
  run_ci_watch github 5 --coderabbit-check
  assert_failure 2
  assert_output --partial "coderabbit check still pending"
}

@test "ci-watch: --coderabbit-check exits 0 with a note when no coderabbit check ever appears" {
  make_stub gh 'printf "pass\tbuild\npass\ttest\n"; exit 0'
  run_ci_watch github 5 --coderabbit-check
  assert_success
  assert_output --partial "no coderabbit check found"
}

@test "ci-watch: --coderabbit-check is rejected for gitlab" {
  run_ci_watch gitlab 5 --coderabbit-check
  assert_failure 64
  assert_output --partial "only supported for github"
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
  run rg_or_grep -F 'cd "<worktree path>" && gh' "$PLUGIN/agents/ci-watcher.md"
  assert_success
  # regression guard: the one-time-cd phrasing must not creep back
  run rg_or_grep -iF "worktree path via native bash" "$PLUGIN/agents/ci-watcher.md"
  assert_failure
}

@test "fresh-pr git-context block detects rtk availability" {
run rg_or_grep -F "rtk_available" "$PLUGIN/skills/fresh-pr/SKILL.md"
assert_success
}

@test "ci-watcher agent documents and conditionally uses rtk_available for gh run list" {
run rg_or_grep -F "rtk_available" "$PLUGIN/agents/ci-watcher.md"
assert_success
run rg_or_grep -F "rtk gh run list --branch" "$PLUGIN/agents/ci-watcher.md"
assert_success
}

@test "ci-watcher agent extracts CodeRabbit's AI-agent prompt into ai_prompt" {
  run rg_or_grep -F "Prompt for AI Agents" "$PLUGIN/agents/ci-watcher.md"
  assert_success
  run rg_or_grep -F "ai_prompt" "$PLUGIN/agents/ci-watcher.md"
  assert_success
}

@test "ci-watcher agent gates CodeRabbit feedback on the check's own conclusion, not a blind poll count" {
  run cat "$PLUGIN/agents/ci-watcher.md"
  assert_success
  assert_output --partial -- "--coderabbit-check"
  assert_output --partial "CI_WATCH_CODERABBIT_TIMEOUT=600"
  # regression guard: the old blind-poll-count heuristic must not creep back
  refute_output --partial "stop early on the first poll"
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
  run rg_or_grep -F 'cd "<worktree path>" && git' "$PLUGIN/agents/pr-fixer.md"
  assert_success
  # regression guard: the one-time-cd phrasing must not creep back
  run rg_or_grep -iF "worktree path via native bash" "$PLUGIN/agents/pr-fixer.md"
  assert_failure
}

@test "pr-fixer agent always annotates skipped findings in code" {
  run rg_or_grep -F "Annotate every skipped finding in code" "$PLUGIN/agents/pr-fixer.md"
  assert_success
}

@test "pr-fixer agent treats ai_prompt as a hint, never applied blindly" {
  run rg_or_grep -F "not an instruction to apply blindly" "$PLUGIN/agents/pr-fixer.md"
  assert_success
}

@test "pr-fixer agent never pushes" {
  run rg_or_grep -F "Never push" "$PLUGIN/agents/pr-fixer.md"
  assert_success
}

@test "ci-watcher agent has no context-mode reference" {
  run cat "$PLUGIN/agents/ci-watcher.md"
  assert_success
  refute_output --partial "context-mode"
}

@test "pr-fixer agent has no context-mode reference" {
  run cat "$PLUGIN/agents/pr-fixer.md"
  assert_success
  refute_output --partial "context-mode"
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
  run rg_or_grep -F "Commit pending work" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}

@test "fresh-pr rebases onto the base and force-with-leases only when rewritten" {
  run rg_or_grep -F 'git rebase "origin/$base"' "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
  run rg_or_grep -F -- '--force-with-lease' "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}

@test "fresh-pr never uses gh pr edit, uses gh api PATCH instead" {
  run rg_or_grep -F "never \`gh pr edit\`" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "gh api -X PATCH" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}

@test "fresh-pr handles a merged existing PR by stopping before the goal loop" {
  run rg_or_grep -F "already merged and **stop here**" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}

@test "fresh-pr dispatches ci-watcher and pr-fixer with a Task* ledger gate" {
  run rg_or_grep -F "coding-toolbox:ci-watcher" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "coding-toolbox:pr-fixer" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "Subagent reconciliation gate" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}

@test "fresh-pr goal loop is capped at 5 iterations" {
  run rg_or_grep -F "capped at 5 iterations" "$PLUGIN/skills/fresh-pr/SKILL.md"
  assert_success
}

@test "plugin.json version bumped for the bun-preferred mcp/server.mjs wrapper fix (this unreleased branch)" {
  run jq -r '.version' "$PLUGIN/.claude-plugin/plugin.json"
  assert_output "0.15.4"
}

@test "plugin.json description mentions fresh-work" {
  run jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json"
  assert_output --partial "fresh-work"
}

@test "bump-version SKILL.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/bump-version/SKILL.md"
  assert_success
}

@test "bump-version frontmatter declares name and argument-hint" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/skills/bump-version/SKILL.md'"
  assert_success
  assert_output --partial "name: bump-version"
  assert_output --partial 'argument-hint: "<major|minor|patch>"'
}

@test "bump-version detects version files in package.json > composer.json > pom.xml > VERSION order" {
  run rg_or_grep -F 'detect_json "package.json"' "$PLUGIN/skills/bump-version/SKILL.md"
  assert_success
  run rg_or_grep -F 'detect_json "composer.json"' "$PLUGIN/skills/bump-version/SKILL.md"
  assert_success
  run rg_or_grep -F 'detect_pom' "$PLUGIN/skills/bump-version/SKILL.md"
  assert_success
  run rg_or_grep -F 'detect_version_file' "$PLUGIN/skills/bump-version/SKILL.md"
  assert_success
}

@test "bump-version pom.xml detection skips a leading parent block" {
  run rg_or_grep -F '</parent>' "$PLUGIN/skills/bump-version/SKILL.md"
  assert_success
}

@test "bump-version syncs package-lock.json via npm i --package-lock-only" {
  run rg_or_grep -F 'npm i --package-lock-only' "$PLUGIN/skills/bump-version/SKILL.md"
  assert_success
}

@test "bump-version composer sync is documented as content-hash-only, not version propagation" {
  run rg_or_grep -F 'composer update --lock' "$PLUGIN/skills/bump-version/SKILL.md"
  assert_success
  run rg_or_grep -F 'no root-version field' "$PLUGIN/skills/bump-version/SKILL.md"
  assert_success
}

@test "bump-version carries the documented exit-code contract" {
  run rg_or_grep -F 'Exit: 0 ok' "$PLUGIN/skills/bump-version/SKILL.md"
  assert_success
}

# Regression guard: the script's awk/trap/sed lines contain single-quoted
# regions that break if pasted inside an outer bash -c '...' wrapper
# (confirmed during planning: it fails with a syntax error before the first
# real line). Invocation must stay heredoc-to-file.
@test "bump-version invokes via a quoted heredoc, not an outer bash -c wrapper" {
  run rg_or_grep -F "<<'BUMPVERSION_EOF'" "$PLUGIN/skills/bump-version/SKILL.md"
  assert_success
}

# Regression guard: an unquoted-tag heredoc (<<'TAG') only terminates on a
# line that is EXACTLY the tag -- even one leading space (e.g. from being
# nested under a numbered list item) leaves it unterminated and swallows
# everything after it. Caught during planning by literally running the
# nested form and watching it hang on "unexpected EOF".
@test "bump-version heredoc terminator is column-0 (unindented)" {
  run rg_or_grep -qx 'BUMPVERSION_EOF' "$PLUGIN/skills/bump-version/SKILL.md"
  assert_success
}

@test "plugin README lists bump-version in a Skills section" {
  run rg_or_grep -F '| `bump-version`' "$PLUGIN/README.md"
  assert_success
}

@test "plugin.json description mentions bump-version" {
  run jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json"
  assert_output --partial "bump-version"
}

@test "setup-rules SKILL.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}

@test "setup-rules frontmatter declares name, disable-model-invocation, argument-hint, and required allowed-tools" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/skills/setup-rules/SKILL.md'"
  assert_success
  assert_output --partial "name: setup-rules"
  assert_output --partial "disable-model-invocation: true"
  assert_output --partial "AskUserQuestion"
  assert_output --partial 'Bash(cp:*)'
  assert_output --partial 'argument-hint: "[install|update|remove]'
}

@test "setup-rules verbatim parser rejects ambiguous input without guessing" {
  run rg_or_grep -F 'ambiguous' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
  run rg_or_grep -F 'usage-error branch' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}

@test "setup-rules target parser rejects two distinct named targets, but still absorbs bare rule/rules after a tool word" {
  run rg_or_grep -F 'target is named' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
  run rg_or_grep -F 'the `tool`-family word absorbs the bare "rule"' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}

@test "setup-rules detects installed rules via the coding-toolbox-*.md glob" {
  run rg_or_grep -F 'coding-toolbox-*.md' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}

@test "setup-rules detects all four tools via command -v" {
  run rg_or_grep -c -e 'command -v rtk' -e 'command -v bun' -e 'command -v rg' -e 'command -v codebase-memory-mcp' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
  assert_output "4"
}

@test "setup-rules copies golden-rules.md byte-exact for the golden-rules rule" {
  run rg_or_grep -F 'cp "<plugin root resolved in Step 1>/skills/setup-rules/references/golden-rules.md"' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}

@test "setup-rules asks one single-select question per rule with a currently-installed header, not a multiSelect toggle" {
  run cat "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
  assert_output --partial 'multiSelect: false'
  assert_output --partial '[currently: <installed|not installed>]'
  refute_output --partial 'multiSelect: true'
}

@test "setup-rules documents the disableSkillShellExecution guard" {
  run rg_or_grep -F '[shell command execution disabled by policy]' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}

@test "setup-rules never overwrites the tools rule with an empty table when nothing is detected" {
  run rg_or_grep -F 'but `detected` is **empty**' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
  run rg_or_grep -F 'make **no change**' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}

@test "setup-rules documents that it is the only way to get golden rules injected" {
  run rg_or_grep -F 'this skill is the only way to get them onto this machine' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}

@test "setup-rules installs to the user-level rules directory, not project-level" {
  run rg_or_grep -F '$HOME/.claude/rules' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
}

@test "setup-rules apply commands target both managed files under the user-level directory" {
  run rg_or_grep -c -F -e '$HOME/.claude/rules/coding-toolbox-rules.md' -e '$HOME/.claude/rules/coding-toolbox-tools.md' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
  [ "$output" -ge 4 ]
}

@test "refresh-tools-rule SKILL.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_success
}

@test "refresh-tools-rule is model-invocable (no disable-model-invocation key)" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/skills/refresh-tools-rule/SKILL.md'"
  assert_success
  assert_output --partial "name: refresh-tools-rule"
  refute_output --partial "disable-model-invocation"
}

@test "refresh-tools-rule never installs or removes — no rm, no mkdir, no golden-rules cp" {
  run rg_or_grep -c -F -e 'rm -f' -e 'rm ' -e 'mkdir' -e 'golden-rules.md' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_failure
}

@test "refresh-tools-rule gates on the tools-rule file already existing before writing anything" {
  run rg_or_grep -F 'does **not** mention' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_success
  run rg_or_grep -F 'Never create the file' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_success
}

@test "refresh-tools-rule's write is symlink-safe and atomic (no bare cat> onto the managed path)" {
  run rg_or_grep -F -- '-L "$target"' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_success
  run rg_or_grep -F 'mktemp' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_success
  run rg_or_grep -F 'mv -f "$tmp" "$target"' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_success
  run rg_or_grep -F 'cat > "$HOME/.claude/rules/coding-toolbox-tools.md"' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_failure
}

@test "refresh-tools-rule detects all four tools via command -v" {
  run rg_or_grep -c -e 'command -v rtk' -e 'command -v bun' -e 'command -v rg' -e 'command -v codebase-memory-mcp' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_success
  assert_output "4"
}

@test "tool-routing-rows.md reference file exists with all four candidate rows, each in its own fenced block" {
  local rows="$PLUGIN/skills/setup-rules/references/tool-routing-rows.md"
  run test -s "$rows"
  assert_success
  for tool in rtk bun ripgrep codebase-memory; do
    run rg_or_grep -F "### $tool" "$rows"
    assert_success
  done
  run rg_or_grep -c -F -e '### rtk' -e '### bun' -e '### ripgrep' -e '### codebase-memory' "$rows"
  assert_success
  assert_output "4"
}

@test "setup-rules and refresh-tools-rule both read the shared tool-routing-rows.md, never inline the table" {
  run rg_or_grep -F 'references/tool-routing-rows.md' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_success
  run rg_or_grep -F 'references/tool-routing-rows.md' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_success
  run rg_or_grep -F 'rtk <cmd>' "$PLUGIN/skills/setup-rules/SKILL.md"
  assert_failure
  run rg_or_grep -F 'rtk <cmd>' "$PLUGIN/skills/refresh-tools-rule/SKILL.md"
  assert_failure
}

@test "plugin README lists refresh-tools-rule in the Skills section" {
  run rg_or_grep -F '| `refresh-tools-rule`' "$PLUGIN/README.md"
  assert_success
}

@test "plugin README lists setup-rules in the Skills section" {
  run rg_or_grep -F '| `setup-rules`' "$PLUGIN/README.md"
  assert_success
}

@test "plugin README lists fresh-pr in the Skills section" {
  run rg_or_grep -F '| `fresh-pr`' "$PLUGIN/README.md"
  assert_success
}

@test "fresh-work skill dir is self-contained (no cross-plugin references)" {
  run bash -c "
    if command -v rg >/dev/null 2>&1; then
      rg -i --no-ignore --hidden -a 'superpowers|branch-management' '$PLUGIN/skills/fresh-work/'
    else
      grep -riE 'superpowers|branch-management' '$PLUGIN/skills/fresh-work/'
    fi
  "
  assert_failure 1
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
  assert_output --partial "Keypoints"
}

@test "fresh-work designing reference scales itself to the task instead of a fixed advisor step" {
  run cat "$PLUGIN/skills/fresh-work/references/designing.md"
  assert_success
  assert_output --partial "Scale to the task (your call, not a fixed step)"
  assert_output --partial "complexity heuristic"
  assert_output --partial "Workflow tool"
  assert_output --partial "Advisor consultation is your call too"
  assert_output --partial "self-review (below) always validates"
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

@test "fresh-work planning reference scales itself to the task instead of a fixed advisor step" {
  run cat "$PLUGIN/skills/fresh-work/references/planning.md"
  assert_success
  assert_output --partial "Scale to the task (your call, not a fixed step)"
  assert_output --partial "complexity heuristic"
  assert_output --partial "Workflow tool"
  assert_output --partial "Advisor consultation is your call too"
  assert_output --partial "self-review (below) always validates"
}

@test "fresh-work planning reference marks Files/Interfaces as load-bearing for scheduling" {
  run cat "$PLUGIN/skills/fresh-work/references/planning.md"
  assert_success
  assert_output --partial "load-bearing"
  assert_output --partial "conservatively serialized"
}

@test "fresh-work planning reference mandates a machine-readable tasks block" {
  run cat "$PLUGIN/skills/fresh-work/references/planning.md"
  assert_success
  assert_output --partial "## Machine-readable tasks"
  assert_output --partial "single source"
  assert_output --partial "never re-parsed"
}

@test "fresh-work implementing reference consumes the machine-readable tasks block" {
  run cat "$PLUGIN/skills/fresh-work/references/implementing.md"
  assert_success
  assert_output --partial "## Machine-readable tasks"
  assert_output --partial "authored by the Plan phase"
  refute_output --partial "task list parsed as"
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

@test "fresh-work implementing reference inlines Workflow script values instead of using args" {
  run cat "$PLUGIN/skills/fresh-work/references/implementing.md"
  assert_success
  assert_output --partial 'pass no `args` at all'
  # The prose note quotes the observed error ('args.tasks') deliberately; refute
  # only the buggy CODE forms (template interpolation / loop), not that mention.
  refute_output --partial '${args.planPath}'
  refute_output --partial 'for (const t of args.tasks)'
  refute_output --partial '${args.constraints}'
}

@test "fresh-work implementing reference computes wave-parallel scheduling from Files/Interfaces" {
  run cat "$PLUGIN/skills/fresh-work/references/implementing.md"
  assert_success
  assert_output --partial "Parallelism analysis"
  assert_output --partial "wave[i]"
  assert_output --partial "conservative"
}

@test "fresh-work implementing reference isolates wave-parallel implementers and merges back" {
  run cat "$PLUGIN/skills/fresh-work/references/implementing.md"
  assert_success
  assert_output --partial "isolation: 'worktree'"
  assert_output --partial "git merge --no-ff"
  assert_output --partial "hard stop"
}

@test "fresh-work implementing reference keeps wave size 1 identical to today's flow" {
  run cat "$PLUGIN/skills/fresh-work/references/implementing.md"
  assert_success
  assert_output --partial "wave size 1"
  assert_output --partial "unchanged"
}

@test "fresh-work implementing reference computes waves as real code, not a hand-derived literal" {
  run cat "$PLUGIN/skills/fresh-work/references/implementing.md"
  assert_success
  assert_output --partial "function computeWaves(tasksIn)"
  assert_output --partial "const waves = computeWaves(tasks)"
}

@test "fresh-work implementing reference runs Agent-engine merge-back via Bash, not a merger dispatch" {
  run cat "$PLUGIN/skills/fresh-work/references/implementing.md"
  assert_success
  assert_output --partial "orchestrator's own Bash"
  assert_output --partial "rather than dispatching a separate merger"
}

@test "subagent-tracking fresh-work row reflects wave-parallel dispatch, not pure sequential" {
  RULE="$BATS_TEST_DIRNAME/../../.claude/rules/subagent-tracking.md"
  run rg_or_grep 'coding-toolbox:fresh-work' "$RULE"
  assert_success
  assert_output --partial "wave-parallel"
  assert_output --partial "orchestrator's own Bash"
}

@test "fresh-work references/reviewing.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/fresh-work/references/reviewing.md"
  assert_success
}

@test "fresh-work references/debugging.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/fresh-work/references/debugging.md"
  assert_success
}

@test "fresh-work debugging reference demands root cause and a failing test before any fix" {
  run cat "$PLUGIN/skills/fresh-work/references/debugging.md"
  assert_success
  assert_output --partial "root cause"
  assert_output --partial "failing test"
  assert_output --partial "AskUserQuestion"
}

@test "fresh-work SKILL.md exists with required frontmatter" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/skills/fresh-work/SKILL.md'"
  assert_success
  assert_output --partial "name: fresh-work"
  assert_output --partial "argument-hint"
  assert_output --partial "work_description"
  assert_output --partial "Workflow"
  assert_output --partial "TaskCreate"
  # AskUserQuestion is deliberately no longer pre-approved here (still used in
  # the skill body — allowed-tools only pre-approves, doesn't restrict).
  refute_output --partial "AskUserQuestion"
}

@test "fresh-work has an intent-confirmation step between Design and Plan" {
  run cat "$PLUGIN/skills/fresh-work/SKILL.md"
  assert_success
  assert_output --partial "**Intent confirmation.**"
  assert_output --partial "Keypoints"
  # Position check, not just presence: each pattern is grepped separately and
  # anchored to the line start so line numbers reflect each step's own match —
  # `grep -n` on a single combined pattern always emits matches in ascending
  # line-number order regardless of alternation order, so it can never detect
  # a reordering (a false pass), and an unanchored "N. **X.**" would also match
  # inside a two-digit renumbering (e.g. "9." matching inside "19."). Same
  # rationale applies to the Implement/Review/PR check further below.
  local skill_md="$output"
  local design_line intent_line plan_line
  design_line=$(rg_or_grep -n '^4\. \*\*Design\.\*\*' <<< "$skill_md" | cut -d: -f1)
  intent_line=$(rg_or_grep -n '^5\. \*\*Intent confirmation\.\*\*' <<< "$skill_md" | cut -d: -f1)
  plan_line=$(rg_or_grep -n '^6\. \*\*Plan\.\*\*' <<< "$skill_md" | cut -d: -f1)
  [ -n "$design_line" ] && [ -n "$intent_line" ] && [ -n "$plan_line" ]
  [ "$design_line" -lt "$intent_line" ]
  [ "$intent_line" -lt "$plan_line" ]
}

# Regression guard: a prior run asked the Intent-confirmation AskUserQuestion
# without ever showing the design summary first. Pins the hardened wording
# that forces the Keypoints re-read + plain-text output as its own step,
# distinct from the generic step-start announcement, before the tool call.
@test "fresh-work Intent confirmation forces the Keypoints output as its own message before AskUserQuestion" {
  run cat "$PLUGIN/skills/fresh-work/SKILL.md"
  assert_success
  assert_output --partial 'Before calling `AskUserQuestion` for this step:'
  assert_output --partial "Read the design doc's Keypoints section fresh from the spec temp path."
  assert_output --partial "does not satisfy this"
  assert_output --partial 'Only then call `AskUserQuestion`'
}

@test "fresh-work Step-start reporting note clarifies it never substitutes for a step's own output" {
  run cat "$PLUGIN/skills/fresh-work/SKILL.md"
  assert_success
  assert_output --partial "Starting step 4: Design."
  assert_output --partial "never a question"
  assert_output --partial "never substitutes for a step's own"
}

@test "fresh-work no longer schedules fixed Advisor pass steps" {
  run cat "$PLUGIN/skills/fresh-work/SKILL.md"
  assert_success
  refute_output --partial "**Advisor pass (spec).**"
  refute_output --partial "**Advisor pass (plan).**"
  assert_output --partial "## Complexity heuristic"
  assert_output --partial "not a scheduled pipeline step"
}

@test "fresh-work classify table points refactor/feature at the renumbered design path" {
  run cat "$PLUGIN/skills/fresh-work/SKILL.md"
  assert_success
  assert_output --partial "design path (steps 4–9 below)"
  assert_output --partial "debug path (steps 4–5 below)"
}

@test "fresh-work Review step sits between Implement and PR, reading reviewing.md" {
  run cat "$PLUGIN/skills/fresh-work/SKILL.md"
  assert_success
  assert_output --partial "**Review.**"
  assert_output --partial "references/reviewing.md"
  # See the Design/Intent/Plan ordering test above for why each pattern is
  # grepped separately and anchored, instead of one combined pattern.
  local skill_md="$output"
  local implement_line review_line pr_line
  implement_line=$(rg_or_grep -n '^7\. \*\*Implement\.\*\*' <<< "$skill_md" | cut -d: -f1)
  review_line=$(rg_or_grep -n '^8\. \*\*Review\.\*\*' <<< "$skill_md" | cut -d: -f1)
  pr_line=$(rg_or_grep -n '^9\. \*\*PR\.\*\*' <<< "$skill_md" | cut -d: -f1)
  [ -n "$implement_line" ] && [ -n "$review_line" ] && [ -n "$pr_line" ]
  [ "$implement_line" -lt "$review_line" ]
  [ "$review_line" -lt "$pr_line" ]
}

@test "fresh-work reviewing reference runs the combined review workflow, effort scaled to complexity" {
  run cat "$PLUGIN/skills/fresh-work/references/reviewing.md"
  assert_success
  assert_output --partial "fresh-work-review"
  assert_output --partial "cleanup:"
  assert_output --partial "reversesDecision"
  assert_output --partial "const MODEL = 'sonnet'"
  assert_output --partial "model: MODEL"
  assert_output --partial '`high`'
  assert_output --partial '`max`'
  # the former two built-in skills are no longer invoked via the Skill tool
  refute_output --partial "Invoke \`simplify\`"
  refute_output --partial "Invoke \`code-review\`"
}

@test "fresh-work step 2 states the derived branch name to the user before branching" {
  run cat "$PLUGIN/skills/fresh-work/SKILL.md"
  assert_success
  assert_output --partial "State the derived name to the user (plain"
  assert_output --partial "output, not a question) before step 3."
}

@test "fresh-work Task-list integration requires a one-line step-start announcement" {
  run cat "$PLUGIN/skills/fresh-work/SKILL.md"
  assert_success
  assert_output --partial "Step-start reporting."
  assert_output --partial "Starting step 4: Design."
  assert_output --partial "never a question"
}

@test "fresh-work Review step commits each sub-pass separately, never bundled" {
  run cat "$PLUGIN/skills/fresh-work/references/reviewing.md"
  assert_success
  assert_output --partial "one"
  assert_output --partial "fix per commit, never bundled"
}

@test "fresh-work references all five phase files and both sibling skills" {
  run cat "$PLUGIN/skills/fresh-work/SKILL.md"
  assert_success
  assert_output --partial "references/designing.md"
  assert_output --partial "references/planning.md"
  assert_output --partial "references/implementing.md"
  assert_output --partial "references/reviewing.md"
  assert_output --partial "references/debugging.md"
  assert_output --partial "coding-toolbox:fresh-branch"
  assert_output --partial "coding-toolbox:fresh-pr"
}

@test "fresh-work keeps design docs out of the repository" {
  run cat "$PLUGIN/skills/fresh-work/SKILL.md"
  assert_success
  assert_output --partial "mktemp"
  assert_output --partial "Never commit them"
}

@test "plugin README lists fresh-work in the Skills section" {
  run rg_or_grep -F '| `fresh-work`' "$PLUGIN/README.md"
  assert_success
}

# ---------------------------------------------------------------------------
# encoding-guard hook — pure-Node PreToolUse deny gate for non-UTF-8 files.
# Fixtures are generated per test with printf byte escapes (hermetic).
# ---------------------------------------------------------------------------

# encoding_guard <tool_name> <file_path> — drive the hook with a file-tool
# input; prints the hook's stdout.
encoding_guard() {
  jq -cn --arg t "$1" --arg f "$2" \
    '{tool_name:$t, tool_input:{file_path:$f}, cwd:"/"}' \
    | "$HOOKS/encoding-guard.mjs" 2>/dev/null
}

make_fixtures() {
  FIX="$BATS_TEST_TMPDIR/fix"
  mkdir -p "$FIX"
  printf 'T\344glich gr\374\337t der B\344r\n'            > "$FIX/legacy.txt"
  printf 'T\303\244glich gr\303\274\303\237t\n'           > "$FIX/utf8.txt"
  printf 'plain ascii\n'                                  > "$FIX/ascii.txt"
  printf '\357\273\277bom utf8\n'                         > "$FIX/utf8bom.txt"
  printf '\377\376h\000i\000\n\000'                       > "$FIX/utf16le.txt"
  printf 'h\000e\000l\000l\000o\000\n\000'                > "$FIX/utf16-nobom.txt"
  printf '\211PNG\r\n\032\n\000\000\000\015IHDR'          > "$FIX/binary.png"
  : > "$FIX/empty.txt"
}

@test "encoding-guard is executable" {
  [ -x "$HOOKS/encoding-guard.mjs" ]
}

@test "encoding-guard allows UTF-8, ASCII, UTF-8-BOM, binary, empty and missing files" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_fixtures
  for f in utf8.txt ascii.txt utf8bom.txt binary.png empty.txt missing.txt; do
    run encoding_guard Read "$FIX/$f"
    assert_success
    [ -z "$output" ] || { echo "unexpected output for $f: $output"; false; }
  done
}

@test "encoding-guard denies Read of a legacy single-byte file with an iconv hint" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_fixtures
  run encoding_guard Read "$FIX/legacy.txt"
  assert_success
  assert_output --partial '"permissionDecision":"deny"'
  assert_output --partial 'ISO-8859-1/Windows-1252'
  assert_output --partial 'iconv -f WINDOWS-1252 -t UTF-8'
}

@test "encoding-guard denies Edit and Write of a legacy file, allows Write to a new path" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_fixtures
  run encoding_guard Edit "$FIX/legacy.txt"
  assert_success
  assert_output --partial '"permissionDecision":"deny"'
  run encoding_guard Write "$FIX/legacy.txt"
  assert_success
  assert_output --partial '"permissionDecision":"deny"'
  run encoding_guard Write "$FIX/brand-new-file.txt"
  assert_success
  [ -z "$output" ]
}

@test "encoding-guard names UTF-16 with and without BOM" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_fixtures
  run encoding_guard Read "$FIX/utf16le.txt"
  assert_success
  assert_output --partial 'UTF-16LE'
  run encoding_guard Read "$FIX/utf16-nobom.txt"
  assert_success
  assert_output --partial 'UTF-16LE (no BOM)'
}

@test "encoding-guard fails open on garbage stdin and unknown tools" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  make_fixtures
  run bash -c "printf 'not json at all' | '$HOOKS/encoding-guard.mjs' 2>/dev/null"
  assert_success
  [ -z "$output" ]
  run encoding_guard Glob "$FIX/legacy.txt"
  assert_success
  [ -z "$output" ]
}

@test "encoding-guard Bash corpus: every deny/allow case classifies as expected" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  local dir="$BATS_TEST_TMPDIR/corpus"
  mkdir -p "$dir"
  printf 'T\344glich gr\374\337t der B\344r\n'  > "$dir/legacy.txt"
  printf 'T\303\244glich gr\303\274\303\237t\n' > "$dir/utf8.txt"
  local failures="" cmd expect json out
  while IFS= read -r case_b64; do
    cmd="$(printf '%s' "$case_b64" | base64 -d | jq -r '.cmd')"
    expect="$(printf '%s' "$case_b64" | base64 -d | jq -r '.expect')"
    json="$(jq -cn --arg c "$cmd" --arg d "$dir" '{tool_name:"Bash", tool_input:{command:$c}, cwd:$d}')"
    out="$(printf '%s' "$json" | "$HOOKS/encoding-guard.mjs" 2>/dev/null)" \
      || { failures+="[exit!=0] $cmd"$'\n'; continue; }
    if [ "$expect" = "deny" ]; then
      [[ "$out" == *'"permissionDecision":"deny"'* ]] \
        || failures+="[expected deny, got allow] $cmd"$'\n'
    else
      [ -z "$out" ] || failures+="[expected allow, got: $out] $cmd"$'\n'
    fi
  done < <(jq -r '.[] | @base64' "$BATS_TEST_DIRNAME/encoding-guard-corpus.json")
  if [ -n "$failures" ]; then
    echo "$failures"
    false
  fi
}

@test "encoding-guard PreToolUse hook wired as a direct .mjs command hook" {
  run jq -e '.hooks.PreToolUse[0]
    | .matcher == "Read|Edit|Write|Bash"
      and (.hooks[0].type == "command")
      and (.hooks[0].command == "${CLAUDE_PLUGIN_ROOT}/hooks/encoding-guard.mjs")
      and (.hooks[0] | has("args") | not)' "$HOOKS/hooks.json"
  assert_success
}

@test "PreToolUse has exactly one hook entry (golden-rules reminder removed)" {
  run jq -e '.hooks.PreToolUse | length == 1' "$HOOKS/hooks.json"
  assert_success
}

@test "plugin.json description mentions the encoding guard" {
  run jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json"
  assert_output --partial "non-UTF-8"
}

@test "fresh-work branch naming demands a concise English summary, never a verbatim slug" {
  run cat "$PLUGIN/skills/fresh-work/SKILL.md"
  assert_success
  assert_output --partial "3–6 **English** words"
  assert_output --partial "never slugify it verbatim"
}
