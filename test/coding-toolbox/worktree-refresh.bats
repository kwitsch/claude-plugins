#!/usr/bin/env bats

# worktree_refresh hook (PostToolUse EnterWorktree) — coding-toolbox plugin.

load 'test_helper'

setup() {
  common_setup
}

@test "PostToolUse hook is wired to worktree_refresh for the EnterWorktree matcher" {
  # Position-independent in both dimensions: find the EnterWorktree matcher among all
  # PostToolUse entries, then the mcp_tool handler inside its hooks array (which
  # npm-ci-on-worktree shares) — match by content, never by index.
  run jq -e 'any(.hooks.PostToolUse[]; .matcher == "EnterWorktree"
    and any(.hooks[]; .type == "mcp_tool" and .server == "plugin:coding-toolbox:coding-toolbox-hooks" and .tool == "worktree_refresh"))' "$HOOKS/hooks.json"
  assert_success
}
@test "worktree_refresh tool is listed by the MCP server" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  run bash -c '
    { printf "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}\n"
      printf "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}\n"
    } | node "'"$PLUGIN"'/mcp/server.mjs" 2>/dev/null \
      | jq -c "select(.id == 2) | [.result.tools[].name]"
  '
  assert_success
  # the registered tool NAME, structurally — a substring match would also accept
  # the string merely appearing inside some tool's description.
  echo "$output" | jq -e 'any(.[]; . == "worktree_refresh")'
}

# Drive the worktree_refresh MCP tool with a JSON arguments blob. Echoes the
# tools/call structuredContent JSON (same pattern as interaction_gate_call).
worktree_refresh_call() {
  local args_json="$1"
  {
    printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n'
    printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"worktree_refresh","arguments":%s}}\n' "$args_json"
  } | node "$PLUGIN/mcp/server.mjs" 2>/dev/null \
    | jq -c 'select(.id == 2) | .result.structuredContent'
}

# Build a hermetic git fixture: a bare "origin", a "checkout" clone on the
# default branch (main), and a linked "worktree" already checked out at the
# same tip. Echoes "<origin> <checkout> <worktree>" (space-separated paths).
setup_worktree_fixture() {
  local base
  base="$(mktemp -d "$BATS_TEST_TMPDIR/git-fixture-XXXXXX")"
  local origin="$base/origin.git" checkout="$base/checkout" wt="$base/wt"

  git init --bare -q "$origin"
  git init -q -b main "$checkout"
  git -C "$checkout" config user.email test@example.com
  git -C "$checkout" config user.name test
  echo "hello" > "$checkout/file.txt"
  git -C "$checkout" add file.txt
  git -C "$checkout" commit -q -m initial
  git -C "$checkout" remote add origin "$origin"
  git -C "$checkout" push -q origin main
  git -C "$checkout" remote set-head origin -a >/dev/null 2>&1 \
    || git -C "$checkout" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main

  git -C "$checkout" worktree add -q -b wt-branch "$wt" main

  printf '%s %s %s\n' "$origin" "$checkout" "$wt"
}

# Commit one more change on $2 (the "checkout" clone) and push it to $1 (the
# bare "origin"), simulating "upstream moved on after the worktree was made".
advance_upstream() {
  local origin="$1" checkout="$2"
  echo "more" >> "$checkout/file.txt"
  git -C "$checkout" commit -q -am "upstream advance"
  git -C "$checkout" push -q origin main
}
@test "worktree_refresh fetches and rebases a new worktree onto origin's default branch" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  read -r ORIGIN CHECKOUT WT < <(setup_worktree_fixture)
  advance_upstream "$ORIGIN" "$CHECKOUT"

  local args
  args="$(jq -cn --arg cwd "$WT" '{cwd: $cwd, tool_name: "EnterWorktree", tool_input: {name: "x"}, tool_response: {worktreePath: $cwd}}')"
  run worktree_refresh_call "$args"
  assert_success
  assert_output "{}"

  run git -C "$WT" log -1 --format=%s
  assert_output "upstream advance"
}
@test "worktree_refresh no-ops when CODING_TOOLBOX_WORKTREE_REFRESH=false, even for an otherwise-successful refresh" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  read -r ORIGIN CHECKOUT WT < <(setup_worktree_fixture)
  advance_upstream "$ORIGIN" "$CHECKOUT"

  local args
  args="$(jq -cn --arg cwd "$WT" '{cwd: $cwd, tool_name: "EnterWorktree", tool_input: {name: "x"}, tool_response: {worktreePath: $cwd}}')"
  CODING_TOOLBOX_WORKTREE_REFRESH=false run worktree_refresh_call "$args"
  assert_success
  assert_output "{}"

  # proves the toggle short-circuited BEFORE any git call, not that fetch+rebase
  # happened to no-op: the upstream commit is genuinely absent from the worktree.
  run git -C "$WT" log -1 --format=%s
  refute_output "upstream advance"
}
@test "worktree_refresh: fail-open on an unset/placeholder env still runs the refresh" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  read -r ORIGIN CHECKOUT WT < <(setup_worktree_fixture)
  advance_upstream "$ORIGIN" "$CHECKOUT"

  local args
  args="$(jq -cn --arg cwd "$WT" '{cwd: $cwd, tool_name: "EnterWorktree", tool_input: {name: "x"}, tool_response: {worktreePath: $cwd}}')"
  # An un-interpolated placeholder (an old Claude Code build that can't resolve
  # ${user_config.*} in an MCP server's env) is not the literal "false" — fail-open.
  CODING_TOOLBOX_WORKTREE_REFRESH='${user_config.worktree_refresh}' run worktree_refresh_call "$args"
  assert_success
  assert_output "{}"

  run git -C "$WT" log -1 --format=%s
  assert_output "upstream advance"
}
@test "worktree_refresh skips when tool_input carries path (switch, not create)" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  read -r ORIGIN CHECKOUT WT < <(setup_worktree_fixture)
  git -C "$WT" remote set-url origin /nonexistent/path

  local args
  args="$(jq -cn --arg cwd "$WT" '{cwd: $cwd, tool_name: "EnterWorktree", tool_input: {path: $cwd}, tool_response: {worktreePath: $cwd}}')"
  run worktree_refresh_call "$args"
  assert_success
  assert_output "{}"
}
@test "worktree_refresh skips when cwd/worktreePath is not a linked worktree" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  read -r ORIGIN CHECKOUT WT < <(setup_worktree_fixture)
  git -C "$CHECKOUT" remote set-url origin /nonexistent/path

  local args
  args="$(jq -cn --arg cwd "$CHECKOUT" '{cwd: $cwd, tool_name: "EnterWorktree", tool_input: {name: "x"}, tool_response: {worktreePath: $cwd}}')"
  run worktree_refresh_call "$args"
  assert_success
  assert_output "{}"
}

