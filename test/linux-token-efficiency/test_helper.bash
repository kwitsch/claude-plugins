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
  CBM_PIN="$PLUGIN/cbm-bundle.json"
  CBM_TOOLS="$PLUGIN/cbm-tools.json"
  CBM_SERVER="$PLUGIN/mcp/server.mjs"
  CBM_HELPERS="$PLUGIN/mcp/cbm-context.mjs"
  CBM_BINARY_FETCH="$PLUGIN/mcp/binary-fetch.mjs"
  MCP_JSON="$PLUGIN/.mcp.json"

  # Isolated PATH: only system tools that actually exist on the host are symlinked
  # in; per-test stubs are added on top via make_stub.
  MOCKBIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$MOCKBIN"
  for t in bash env node jq git grep sed awk cat cut head find ls cp mv rm mkdir chmod tar sha256sum uname timeout sleep mktemp printf id dirname gzip stat wc mkfifo kill; do
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

# write_fake_cbm <path> -- a tiny executable stand-in for the real 279.6 MiB cbm binary
# that speaks the minimal MCP stdio subset the proxy needs: it answers `initialize`,
# swallows `notifications/initialized`, and serves NOTHING before that handshake completes
# (the real binary behaves the same way, and an argv-dispatch echo stub would hang the
# proxy's handshake). tools/call returns the canned payload for that tool name from the
# JSON file in $CBM_FAKE_PAYLOADS, wrapped in cbm's real
# {content:[{type:"text",text:"<json>"}],isError:false,structuredContent} envelope, and
# appends {"name":…,"arguments":…} to $CBM_FAKE_LOG. An unknown name echoes itself back,
# so a passthrough test can prove the call reached the child.
write_fake_cbm() {
  local target="$1"
  mkdir -p "$(dirname "$target")"
  rm -f "$target"
  cat > "$target" << 'FAKE_CBM'
#!/usr/bin/env node
import fs from "node:fs";
import readline from "node:readline";

const logFile = process.env.CBM_FAKE_LOG || "";
let payloads = {};
try {
  payloads = JSON.parse(fs.readFileSync(process.env.CBM_FAKE_PAYLOADS || "", "utf8"));
} catch {
  payloads = {};
}
let initialized = false;
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "codebase-memory-mcp", version: "0.10.1-fake" } },
    });
    return;
  }
  if (msg.method === "notifications/initialized") {
    initialized = true;
    return;
  }
  if (!initialized) return;
  if (msg.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: { tools: Object.keys(payloads).map((name) => ({ name, description: `fake ${name}`, inputSchema: { type: "object", additionalProperties: true } })) },
    });
    return;
  }
  if (msg.method === "tools/call") {
    const name = msg.params && msg.params.name;
    const args = (msg.params && msg.params.arguments) || {};
    if (logFile) fs.appendFileSync(logFile, JSON.stringify({ name, arguments: args }) + "\n");
    const payload = Object.prototype.hasOwnProperty.call(payloads, name) ? payloads[name] : { echo: name, arguments: args };
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: { content: [{ type: "text", text: JSON.stringify(payload) }], isError: false, structuredContent: payload },
    });
    return;
  }
  if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "fake: method not found" } });
});
rl.on("close", () => process.exit(0));
FAKE_CBM
  chmod +x "$target"
}

