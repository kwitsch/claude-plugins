#!/usr/bin/env bats

# Hermetic coverage of the managed-prettier install/update state machine.
# A stub `npm` on an isolated PATH materialises node_modules/prettier from the repo's real
# prettier (importable) while reporting the server's own pinned version, so the tree passes
# the server's sanity check regardless of which prettier the repo happens to depend on.
# No network. The async publish runs in the install child's exit handler, so
# install-observing tests hold the server's stdin OPEN while polling the filesystem,
# then close it -- a test-harness concern only (a real session's server is long-lived).

load 'test_helper'

setup() {
  common_setup
  REPO_PRETTIER_DIR="$REPO_ROOT/node_modules/prettier"
  [ -d "$REPO_PRETTIER_DIR" ] || skip "repo prettier not installed (run npm ci)"
  command -v node >/dev/null 2>&1 || skip "node not installed"
  # The pin is the SERVER's own MANAGED_PRETTIER_VERSION, never the repo devDependency's
  # version: the two are independent (the repo pins what CI lints with, the server pins what
  # the managed copy installs), and reading the repo's version here made every install test
  # fail the server's sanity check whenever they drifted apart.
  PIN="$(sed -n 's/^const MANAGED_PRETTIER_VERSION = "\(.*\)";$/\1/p' "$SERVER")"
  [ -n "$PIN" ] || skip "could not read MANAGED_PRETTIER_VERSION from $SERVER"
  NPM_CALLS="$BATS_TEST_TMPDIR/npm-calls"
  : > "$NPM_CALLS"
  UF_BACKOFF="" # empty -> server falls back to its own default
}

# --- stub npm variants -------------------------------------------------------