# Regression guard for the same abs-vs-relative hazard fresh-branch's detection hit
# (commit 23328db): from a SUBdirectory, --git-dir comes back absolute while
# --git-common-dir comes back relative to git's cwd. Resolving that relative value
# against the node process's cwd instead of the target's makes a plain main checkout
# look like a linked worktree — and then fetch+rebase runs in the user's checkout.
@test "worktree_refresh resolves a relative --git-common-dir against the target cwd, not node's" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  read -r ORIGIN CHECKOUT WT < <(setup_worktree_fixture)
  mkdir -p "$CHECKOUT/sub" "$WT/sub"
  # advance origin/main from the worktree, so the checkout is genuinely behind:
  # a wrongly-detected checkout would visibly move to this commit.
  printf 'worktree change\n' > "$WT/file.txt"
  git -C "$WT" commit -q -am "worktree advance"
  git -C "$WT" push -q origin wt-branch:main

  local args out
  args="$(jq -cn --arg cwd "$CHECKOUT/sub" '{cwd: $cwd, tool_name: "EnterWorktree", tool_input: {name: "x"}, tool_response: {}}')"
  # node's cwd is the worktree subdir, where "../.git" resolves to a real (but
  # different) git dir — the false-positive case.
  out="$(cd "$WT/sub" && worktree_refresh_call "$args")"
  [ "$out" = "{}" ]

  run git -C "$CHECKOUT" log -1 --format=%s
  assert_output "initial"
}
@test "worktree_refresh aborts and reports a rebase conflict" {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  read -r ORIGIN CHECKOUT WT < <(setup_worktree_fixture)
  printf 'worktree change\n' > "$WT/file.txt"
  git -C "$WT" commit -q -am "worktree-local edit"
  printf 'upstream change\n' > "$CHECKOUT/file.txt"
  git -C "$CHECKOUT" commit -q -am "upstream conflicting edit"
  git -C "$CHECKOUT" push -q origin main

  local args
  args="$(jq -cn --arg cwd "$WT" '{cwd: $cwd, tool_name: "EnterWorktree", tool_input: {name: "x"}, tool_response: {worktreePath: $cwd}}')"
  run worktree_refresh_call "$args"
  assert_success
  # own wrapper text AND git's real diagnostic — execFileSync's e.message only
  # carries the "Command failed: …" wrapper, the diagnostic lives in e.stderr.
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext
    | test("conflicted and was aborted") and test("could not apply")'

  local gitdir
  gitdir="$(git -C "$WT" rev-parse --git-dir)"
  [ ! -d "$gitdir/rebase-merge" ]
  [ ! -d "$gitdir/rebase-apply" ]
}
@test "plugin.json declares worktree_refresh userConfig: boolean, default true, fail-open" {
  run jq -e '.userConfig.worktree_refresh
    | .type == "boolean"
      and .default == true
      and (.title | length > 0)
      and (.description | length > 0)' "$PLUGIN/.claude-plugin/plugin.json"
  assert_success
}
@test "plugin.json description mentions the worktree_refresh hook" {
  run jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json"
  assert_output --partial "worktree_refresh"
}
@test ".mcp.json wires worktree_refresh's userConfig toggle via env, not hooks.json input" {
  run jq -e '.mcpServers["coding-toolbox-hooks"].env.CODING_TOOLBOX_WORKTREE_REFRESH == "${user_config.worktree_refresh}"' "$PLUGIN/.mcp.json"
  assert_success
}
