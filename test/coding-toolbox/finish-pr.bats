#!/usr/bin/env bats

# finish-pr skill + its bundled scripts/*.sh -- coding-toolbox plugin.

load 'test_helper'

setup() {
  common_setup
}

@test "finish-pr SKILL.md exists and is non-empty" {
  run test -s "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
}

@test "finish-pr frontmatter declares name/description/allowed-tools and stays scoped" {
  run bash -c "sed -n '/^---\$/,/^---\$/p' '$PLUGIN/skills/finish-pr/SKILL.md'"
  assert_success
  assert_output --partial "name: finish-pr"
  assert_output --partial "AskUserQuestion"
  assert_output --partial 'Bash(gh:*)'
  assert_output --partial 'Bash(glab:*)'
  # Bash(bash:*) is used both for the bundled scripts and for rebase.sh
  # (fresh-pr's own, reused here via plugin_root for the freshness check)
  assert_output --partial "Bash(bash:*)"
  # tripwire: this skill dispatches nothing and takes no arguments
  refute_output --partial "Agent"
  refute_output --partial "Workflow"
  refute_output --partial "TaskCreate"
  refute_output --partial "argument-hint"
}

@test "finish-pr SKILL.md points at each script's reference doc before invoking it" {
  run rg_or_grep -F 'scripts/find-pr.reference.md' "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F '${CLAUDE_SKILL_DIR}/scripts/find-pr.sh' "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F 'scripts/finalize-pr.reference.md' "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F '${CLAUDE_SKILL_DIR}/scripts/finalize-pr.sh' "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F 'scripts/apply-pr-update.reference.md' "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F '${CLAUDE_SKILL_DIR}/scripts/apply-pr-update.sh' "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
}

@test "finish-pr SKILL.md no longer embeds the lookup/mutation mechanics inline" {
  # tripwire: these now live only in the bundled scripts, never duplicated
  # verbatim in the skill's own prose.
  for needle in 'gh pr view' 'gh api -X PATCH' 'glab api' "FINISHPR_TITLE" \
    'should_remove_source_branch' 'gh pr ready' '--remove-source-branch' \
    'encoded_branch' '@uri'; do
    run rg_or_grep -F -- "$needle" "$PLUGIN/skills/finish-pr/SKILL.md"
    assert_failure
  done
}

@test "finish-pr aborts when no PR/MR exists for the branch" {
  run rg_or_grep -F "No PR/MR found for branch" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
}

@test "finish-pr handles merged and closed PR/MR states before any mutation" {
  run rg_or_grep -F "already merged" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "closed (not merged)" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
}

@test "finish-pr surfaces find-pr.sh's exit codes, including the ambiguous-platform ask" {
  run rg_or_grep -F "ambiguous_platform" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "source_branch_mismatch" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "cli_unavailable" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
}

@test "finish-pr verifies local HEAD matches the PR/MR's remote head before reconciling" {
  run rg_or_grep -F "head_sha" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "git rev-parse HEAD" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
}

@test "finish-pr reuses fresh-pr's rebase.sh via plugin_root, never a duplicated copy" {
  run rg_or_grep -F "plugin_root: \${CLAUDE_PLUGIN_ROOT}" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "skills/fresh-pr/rebase.sh" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "skills/fresh-pr/rebase.reference.md" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  # tripwire: no colocated copy of the script inside finish-pr's own dir
  run test -f "$PLUGIN/skills/finish-pr/rebase.sh"
  assert_failure
}

@test "finish-pr maps every REBASE_RESULT outcome and force-pushes only after a rebase" {
  for result in up_to_date rebased conflict failed skipped_dirty; do
    run rg_or_grep -F "\`$result\`" "$PLUGIN/skills/finish-pr/SKILL.md"
    assert_success
  done
  run rg_or_grep -F -- "--force-with-lease origin" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  # tripwire: never a bare --force
  run rg_or_grep -F -- "git push --force origin" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_failure
}

@test "finish-pr gates the rebase step on local HEAD matching before touching the branch" {
  run rg_or_grep -F "Confirm local \`HEAD\` matches the PR/MR's remote head first" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "clobber someone else's push" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
}