# Success: parse --prefix <dir>, materialise <dir>/node_modules/prettier as a real,
# importable prettier — every entry symlinked to the repo copy EXCEPT package.json, which is
# rewritten to report the server's pinned version. Symlinking the repo copy wholesale would
# report the repo devDependency's version instead and the server's sanity check would (rightly)
# reject the tree, making these tests pass only while the two versions happened to agree.
make_npm_success_stub() {
  cat > "$MOCKBIN/npm" <<'EOF'
#!/usr/bin/env bash
prefix=""
args=("$@")
for ((i=0; i<${#args[@]}; i++)); do
  [ "${args[$i]}" = "--prefix" ] && prefix="${args[$((i+1))]}"
done
[ -n "$prefix" ] || exit 1
dest="$prefix/node_modules/prettier"
mkdir -p "$dest"
for entry in "$REPO_PRETTIER_DIR"/*; do
  base="$(basename "$entry")"
  [ "$base" = "package.json" ] && continue
  ln -s "$entry" "$dest/$base"
done
node -e '
  const fs = require("fs");
  const pkg = JSON.parse(fs.readFileSync(process.argv[1] + "/package.json", "utf8"));
  pkg.version = process.argv[3];
  fs.writeFileSync(process.argv[2] + "/package.json", JSON.stringify(pkg, null, 2) + "\n");
' "$REPO_PRETTIER_DIR" "$dest" "$STUB_PIN" || exit 1
exit 0
EOF
  chmod +x "$MOCKBIN/npm"
}

# Failure: nonzero exit, nothing written.
make_npm_fail_stub() {
  make_stub npm 'exit 1'
}

# Failure that records every invocation into $NPM_CALLS, so retry attempts are countable.
make_npm_fail_recording_stub() {
  make_stub npm 'printf "call\n" >> "$NPM_CALLS"' 'exit 1'
}

# Count recorded npm invocations (0 when the stub never ran).
npm_call_count() {
  [ -s "$NPM_CALLS" ] && wc -l < "$NPM_CALLS" | tr -d ' ' || printf '0'
}

# Wrong version: exit 0 but the installed tree reports a different version.
make_npm_wrongversion_stub() {
  cat > "$MOCKBIN/npm" <<'EOF'
#!/usr/bin/env bash
prefix=""
args=("$@")
for ((i=0; i<${#args[@]}; i++)); do
  [ "${args[$i]}" = "--prefix" ] && prefix="${args[$((i+1))]}"
done
[ -n "$prefix" ] || exit 1
mkdir -p "$prefix/node_modules/prettier"
printf '{"name":"prettier","version":"0.0.0","main":"index.js"}\n' > "$prefix/node_modules/prettier/package.json"
printf 'module.exports={};\n' > "$prefix/node_modules/prettier/index.js"
exit 0
EOF
  chmod +x "$MOCKBIN/npm"
}

# Build a managed copy on disk directly (no npm) at the given version string.
make_managed_copy() {
  local ver="$1"
  local vdir="$CLAUDE_PLUGIN_DATA/prettier/versions/$ver-fixture"
  mkdir -p "$vdir/node_modules/prettier"
  printf '{"name":"prettier","version":"%s","main":"index.js"}\n' "$ver" > "$vdir/node_modules/prettier/package.json"
  printf 'module.exports={};\n' > "$vdir/node_modules/prettier/index.js"
  ln -s "$vdir" "$CLAUDE_PLUGIN_DATA/prettier/current"
}

# A managed copy pointing at the real repo prettier (importable, correct version).
make_managed_copy_real() {
  local vdir="$CLAUDE_PLUGIN_DATA/prettier/versions/real-fixture"
  mkdir -p "$vdir/node_modules"
  ln -s "$REPO_PRETTIER_DIR" "$vdir/node_modules/prettier"
  ln -s "$vdir" "$CLAUDE_PLUGIN_DATA/prettier/current"
}

# Drive one tools/call while holding stdin OPEN, polling until $target exists or the
# window (~4s) elapses; then close stdin so the server exits. $1=tool, $2=args JSON,
# $3=target path to poll for.
drive_and_wait() {
  local tool="$1" args_json="$2" target="$3"
  local fifo="$BATS_TEST_TMPDIR/in.$RANDOM"
  mkfifo "$fifo"
  env PATH="$MOCKBIN" HOME="$HOME" REPO_PRETTIER_DIR="$REPO_PRETTIER_DIR" STUB_PIN="$PIN" NPM_CALLS="$NPM_CALLS" UF_INSTALL_RETRY_BACKOFF_MS="$UF_BACKOFF" CLAUDE_PLUGIN_DATA="$CLAUDE_PLUGIN_DATA" node "$SERVER" <"$fifo" >/dev/null 2>&1 &
  local server_pid=$!
  exec {w}>"$fifo"
  printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n' >&"$w"
  printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"%s","arguments":%s}}\n' "$tool" "$args_json" >&"$w"
  local i
  for ((i=0; i<40; i++)); do
    [ -e "$target" ] && break
    sleep 0.1
  done
  exec {w}>&-
  wait "$server_pid" 2>/dev/null || true
}

# Drive one tools/call holding stdin OPEN until the id:2 response is emitted (or ~4s
# elapses), then close stdin so the server exits. Echoes the id:2 result text (or "{}").
# Needed for the in-process (tier-1/tier-3) prettier path: the server exits on stdin
# close via process.exit(0) without waiting on the pending async import, so the plain
# immediate-close _mcp_call would race the response away.
drive_and_capture() {
  local tool="$1" args_json="$2" out
  local fifo="$BATS_TEST_TMPDIR/cap.$RANDOM"
  local outfile="$BATS_TEST_TMPDIR/capout.$RANDOM"
  mkfifo "$fifo"
  env PATH="$MOCKBIN" HOME="$HOME" REPO_PRETTIER_DIR="$REPO_PRETTIER_DIR" STUB_PIN="$PIN" NPM_CALLS="$NPM_CALLS" UF_INSTALL_RETRY_BACKOFF_MS="$UF_BACKOFF" CLAUDE_PLUGIN_DATA="$CLAUDE_PLUGIN_DATA" node "$SERVER" <"$fifo" >"$outfile" 2>/dev/null &
  local server_pid=$!
  exec {w}>"$fifo"
  printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n' >&"$w"
  printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"%s","arguments":%s}}\n' "$tool" "$args_json" >&"$w"
  local i
  for ((i=0; i<40; i++)); do
    grep -q '"id":2' "$outfile" 2>/dev/null && break
    sleep 0.1
  done
  exec {w}>&-
  wait "$server_pid" 2>/dev/null || true
  out="$(jq -rc 'select(.id == 2) | .result.content[0].text' "$outfile" 2>/dev/null)"
  if [ -n "$out" ]; then printf '%s' "$out"; else printf '{}'; fi
}

# Start the server (success stub allowed) holding stdin open for ~$1 tenths of a second
# WITHOUT a tools/call, to observe startup-time behavior (the daily check). Closes stdin after.
start_and_hold() {
  local tenths="${1:-15}"
  local fifo="$BATS_TEST_TMPDIR/hold.$RANDOM"
  mkfifo "$fifo"
  env PATH="$MOCKBIN" HOME="$HOME" REPO_PRETTIER_DIR="$REPO_PRETTIER_DIR" STUB_PIN="$PIN" NPM_CALLS="$NPM_CALLS" UF_INSTALL_RETRY_BACKOFF_MS="$UF_BACKOFF" CLAUDE_PLUGIN_DATA="$CLAUDE_PLUGIN_DATA" node "$SERVER" <"$fifo" >/dev/null 2>&1 &
  local server_pid=$!
  exec {w}>"$fifo"
  printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n' >&"$w"
  local i
  for ((i=0; i<tenths; i++)); do sleep 0.1; done
  exec {w}>&-
  wait "$server_pid" 2>/dev/null || true
}

# Drive TWO tier-none misses through ONE long-lived server, waiting for the first install
# attempt to be recorded before sending the second, then polling for a second attempt.
# Echoes the number of recorded npm invocations. $1=args JSON (reused for both calls).
drive_two_misses() {
  local args_json="$1" i
  local fifo="$BATS_TEST_TMPDIR/two.$RANDOM"
  mkfifo "$fifo"
  env PATH="$MOCKBIN" HOME="$HOME" REPO_PRETTIER_DIR="$REPO_PRETTIER_DIR" STUB_PIN="$PIN" NPM_CALLS="$NPM_CALLS" UF_INSTALL_RETRY_BACKOFF_MS="$UF_BACKOFF" CLAUDE_PLUGIN_DATA="$CLAUDE_PLUGIN_DATA" node "$SERVER" <"$fifo" >/dev/null 2>&1 &
  local server_pid=$!
  exec {w}>"$fifo"
  printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n' >&"$w"
  printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"format_pre","arguments":%s}}\n' "$args_json" >&"$w"
  for ((i=0; i<40; i++)); do
    [ "$(npm_call_count)" -ge 1 ] && break
    sleep 0.1
  done
  printf '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"format_pre","arguments":%s}}\n' "$args_json" >&"$w"
  for ((i=0; i<40; i++)); do
    [ "$(npm_call_count)" -ge 2 ] && break
    sleep 0.1
  done
  exec {w}>&-
  wait "$server_pid" 2>/dev/null || true
  npm_call_count
}

# --- install tests -----------------------------------------------------------

@test "first miss: hook fails open immediately AND the install lands out of band" {
  make_npm_success_stub
  local cwd="$BATS_TEST_TMPDIR/proj"; mkdir -p "$cwd"
  local target="$CLAUDE_PLUGIN_DATA/prettier/current/node_modules/prettier/package.json"
  local args
  args="$(jq -cn --arg f "$cwd/a.json" --arg c "$cwd" '{hook_event_name:"PreToolUse", tool_name:"Write", tool_input:{file_path:$f, content:"{\"a\":1}"}, cwd:$c}')"
  drive_and_wait format_pre "$args" "$target"
  [ -e "$target" ]
  run node -e 'process.stdout.write(require(process.argv[1]).version)' "$target"
  assert_output "$PIN"
}

@test "successful install is usable in-process on a later call" {
  make_managed_copy_real
  local cwd="$BATS_TEST_TMPDIR/proj2"; mkdir -p "$cwd"
  local args
  args="$(jq -cn --arg f "$cwd/a.json" --arg c "$cwd" '{hook_event_name:"PreToolUse", tool_name:"Write", tool_input:{file_path:$f, content:"{\"a\":1}"}, cwd:$c}')"
  run drive_and_capture format_pre "$args"
  assert_success
  echo "$output" | jq -e '.hookSpecificOutput.updatedInput.content == "{ \"a\": 1 }\n"'
  echo "$output" | jq -e '.hookSpecificOutput | has("permissionDecision") | not'
}

@test "failed install (nonzero exit) stays a silent no-op; no current published" {
  make_npm_fail_stub
  local cwd="$BATS_TEST_TMPDIR/proj3"; mkdir -p "$cwd"
  local args
  args="$(jq -cn --arg f "$cwd/a.json" --arg c "$cwd" '{hook_event_name:"PreToolUse", tool_name:"Write", tool_input:{file_path:$f, content:"{\"a\":1}"}, cwd:$c}')"
  # First return is immediate {}; then let the (failing) install run its course.
  drive_and_wait format_pre "$args" "$CLAUDE_PLUGIN_DATA/prettier/current"
  [ ! -e "$CLAUDE_PLUGIN_DATA/prettier/current" ]
}

@test "failed install is retried on a later miss once the backoff has elapsed" {
  make_npm_fail_recording_stub
  UF_BACKOFF=0
  local cwd="$BATS_TEST_TMPDIR/proj-retry"; mkdir -p "$cwd"
  local args
  args="$(jq -cn --arg f "$cwd/a.json" --arg c "$cwd" '{hook_event_name:"PreToolUse", tool_name:"Write", tool_input:{file_path:$f, content:"{\"a\":1}"}, cwd:$c}')"
  run drive_two_misses "$args"
  assert_output "2"
  [ ! -e "$CLAUDE_PLUGIN_DATA/prettier/current" ]
}

@test "failed install is NOT retried while the backoff is still running" {
  make_npm_fail_recording_stub
  UF_BACKOFF=600000
  local cwd="$BATS_TEST_TMPDIR/proj-noretry"; mkdir -p "$cwd"
  local args
  args="$(jq -cn --arg f "$cwd/a.json" --arg c "$cwd" '{hook_event_name:"PreToolUse", tool_name:"Write", tool_input:{file_path:$f, content:"{\"a\":1}"}, cwd:$c}')"
  run drive_two_misses "$args"
  assert_output "1"
}

@test "wrong-version install is rejected by the sanity check; no current published" {
  make_npm_wrongversion_stub
  local cwd="$BATS_TEST_TMPDIR/proj4"; mkdir -p "$cwd"
  local args
  args="$(jq -cn --arg f "$cwd/a.json" --arg c "$cwd" '{hook_event_name:"PreToolUse", tool_name:"Write", tool_input:{file_path:$f, content:"{\"a\":1}"}, cwd:$c}')"
  drive_and_wait format_pre "$args" "$CLAUDE_PLUGIN_DATA/prettier/current"
  [ ! -e "$CLAUDE_PLUGIN_DATA/prettier/current" ]
}

@test "publish is atomic: whenever current exists it points at a complete pinned tree" {
  make_npm_success_stub
  local cwd="$BATS_TEST_TMPDIR/proj5"; mkdir -p "$cwd"
  local target="$CLAUDE_PLUGIN_DATA/prettier/current/node_modules/prettier/package.json"
  local args
  args="$(jq -cn --arg f "$cwd/a.json" --arg c "$cwd" '{hook_event_name:"PreToolUse", tool_name:"Write", tool_input:{file_path:$f, content:"{\"a\":1}"}, cwd:$c}')"
  drive_and_wait format_pre "$args" "$target"
  [ -L "$CLAUDE_PLUGIN_DATA/prettier/current" ]
  [ -e "$target" ]
  run node -e 'process.stdout.write(require(process.argv[1]).version)' "$target"
  assert_output "$PIN"
}

@test "first miss via format_post also triggers the install and still returns" {
  make_npm_success_stub
  local cwd="$BATS_TEST_TMPDIR/proj6"; mkdir -p "$cwd"
  printf '{"a":1}\n' > "$cwd/a.json"
  local target="$CLAUDE_PLUGIN_DATA/prettier/current/node_modules/prettier/package.json"
  local args
  args="$(jq -cn --arg f "$cwd/a.json" --arg c "$cwd" '{hook_event_name:"PostToolUse", tool_name:"Write", tool_input:{file_path:$f}, tool_response:{success:true}, cwd:$c}')"
  drive_and_wait format_post "$args" "$target"
  [ -e "$target" ]
}

# --- daily-check tests -------------------------------------------------------

# Write the .last-check marker (epoch ms). $1 = ms value.
set_last_check() {
  mkdir -p "$CLAUDE_PLUGIN_DATA/prettier"
  printf '%s' "$1" > "$CLAUDE_PLUGIN_DATA/prettier/.last-check"
}

@test "daily check: skipped when .last-check is fresh (no reinstall)" {
  make_npm_success_stub
  make_managed_copy "0.0.0"
  set_last_check "$(node -e 'process.stdout.write(String(Date.now()))')"
  start_and_hold 15
  run node -e 'process.stdout.write(require(process.argv[1]).version)' "$CLAUDE_PLUGIN_DATA/prettier/current/node_modules/prettier/package.json"
  assert_output "0.0.0"
}

@test "daily check: runs when .last-check is stale (reconciles to the pin) and rewrites the marker" {
  make_npm_success_stub
  make_managed_copy "0.0.0"
  set_last_check "$(node -e 'process.stdout.write(String(Date.now() - 25*60*60*1000))')"
  local target="$CLAUDE_PLUGIN_DATA/prettier/current/node_modules/prettier/package.json"
  # Hold stdin open, polling until the reconcile publish flips current to the pin.
  local fifo="$BATS_TEST_TMPDIR/dc.$RANDOM"; mkfifo "$fifo"
  env PATH="$MOCKBIN" HOME="$HOME" REPO_PRETTIER_DIR="$REPO_PRETTIER_DIR" STUB_PIN="$PIN" NPM_CALLS="$NPM_CALLS" UF_INSTALL_RETRY_BACKOFF_MS="$UF_BACKOFF" CLAUDE_PLUGIN_DATA="$CLAUDE_PLUGIN_DATA" node "$SERVER" <"$fifo" >/dev/null 2>&1 &
  local pid=$!
  exec {w}>"$fifo"
  printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n' >&"$w"
  local i cur
  for ((i=0; i<40; i++)); do
    cur="$(node -e 'try{process.stdout.write(require(process.argv[1]).version)}catch(e){}' "$target" 2>/dev/null || true)"
    [ "$cur" = "$PIN" ] && break
    sleep 0.1
  done
  exec {w}>&-
  wait "$pid" 2>/dev/null || true
  run node -e 'process.stdout.write(require(process.argv[1]).version)' "$target"
  assert_output "$PIN"
  # marker rewritten to ~now (well under 24h old)
  run node -e 'const fs=require("fs");const t=Number(fs.readFileSync(process.argv[1],"utf8").trim());process.exit(Date.now()-t < 60*60*1000 ? 0 : 1)' "$CLAUDE_PLUGIN_DATA/prettier/.last-check"
  assert_success
}

@test "daily check: never eager-installs when no managed copy exists" {
  make_npm_success_stub
  set_last_check "$(node -e 'process.stdout.write(String(Date.now() - 25*60*60*1000))')"
  start_and_hold 15
  [ ! -e "$CLAUDE_PLUGIN_DATA/prettier/current" ]
}
