#!/usr/bin/env bash
# Shared setup/helpers for the npm-automations bats suite.
# Loaded by every *.bats file in this directory via `load 'test_helper'`.

common_setup() {
  bats_require_minimum_version 1.5.0
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/npm-automations"
  HOOKS="$PLUGIN/hooks"

  # Isolated HOME so no test reads real user config (e.g. npm's own ~/.npmrc).
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME"
}

# Prefer ripgrep; fall back to grep if rg isn't installed (same wrapper as
# test/coding-toolbox/test_helper.bash).
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