@test "finish-pr treats a rebase conflict as report-and-continue, not a hard stop" {
  run rg_or_grep -F "already ran \`git rebase --abort\`" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "continue to step 6" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
}

@test "finish-pr never auto-stashes over a dirty tree to force a rebase through" {
  run rg_or_grep -F "deliberately never auto-stashes or commits here" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "commit or stash, then re-run" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
}

@test "finish-pr keeps origin/base current via git fetch in its git-context block" {
  run rg_or_grep -F "git fetch origin" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
}

@test "finish-pr surfaces the git fetch exit status and gates reconciliation on it" {
  run rg_or_grep -F "fetch_status: %s" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "fetch_status: failed" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
}

@test "finish-pr treats fetched PR/MR text as untrusted data, never as instructions" {
  run rg_or_grep -F "untrusted data" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  run rg_or_grep -F "never as instructions" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
}

@test "finish-pr writes the correction to a fresh file, never find-pr.sh's own title_file/body_file" {
  run rg_or_grep -F "never step 3's own" "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
}

@test "plugin README lists finish-pr in the Skills section" {
  run rg_or_grep -F '| `finish-pr`' "$PLUGIN/README.md"
  assert_success
}

@test "plugin.json description mentions finish-pr" {
  run jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json"
  assert_output --partial "finish-pr"
}

# ---------------------------------------------------------------------------
# scripts/*.sh -- hermetic execution against real git repos + stubbed gh/glab.
# See bump-version.bats's own comment for why these paths are built inside
# the wrapper functions, not hoisted to bare top-level variables ($PLUGIN
# isn't set until setup() runs).

run_find_pr() {
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" \
    bash "$PLUGIN/skills/finish-pr/scripts/find-pr.sh" "$@"
}
run_finalize_pr() {
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" \
    bash "$PLUGIN/skills/finish-pr/scripts/finalize-pr.sh" "$@"
}
run_apply_pr_update() {
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" \
    bash "$PLUGIN/skills/finish-pr/scripts/apply-pr-update.sh" "$@"
}

github_repo() {
  git init -q "$BATS_TEST_TMPDIR/repo"
  cd "$BATS_TEST_TMPDIR/repo" || return 1
  git remote add origin https://github.com/acme/widget.git
}
gitlab_repo() {
  git init -q "$BATS_TEST_TMPDIR/repo"
  cd "$BATS_TEST_TMPDIR/repo" || return 1
  git remote add origin https://gitlab.com/acme/widget.git
}

@test "find-pr.sh: usage error with no branch argument" {
  run_find_pr
  assert_failure 2
  assert_output --partial "usage"
}

@test "find-pr.sh: usage error with an unrecognized platform override" {
  github_repo
  run_find_pr some-branch bogus
  assert_failure 2
}

@test "find-pr.sh: cli_unavailable when gh isn't on PATH" {
  github_repo
  run_find_pr some-branch
  assert_failure 3
  assert_output --partial "gh not found on PATH"
}

@test "find-pr.sh: cli_unavailable when gh is unauthenticated" {
  github_repo
  make_stub gh 'exit 1'
  run_find_pr some-branch
  assert_failure 3
  assert_output --partial "gh is not authenticated"
}

@test "find-pr.sh: github found, open, draft" {
  github_repo
  make_stub gh '
    [ "$1 $2" = "auth status" ] && exit 0
    if [ "$1 $2" = "pr view" ]; then
      echo "{\"number\":42,\"state\":\"OPEN\",\"url\":\"https://github.com/acme/widget/pull/42\",\"title\":\"Add widget\",\"body\":\"does stuff\",\"baseRefName\":\"main\",\"isDraft\":true,\"headRefOid\":\"abc123\"}"
      exit 0
    fi
    exit 1
  '
  run_find_pr some-branch
  assert_success
  assert_output --partial "platform: github"
  assert_output --partial "found: yes"
  assert_output --partial "state: open"
  assert_output --partial "number: 42"
  assert_output --partial "draft: true"
  assert_output --partial "head_sha: abc123"
  title_file="$(echo "$output" | rg_or_grep '^title_file: ' | cut -d' ' -f2)"
  body_file="$(echo "$output" | rg_or_grep '^body_file: ' | cut -d' ' -f2)"
  [ -f "$title_file" ]; [ "$(cat "$title_file")" = "Add widget" ]
  [ -f "$body_file" ]; [ "$(cat "$body_file")" = "does stuff" ]
}

