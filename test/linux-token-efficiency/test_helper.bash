#!/usr/bin/env bash
# Shared setup/helpers for the linux-token-efficiency bats suite.
# Loaded by every *.bats file in this directory via `load 'test_helper'`.

common_setup() {
  bats_require_minimum_version 1.5.0
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/linux-token-efficiency"
  MANIFEST="$PLUGIN/.claude-plugin/plugin.json"
  PIN="$PLUGIN/rtk-bundle.json"
  HOOKS="$PLUGIN/hooks/hooks.json"
  HOOK="$PLUGIN/hooks/rtk-rewrite.mjs"
  SKILL_DIR="$REPO_ROOT/.claude/skills/update-linux-token-efficiency"

  # Isolated PATH: only system tools that actually exist on the host are symlinked
  # in; per-test stubs are added on top via make_stub.
  MOCKBIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$MOCKBIN"
  for t in bash env node jq git grep sed awk cat cut head find ls cp mv rm mkdir chmod tar sha256sum uname timeout sleep mktemp printf; do
    src="$(command -v "$t" 2> /dev/null)" && [ -n "$src" ] && ln -s "$src" "$MOCKBIN/$t"
  done

  # Isolated HOME so no test reads real user config.
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME"
}

# make_stub <name> <body-line>... -- drop an executable bash stub into MOCKBIN.
# The `rm -f` is load-bearing: MOCKBIN entries are symlinks to the real tools, and
# writing through a symlink would target the real binary instead of shadowing it.
make_stub() {
  make_stub_in "$MOCKBIN" "$@"
}

# make_stub_in <dir> <name> <body-line>... -- same, into an arbitrary directory.
make_stub_in() {
  local dir="$1" name="$2"
  shift 2
  mkdir -p "$dir"
  rm -f "$dir/$name"
  {
    printf '#!/usr/bin/env bash\n'
    printf '%s\n' "$@"
  } > "$dir/$name"
  chmod +x "$dir/$name"
}

# make_input <command> [extra-tool_input-json-object] -- print one PreToolUse Bash
# hook payload on stdout. Payloads always go in on stdin, never argv.
make_input() {
  local cmd="$1" extra="${2:-}"
  [ -n "$extra" ] || extra='{}'
  jq -cn --arg cmd "$cmd" --argjson extra "$extra" \
    '{hook_event_name:"PreToolUse", tool_name:"Bash", tool_input:({command:$cmd} + $extra)}'
}
