#!/usr/bin/env bats

# bump-version skill + bump-version.sh — coding-toolbox plugin.

load 'test_helper'

setup() {
  common_setup
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
@test "bump-version SKILL.md points at its reference doc before invoking" {
  run rg_or_grep -F 'bump-version.reference.md' "$PLUGIN/skills/bump-version/SKILL.md"
  assert_success
  run rg_or_grep -F '${CLAUDE_SKILL_DIR}/bump-version.sh' "$PLUGIN/skills/bump-version/SKILL.md"
  assert_success
}
@test "bump-version SKILL.md no longer embeds the script or heredoc wrapper" {
  run rg_or_grep -F 'BUMPVERSION_EOF' "$PLUGIN/skills/bump-version/SKILL.md"
  assert_failure
  run rg_or_grep -F 'detect_json "package.json"' "$PLUGIN/skills/bump-version/SKILL.md"
  assert_failure
}

# NOTE: do not hoist "$PLUGIN/skills/.../*.sh" into a bare top-level
# variable assignment here — bare statements between @test blocks in a
# .bats file execute once at file-source time, BEFORE setup() has ever run
# for any test, so $PLUGIN (assigned inside setup()) would still be unset
# at that point and the path would silently resolve wrong (a leading-slash
# path with no error until something reads it). Build the path inside the
# wrapper function itself instead — it's only ever called from within a
# running @test, after that test's own setup() has already executed.
run_bumpver() {
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" \
    bash "$PLUGIN/skills/bump-version/bump-version.sh" "$@"
}
@test "bump-version.sh: usage error with no argument" {
  run_bumpver
  assert_failure 2
  assert_output --partial "usage"
}
@test "bump-version.sh: usage error with an unrecognized part" {
  run_bumpver bogus
  assert_failure 2
}
@test "bump-version.sh: no supported version file found" {
  cd "$BATS_TEST_TMPDIR" || return 1
  run_bumpver patch
  assert_failure 3
  assert_output --partial "no supported version file"
}
@test "bump-version.sh: bumps package.json patch and syncs the lock file" {
  cd "$BATS_TEST_TMPDIR" || return 1
  cat > package.json <<'EOF'
{
  "name": "fixture",
  "version": "1.2.3"
}
EOF
  make_stub npm 'echo "npm $*" > npm-args; exit 0'
  echo '{}' > package-lock.json
  run_bumpver patch
  assert_success
  assert_output --partial "old: 1.2.3"
  assert_output --partial "new: 1.2.4"
  run rg_or_grep -F '"version": "1.2.4"' package.json
  assert_success
}
@test "bump-version.sh: composer.json minor bump zeroes patch" {
  cd "$BATS_TEST_TMPDIR" || return 1
  cat > composer.json <<'EOF'
{
  "name": "fixture/fixture",
  "version": "1.2.3"
}
EOF
  run_bumpver minor
  assert_success
  assert_output --partial "new: 1.3.0"
}
@test "bump-version.sh: pom.xml skips a leading parent block" {
  cd "$BATS_TEST_TMPDIR" || return 1
  cat > pom.xml <<'EOF'
<project>
  <parent>
    <version>9.9.9</version>
  </parent>
  <version>1.2.3</version>
</project>
EOF
  run_bumpver major
  assert_success
  assert_output --partial "old: 1.2.3"
  assert_output --partial "new: 2.0.0"
}
@test "bump-version.sh: rejects a non-bare-semver VERSION file" {
  cd "$BATS_TEST_TMPDIR" || return 1
  echo "1.2.3-beta" > VERSION
  run_bumpver patch
  assert_failure 4
}
@test "bump-version.sh: sync_failed reports version bumped but sync did not complete" {
  cd "$BATS_TEST_TMPDIR" || return 1
  cat > package.json <<'EOF'
{
  "version": "1.0.0"
}
EOF
  echo '{}' > package-lock.json
  make_stub npm 'echo "boom" >&2; exit 1'
  run_bumpver patch
  assert_failure 6
  assert_output --partial "new: 1.0.1"
}
@test "bump-version.sh: write_failed when the version file's directory is read-only" {
  mkdir -p "$BATS_TEST_TMPDIR/ro"
  cat > "$BATS_TEST_TMPDIR/ro/package.json" <<'EOF'
{
  "version": "1.0.0"
}
EOF
  chmod 555 "$BATS_TEST_TMPDIR/ro"
  cd "$BATS_TEST_TMPDIR/ro" || return 1
  run_bumpver patch
  chmod 755 "$BATS_TEST_TMPDIR/ro"
  assert_failure 5
}
@test "bump-version.sh: sync_temp_failed when TMPDIR is invalid for the lock-sync mktemp" {
  cd "$BATS_TEST_TMPDIR" || return 1
  cat > package.json <<'EOF'
{
  "version": "1.0.0"
}
EOF
  echo '{}' > package-lock.json
  make_stub npm 'exit 0'
  run env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR/does-not-exist" \
    bash "$PLUGIN/skills/bump-version/bump-version.sh" patch
  assert_failure 7
  assert_output --partial "new: 1.0.1"
}
@test "plugin README lists bump-version in a Skills section" {
  run rg_or_grep -F '| `bump-version`' "$PLUGIN/README.md"
  assert_success
}
@test "plugin.json description mentions bump-version" {
  run jq -r '.description' "$PLUGIN/.claude-plugin/plugin.json"
  assert_output --partial "bump-version"
}