@test "find-pr.sh: github not found" {
  github_repo
  make_stub gh '
    [ "$1 $2" = "auth status" ] && exit 0
    [ "$1 $2" = "pr view" ] && exit 1
    exit 1
  '
  run_find_pr ghost-branch
  assert_success
  assert_output --partial "found: no"
}

@test "find-pr.sh: github merged" {
  github_repo
  make_stub gh '
    [ "$1 $2" = "auth status" ] && exit 0
    if [ "$1 $2" = "pr view" ]; then
      echo "{\"number\":1,\"state\":\"MERGED\",\"url\":\"https://x\",\"title\":\"t\",\"body\":\"b\",\"baseRefName\":\"main\",\"isDraft\":false,\"headRefOid\":\"deadbeef\"}"
      exit 0
    fi
    exit 1
  '
  run_find_pr some-branch
  assert_success
  assert_output --partial "state: merged"
}

@test "find-pr.sh: gitlab found, open" {
  gitlab_repo
  make_stub glab '
    [ "$1 $2" = "auth status" ] && exit 0
    if [ "$1" = "api" ]; then
      case "$2" in
        *state=opened*)
          echo "[{\"iid\":7,\"web_url\":\"https://gitlab.com/acme/widget/-/merge_requests/7\",\"target_branch\":\"main\",\"draft\":false,\"sha\":\"deadbeef\",\"should_remove_source_branch\":null,\"force_remove_source_branch\":false,\"state\":\"opened\",\"source_branch\":\"feature-x\",\"title\":\"Feature X\",\"description\":\"does other stuff\"}]"
          exit 0 ;;
      esac
    fi
    exit 1
  '
  run_find_pr feature-x
  assert_success
  assert_output --partial "platform: gitlab"
  assert_output --partial "number: 7"
  assert_output --partial "should_remove_source_branch: null"
}

@test "find-pr.sh: gitlab source_branch mismatch is a hard error, never trusted" {
  gitlab_repo
  make_stub glab '
    [ "$1 $2" = "auth status" ] && exit 0
    if [ "$1" = "api" ]; then
      case "$2" in
        *state=opened*)
          echo "[{\"iid\":7,\"web_url\":\"https://x\",\"target_branch\":\"main\",\"draft\":false,\"sha\":\"deadbeef\",\"should_remove_source_branch\":null,\"force_remove_source_branch\":false,\"state\":\"opened\",\"source_branch\":\"feature-x\",\"title\":\"t\",\"description\":\"d\"}]"
          exit 0 ;;
      esac
    fi
    exit 1
  '
  run_find_pr different-branch
  assert_failure 5
  assert_output --partial "does not equal"
}

@test "find-pr.sh: ambiguous host resolves via auth-status probe when exactly one CLI knows it" {
  git init -q "$BATS_TEST_TMPDIR/repo"
  cd "$BATS_TEST_TMPDIR/repo" || return 1
  git remote add origin https://git.example.com/acme/widget.git
  make_stub gh '
    [ "$*" = "auth status --hostname git.example.com" ] && exit 0
    [ "$1 $2" = "auth status" ] && exit 0
    [ "$1 $2" = "pr view" ] && exit 1
    exit 1
  '
  make_stub glab 'exit 1'
  run_find_pr some-branch
  assert_success
  assert_output --partial "platform: github"
}

@test "find-pr.sh: platform override skips auto-detection entirely" {
  git init -q "$BATS_TEST_TMPDIR/repo"
  cd "$BATS_TEST_TMPDIR/repo" || return 1
  git remote add origin https://git.example.com/acme/widget.git
  # no auth-status stub behavior needed for the host probe -- an override
  # must never call it
  make_stub gh '
    [ "$*" = "auth status --hostname git.example.com" ] && { echo "SHOULD NOT BE CALLED" >&2; exit 1; }
    [ "$1 $2" = "auth status" ] && exit 0
    [ "$1 $2" = "pr view" ] && exit 1
    exit 1
  '
  run_find_pr some-branch github
  assert_success
  assert_output --partial "platform: github"
}

