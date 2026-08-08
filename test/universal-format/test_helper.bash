#!/usr/bin/env bash
# Shared setup/helpers for the universal-format bats suite.
# Loaded by every *.bats file in this directory via `load 'test_helper'`.

common_setup() {
  bats_require_minimum_version 1.5.0
  bats_load_library bats-support
  bats_load_library bats-assert
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PLUGIN="$REPO_ROOT/plugins/universal-format"
  HOOKS="$PLUGIN/hooks/hooks.json"
  SERVER="$PLUGIN/mcp/server.mjs"
  MCP_JSON="$PLUGIN/.mcp.json"
  WRAPPER="$PLUGIN/bin/mjs-launch.sh"

  # Isolated PATH: only system tools symlinked in; formatter stubs added per test.
  MOCKBIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$MOCKBIN"
  for t in bash env node jq cat rm mkdir mktemp dirname head grep ln sleep printf; do
    src="$(command -v "$t" 2>/dev/null)" && [ -n "$src" ] && ln -s "$src" "$MOCKBIN/$t"
  done

  # Isolated HOME so no test reads real user config.
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME/.claude"

  # Empty persistent data dir: no managed prettier copy present by default.
  export CLAUDE_PLUGIN_DATA="$BATS_TEST_TMPDIR/plugin-data"
  mkdir -p "$CLAUDE_PLUGIN_DATA"
}

# Prefer ripgrep; fall back to grep if rg isn't installed. rg's -E means
# --encoding=ARG and -r means --replace=ARG (both take a value, neither is
# grep's meaning), and rg has no recursive flag (recursion is its
# default) — so a bundled/bare -E is stripped before delegating to rg
# (its regex syntax is already ERE-equivalent for every pattern used in
# this file); grep gets its original arguments completely untouched.
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
  { printf '#!/usr/bin/env bash\n'; printf '%s\n' "$@"; } > "$MOCKBIN/$name"
  chmod +x "$MOCKBIN/$name"
}

# A recording+rewriting stub: appends "<name> <argv>" to $RECORD and overwrites the
# target file (always the last arg) so the server's content-diff sees a change.
rec_stub() {
  make_stub "$1" \
    'printf "%s %s\n" "'"$1"'" "$*" >> "$RECORD"' \
    'for last; do :; done' \
    'printf "reformatted-by-'"$1"'\n" > "$last"'
}

# Drive one JSON-RPC request against a fresh server on the isolated PATH; echo the
# id:2 result text (JSON.stringify of the handler result), or the literal NO_RESULT
# when the server produced no id:2 response at all. A handler that legitimately returns
# nothing still emits the string "{}", so the two cases stay distinguishable — echoing
# "{}" for both would let a crashed or silent server pass every `assert_output "{}"`.
# stdin is held OPEN through a FIFO and the output polled for an `"id":2` line (bounded,
# ~4 s) before stdin is closed and the server reaped, so a handler with a real async step
# (the in-process prettier path) cannot have its response raced away by the server's
# exit-on-stdin-close. mkfifo/grep/sleep/jq run in the bats shell with the real PATH, so
# MOCKBIN's symlink farm needs no new entry.
# $1 = tool name, $2 = arguments JSON object (compact).
_mcp_call() {
  local tool="$1" args_json="$2" out i
  local fifo="$BATS_TEST_TMPDIR/mcpin.$$.$RANDOM"
  local outfile="$BATS_TEST_TMPDIR/mcpout.$$.$RANDOM"
  mkfifo "$fifo"
  env PATH="$MOCKBIN" HOME="$HOME" RECORD="${RECORD:-/dev/null}" CLAUDE_PLUGIN_DATA="$CLAUDE_PLUGIN_DATA" \
    node "$SERVER" <"$fifo" >"$outfile" 2>/dev/null &
  local server_pid=$!
  exec {w}>"$fifo"
  printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n' >&"$w"
  printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"%s","arguments":%s}}\n' "$tool" "$args_json" >&"$w"
  for ((i=0; i<40; i++)); do
    grep -q '"id":2' "$outfile" 2>/dev/null && break
    sleep 0.1
  done
  exec {w}>&-
  wait "$server_pid" 2>/dev/null || true
  rm -f "$fifo"
  out="$(jq -rc 'select(.id == 2) | .result.content[0].text' "$outfile" 2>/dev/null)"
  if [ -n "$out" ]; then printf '%s' "$out"; else printf 'NO_RESULT'; fi
}

# format_file_call <file_path> <cwd> — drive format_post (PostToolUse). Signature
# unchanged from the pre-MCP helper, so existing per-language call sites keep their
# assertions; a no-op handler still yields "{}", a dead server now yields NO_RESULT.
format_file_call() {
  local fp="$1" cwd="$2" args
  args="$(jq -cn --arg f "$fp" --arg c "$cwd" '{hook_event_name:"PostToolUse", tool_name:"Write", tool_input:{file_path:$f}, tool_response:{success:true}, cwd:$c}')"
  _mcp_call format_post "$args"
}

# pre_tool_use_write_call <file_path> <content> <cwd> — drive format_pre for a Write.
pre_tool_use_write_call() {
  local fp="$1" content="$2" cwd="$3" args
  args="$(jq -cn --arg f "$fp" --arg t "$content" --arg c "$cwd" '{hook_event_name:"PreToolUse", tool_name:"Write", tool_input:{file_path:$f, content:$t}, cwd:$c}')"
  _mcp_call format_pre "$args"
}

# pre_tool_use_edit_call <file_path> <old_string> <new_string> <cwd> — drive format_pre for an Edit.
pre_tool_use_edit_call() {
  local fp="$1" old="$2" new="$3" cwd="$4" args
  args="$(jq -cn --arg f "$fp" --arg o "$old" --arg n "$new" --arg c "$cwd" '{hook_event_name:"PreToolUse", tool_name:"Edit", tool_input:{file_path:$f, old_string:$o, new_string:$n}, cwd:$c}')"
  _mcp_call format_pre "$args"
}