# make_cbm_server_fixture <dir> -- build a fixture plugin tree holding copies of the real
# mcp/server.mjs + mcp/cbm-context.mjs + mcp/binary-fetch.mjs plus a FABRICATED
# cbm-bundle.json / cbm-tools.json
# whose binarySha256 is the fake binary's REAL sha256, so the production
# content-addressed path ${CBM_BUNDLE_CACHE}/<binarySha256[0:16]>/codebase-memory-mcp
# resolves to it. Getting that derivation wrong silently falls through to the download
# path, so warm-path cases must additionally assert the request log is empty.
# Also stages a few-byte release tree ($RELEASE_DIR/<tag>/<asset>) for the cold path.
make_cbm_server_fixture() {
  local dir="$1"
  FIXTURE_TAG="v9.9.9-fixture"
  FIXTURE_ASSET="codebase-memory-mcp-linux-amd64-portable.tar.gz"
  FIXTURE_SERVER="$dir/mcp/server.mjs"
  CBM_CACHE="$BATS_TEST_TMPDIR/cache"
  FAKE_LOG="$BATS_TEST_TMPDIR/fake-calls.log"
  FAKE_PAYLOADS="$BATS_TEST_TMPDIR/fake-payloads.json"
  FAKE_BIN="$BATS_TEST_TMPDIR/pack/codebase-memory-mcp"
  RELEASE_DIR="$BATS_TEST_TMPDIR/release"

  mkdir -p "$dir/mcp" "$RELEASE_DIR/$FIXTURE_TAG" "$CBM_CACHE"
  cp "$CBM_SERVER" "$dir/mcp/server.mjs"
  cp "$CBM_HELPERS" "$dir/mcp/cbm-context.mjs"
  cp "$CBM_BINARY_FETCH" "$dir/mcp/binary-fetch.mjs"
  chmod +x "$dir/mcp/server.mjs"

  write_fake_cbm "$FAKE_BIN"
  printf 'fixture installer\n' > "$BATS_TEST_TMPDIR/pack/install.sh"
  tar -czf "$RELEASE_DIR/$FIXTURE_TAG/$FIXTURE_ASSET" -C "$BATS_TEST_TMPDIR/pack" codebase-memory-mcp install.sh
  FAKE_BIN_SHA="$(sha256sum < "$FAKE_BIN" | cut -d' ' -f1)"
  local asset_sha
  asset_sha="$(sha256sum < "$RELEASE_DIR/$FIXTURE_TAG/$FIXTURE_ASSET" | cut -d' ' -f1)"

  jq -n --arg tag "$FIXTURE_TAG" --arg asset "$FIXTURE_ASSET" --arg a "$asset_sha" --arg b "$FAKE_BIN_SHA" \
    '{cbmVersion:($tag|ltrimstr("v")), upstreamRepo:"DeusData/codebase-memory-mcp", releaseTag:$tag,
      binaries:[{asset:$asset, assetSha256:$a, binarySha256:$b}]}' > "$dir/cbm-bundle.json"
  jq -n --arg tag "$FIXTURE_TAG" \
    '{cbmVersion:($tag|ltrimstr("v")),
      tools:[{name:"list_projects", description:"fixture list_projects", inputSchema:{type:"object", additionalProperties:true}},
             {name:"search_graph",  description:"fixture search_graph",  inputSchema:{type:"object", additionalProperties:true}}]}' \
    > "$dir/cbm-tools.json"

  : > "$FAKE_LOG"
  set_fake_payloads '{}'
  CBM_DOWNLOAD_BASE_URL="http://127.0.0.1:1/releases/download" # unreachable unless a test starts one
  CBM_RPC_ENV=()
  return 0
}

# warm_cbm_cache -- put the fake binary where the production content-addressed lookup
# expects it, so the server never needs the network.
warm_cbm_cache() {
  local dir="$CBM_CACHE/${FAKE_BIN_SHA:0:16}"
  mkdir -p "$dir"
  cp "$FAKE_BIN" "$dir/codebase-memory-mcp"
  chmod +x "$dir/codebase-memory-mcp"
}

# set_fake_payloads <json-object> -- tool-name -> canned payload map for the fake binary.
set_fake_payloads() {
  printf '%s\n' "$1" > "$FAKE_PAYLOADS"
}