@test "find-pr.sh: ambiguous custom host with neither/both CLIs knowing it" {
  git init -q "$BATS_TEST_TMPDIR/repo"
  cd "$BATS_TEST_TMPDIR/repo" || return 1
  git remote add origin https://git.example.com/acme/widget.git
  make_stub gh 'exit 1'
  make_stub glab 'exit 1'
  run_find_pr some-branch
  assert_failure 4
  assert_output --partial "ambiguous host"
}

@test "finalize-pr.sh: usage errors" {
  run_finalize_pr
  assert_failure 2
  run_finalize_pr github
  assert_failure 2
  run_finalize_pr github 42 bogus
  assert_failure 2
}

@test "finalize-pr.sh: github undrafts when draft=yes, no-ops the GitLab-only toggle" {
  # $TMPDIR (not $BATS_TEST_TMPDIR) inside the stub body -- run_finalize_pr's
  # `env -i` wipes everything except PATH/HOME/TMPDIR, so only TMPDIR
  # survives into the stub's own environment.
  make_stub gh 'echo "ARGS: $*" >> "$TMPDIR/gh-calls"; exit 0'
  run_finalize_pr github 42 yes
  assert_success
  assert_output --partial "draft_before: yes"
  assert_output --partial "draft_after: no"
  assert_output --partial "delete_source_branch: n/a"
  run cat "$BATS_TEST_TMPDIR/gh-calls"
  assert_output --partial "pr ready 42"
}

@test "finalize-pr.sh: github draft=no is a pure no-op (no gh call)" {
  # no gh stub at all -- any call would fail with "command not found"
  run_finalize_pr github 42 no
  assert_success
  assert_output --partial "draft_before: no"
  assert_output --partial "draft_after: no"
  assert_output --partial "delete_source_branch: n/a"
}

@test "finalize-pr.sh: undraft_failed when gh pr ready fails" {
  make_stub gh 'exit 1'
  run_finalize_pr github 42 yes
  assert_failure 3
}

@test "finalize-pr.sh: gitlab toggle enabled when currently off" {
  make_stub glab '
    if [ "$1" = "mr" ] && [ "$2" = "update" ]; then
      echo "ARGS: $*" >> "$TMPDIR/glab-calls"
      exit 0
    fi
    if [ "$1" = "api" ]; then
      echo "{\"should_remove_source_branch\":false,\"force_remove_source_branch\":false}"
      exit 0
    fi
    exit 1
  '
  run_finalize_pr gitlab 7 yes
  assert_success
  assert_output --partial "delete_source_branch: enabled"
  run cat "$BATS_TEST_TMPDIR/glab-calls"
  assert_output --partial -- "--ready"
  assert_output --partial -- "--remove-source-branch"
}

@test "finalize-pr.sh: gitlab toggle already_on is never re-flipped" {
  make_stub glab '
    if [ "$1" = "mr" ] && [ "$2" = "update" ]; then
      echo "SHOULD NOT BE CALLED: $*" >&2; exit 1
    fi
    if [ "$1" = "api" ]; then
      echo "{\"should_remove_source_branch\":true,\"force_remove_source_branch\":false}"
      exit 0
    fi
    exit 1
  '
  run_finalize_pr gitlab 7 no
  assert_success
  assert_output --partial "delete_source_branch: already_on"
}

@test "finalize-pr.sh: gitlab toggle forced skips the call entirely" {
  make_stub glab '
    if [ "$1" = "mr" ] && [ "$2" = "update" ]; then
      echo "SHOULD NOT BE CALLED: $*" >&2; exit 1
    fi
    if [ "$1" = "api" ]; then
      echo "{\"should_remove_source_branch\":false,\"force_remove_source_branch\":true}"
      exit 0
    fi
    exit 1
  '
  run_finalize_pr gitlab 7 no
  assert_success
  assert_output --partial "delete_source_branch: forced"
}

