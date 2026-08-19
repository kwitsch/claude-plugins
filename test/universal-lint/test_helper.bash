#!/usr/bin/env bash
# Shared setup/helpers for the universal-lint bats suite.
# Loaded by every *.bats file in this directory via `load 'test_helper'`.

common_setup() {
  bats_require_minimum_version 1.5.0
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/universal-lint"
  HOOKS="$PLUGIN/hooks/hooks.json"
  SERVER="$PLUGIN/hooks/lint-file.mjs"

  # Isolated PATH: only system tools symlinked in; linter stubs added per test.
  MOCKBIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$MOCKBIN"
  for t in bash node; do
    src="$(command -v "$t" 2> /dev/null)" && [ -n "$src" ] && ln -s "$src" "$MOCKBIN/$t"
  done

  # Isolated HOME so no test reads real user config.
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME/.claude"
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
  if command -v rg > /dev/null 2>&1; then
    local args=() a stripped seen_dashdash=false
    for a in "$@"; do
      if [ "$seen_dashdash" = true ]; then
        args+=("$a")
        continue
      fi
      case "$a" in
        --)
          seen_dashdash=true
          args+=("$a")
          ;;
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

# make_stub <name> <body-line>... -- drop an executable bash stub into MOCKBIN.
make_stub() {
  local name="$1"
  shift
  {
    printf '#!/usr/bin/env bash\n'
    printf '%s\n' "$@"
  } > "$MOCKBIN/$name"
  chmod +x "$MOCKBIN/$name"
}

# A recording stub: appends "<name> <argv>" to $RECORD, prints $OUT (env-supplied
# at call time by lint_file_call, read at stub-RUN-time, not baked in at
# definition time) to stdout, never touches the target file (a linter never
# modifies anything).
rec_stub() {
  local name="$1" exit_code="$2"
  make_stub "$name" \
    'printf "%s %s\n" "'"$name"'" "$*" >> "$RECORD"' \
    'printf '\''%s\n'\'' "$OUT"' \
    'exit '"$exit_code"
}

# lint_file_call <file_path> <cwd> -- pipe one PostToolUse hook-JSON object into a
# fresh lint-file.mjs invocation, on the isolated PATH. Echoes stdout, or the
# literal string "{}" when the script printed nothing (matches the handler's
# own "no finding" contract, so `[ "$output" = "{}" ]` assertions keep working
# unchanged from the old JSON-RPC-driven helper).
lint_file_call() {
  local fp="$1" cwd="$2"
  local out
  out="$(jq -cn --arg f "$fp" --arg c "$cwd" '{hook_event_name:"PostToolUse", tool_name:"Write", tool_input:{file_path:$f}, tool_response:{success:true}, cwd:$c}' \
    | env PATH="$MOCKBIN" HOME="$HOME" RECORD="$RECORD" OUT="$OUT" UNIVERSAL_LINT_DEBOUNCE_MS="${UNIVERSAL_LINT_DEBOUNCE_MS:-0}" node "$SERVER" 2> /dev/null)"
  if [ -n "$out" ]; then printf '%s' "$out"; else printf '{}'; fi
}