# cbm_rpc <wait-id> <request-line>... -- drive one fresh fixture server over stdio. stdin
# is held OPEN through a FIFO and the output polled for the `"id":<wait-id>` line (bounded,
# ~8 s) BEFORE stdin is closed, because every cbm-backed response awaits an async child
# handshake and closing stdin early would race the reply away. Termination is bounded too
# (SIGTERM, then SIGKILL) so a stray timer can never hang the suite. stderr is captured,
# not discarded: the guard cases assert on stderr notes. Sets CBM_RPC_STDOUT/CBM_RPC_STDERR.
cbm_rpc() {
  local wait_id="$1"
  shift
  local fifo="$BATS_TEST_TMPDIR/rpcin.$$.$RANDOM"
  local outfile="$BATS_TEST_TMPDIR/rpcout.$$.$RANDOM"
  local errfile="$BATS_TEST_TMPDIR/rpcerr.$$.$RANDOM"
  local line i
  mkfifo "$fifo"
  env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$BATS_TEST_TMPDIR" \
    CBM_BUNDLE_CACHE="$CBM_CACHE" CBM_DOWNLOAD_BASE_URL="$CBM_DOWNLOAD_BASE_URL" \
    CBM_FAKE_LOG="$FAKE_LOG" CBM_FAKE_PAYLOADS="$FAKE_PAYLOADS" \
    "${CBM_RPC_ENV[@]}" node "$FIXTURE_SERVER" < "$fifo" > "$outfile" 2> "$errfile" &
  local server_pid=$!
  exec {w}> "$fifo"
  for line in "$@"; do
    printf '%s\n' "$line" >&"$w"
  done
  for ((i = 0; i < 80; i++)); do
    grep -q "\"id\":$wait_id" "$outfile" 2> /dev/null && break
    sleep 0.1
  done
  exec {w}>&-
  for ((i = 0; i < 30; i++)); do
    kill -0 "$server_pid" 2> /dev/null || break
    sleep 0.1
  done
  if kill -0 "$server_pid" 2> /dev/null; then
    kill "$server_pid" 2> /dev/null
    for ((i = 0; i < 10; i++)); do
      kill -0 "$server_pid" 2> /dev/null || break
      sleep 0.1
    done
    kill -0 "$server_pid" 2> /dev/null && kill -9 "$server_pid" 2> /dev/null
  fi
  wait "$server_pid" 2> /dev/null || true
  rm -f "$fifo"
  CBM_RPC_STDOUT="$(cat "$outfile")"
  CBM_RPC_STDERR="$(cat "$errfile")"
  return 0
}

# cbm_call <tool> <args-json> -- initialize + one tools/call (id 2) through cbm_rpc.
cbm_call() {
  cbm_rpc 2 \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
    "$(printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"%s","arguments":%s}}' "$1" "$2")"
}

# cbm_rpc_result <id> -- the .result of the captured response with that id (compact JSON).
cbm_rpc_result() {
  printf '%s\n' "$CBM_RPC_STDOUT" | jq -c "select(.id == $1) | .result"
}

# start_release_server -- ephemeral 127.0.0.1 HTTP server over $RELEASE_DIR. It honours the
# production path prefix (/releases/download/<tag>/<asset>) and is addressed by exporting
# CBM_DOWNLOAD_BASE_URL=http://127.0.0.1:<port>/releases/download, so the production join
# ${CBM_DOWNLOAD_BASE_URL}/${releaseTag}/${asset} is exercised verbatim with no test-only
# URL shape. Every request path is appended to $RELEASE_LOG.
start_release_server() {
  local script="$BATS_TEST_TMPDIR/release-server.mjs" portfile="$BATS_TEST_TMPDIR/release-port" i
  RELEASE_LOG="$BATS_TEST_TMPDIR/release-requests.log"
  : > "$RELEASE_LOG"
  rm -f "$portfile"
  cat > "$script" << 'RELEASE_SERVER'
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const root = fs.realpathSync(process.env.RELEASE_ROOT);
const server = http.createServer((req, res) => {
  fs.appendFileSync(process.env.RELEASE_LOG, `${req.url}\n`);
  const rel = decodeURIComponent(String(req.url).replace(/^\/releases\/download\//, "").replace(/^\/+/, ""));
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  res.statusCode = 200;
  fs.createReadStream(file).pipe(res);
});
server.listen(0, "127.0.0.1", () => fs.writeFileSync(process.env.RELEASE_PORT_FILE, String(server.address().port)));
RELEASE_SERVER
  RELEASE_ROOT="$RELEASE_DIR" RELEASE_LOG="$RELEASE_LOG" RELEASE_PORT_FILE="$portfile" node "$script" &
  RELEASE_PID=$!
  for ((i = 0; i < 50; i++)); do
    [ -s "$portfile" ] && break
    sleep 0.1
  done
  [ -s "$portfile" ] || return 1
  CBM_DOWNLOAD_BASE_URL="http://127.0.0.1:$(cat "$portfile")/releases/download"
  return 0
}

# stop_release_server -- always safe to call from teardown, even if none was started.
stop_release_server() {
  [ -n "${RELEASE_PID:-}" ] && kill "$RELEASE_PID" 2> /dev/null
  RELEASE_PID=""
  return 0
}