@test "finalize-pr.sh: gitlab refetch_failed when the re-fetch API call fails" {
  make_stub glab 'if [ "$1" = "api" ]; then exit 1; fi; exit 0'
  run_finalize_pr gitlab 7 no
  assert_failure 4
}

@test "apply-pr-update.sh: usage errors" {
  run_apply_pr_update
  assert_failure 2
  run_apply_pr_update github 42 "$BATS_TEST_TMPDIR/nonexistent-title" "$BATS_TEST_TMPDIR/nonexistent-body"
  assert_failure 2
}

@test "apply-pr-update.sh: github apply and verify succeed" {
  printf 'New Title' > "$BATS_TEST_TMPDIR/title"
  printf 'New body text' > "$BATS_TEST_TMPDIR/body"
  make_stub gh '
    if [ "$1" = "api" ] && [ "$2" = "-X" ]; then exit 0; fi
    if [ "$1" = "api" ]; then echo "{\"title\":\"New Title\",\"body\":\"New body text\"}"; exit 0; fi
    exit 1
  '
  run_apply_pr_update github 42 "$BATS_TEST_TMPDIR/title" "$BATS_TEST_TMPDIR/body"
  assert_success
  assert_output --partial "applied: yes"
  assert_output --partial "verified: yes"
}

@test "apply-pr-update.sh: github verify_mismatch is reported, not silently swallowed" {
  printf 'New Title' > "$BATS_TEST_TMPDIR/title"
  printf 'New body text' > "$BATS_TEST_TMPDIR/body"
  make_stub gh '
    if [ "$1" = "api" ] && [ "$2" = "-X" ]; then exit 0; fi
    if [ "$1" = "api" ]; then echo "{\"title\":\"Wrong Title\",\"body\":\"New body text\"}"; exit 0; fi
    exit 1
  '
  run_apply_pr_update github 42 "$BATS_TEST_TMPDIR/title" "$BATS_TEST_TMPDIR/body"
  assert_failure 5
  assert_output --partial "verification mismatch"
}

@test "apply-pr-update.sh: github apply_failed when the PATCH call fails" {
  printf 'New Title' > "$BATS_TEST_TMPDIR/title"
  printf 'New body text' > "$BATS_TEST_TMPDIR/body"
  make_stub gh 'exit 1'
  run_apply_pr_update github 42 "$BATS_TEST_TMPDIR/title" "$BATS_TEST_TMPDIR/body"
  assert_failure 3
}

@test "apply-pr-update.sh: gitlab apply and verify succeed, never re-parsed through the shell" {
  printf 'Fix \$(rm -rf /) title' > "$BATS_TEST_TMPDIR/title"
  printf 'body with `backticks` and $(cmd)' > "$BATS_TEST_TMPDIR/body"
  make_stub glab '
    if [ "$1" = "mr" ] && [ "$2" = "update" ]; then exit 0; fi
    if [ "$1" = "api" ]; then
      title="$(cat "'"$BATS_TEST_TMPDIR"'/title")"
      body="$(cat "'"$BATS_TEST_TMPDIR"'/body")"
      jq -n --arg t "$title" --arg d "$body" "{title: \$t, description: \$d}"
      exit 0
    fi
    exit 1
  '
  run_apply_pr_update gitlab 7 "$BATS_TEST_TMPDIR/title" "$BATS_TEST_TMPDIR/body"
  assert_success
  assert_output --partial "applied: yes"
  assert_output --partial "verified: yes"
}

@test "finish-pr captures the plugin root via bare substitution, never inside its load-time git-context injection" {
  run rg_or_grep -F 'plugin_root: ${CLAUDE_PLUGIN_ROOT}' "$PLUGIN/skills/finish-pr/SKILL.md"
  assert_success
  # anti-pattern: $CLAUDE_PLUGIN_ROOT inside the `!`-injected git-context block
  # fails outright, deterministically, inside a worktree-isolated session.
  run bash -c "sed -n '/^!\`/p' '$PLUGIN/skills/finish-pr/SKILL.md' | grep -F 'CLAUDE_PLUGIN_ROOT'"
  assert_failure
}
