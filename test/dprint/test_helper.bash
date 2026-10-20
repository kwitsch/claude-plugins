#!/usr/bin/env bash
# Shared setup/helpers for the dprint bats suite.
# Loaded by every *.bats file in this directory via `load 'test_helper'`.

common_setup() {
  bats_require_minimum_version 1.5.0
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/dprint"
  SKILL_DIR="$PLUGIN/skills/init-dprint"
  SCRIPT="$SKILL_DIR/scripts/check-dprint.mjs"

  # Isolated PATH: only bash and node symlinked in; dprint stubs added per test.
  MOCKBIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$MOCKBIN"
  for t in bash node; do
    src="$(command -v "$t" 2> /dev/null)" && [ -n "$src" ] && ln -s "$src" "$MOCKBIN/$t"
  done

  # Isolated HOME so the ~/.dprint/bin fallback never sees a real install.
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME"
}

# make_stub <name> <body-line>... -- drop an executable bash stub into MOCKBIN.
# Stub bodies must not reference $BATS_TEST_TMPDIR (not exported to stubs).
make_stub() {
  local name="$1"
  shift
  {
    printf '#!/usr/bin/env bash\n'
    printf '%s\n' "$@"
  } > "$MOCKBIN/$name"
  chmod +x "$MOCKBIN/$name"
}
