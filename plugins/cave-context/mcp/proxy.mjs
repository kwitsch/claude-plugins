// proxy.mjs — stdio client to the upstream context-mode MCP server.
// Backs ctx_* tool calls proxied by server.mjs; never writes stdout (would corrupt JSON-RPC); diagnostics → stderr.
// Fail-open: if the upstream is down or the handshake times out, the server marks the child dead and re-spawns on the next call.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { contextModeEnv } from "./context-mode-env.mjs";

const PROTOCOL = "2025-11-25";
// Handshake (initialize / tools/list). Generous enough to absorb a cold `npx -y context-mode`
// fetch on first run, but bounded so a truly-unavailable upstream eventually fails (open) and
// the server re-spawns on the next call instead of hanging the session.
const HANDSHAKE_TIMEOUT = Number(process.env.CAVE_CONTEXT_HANDSHAKE_TIMEOUT_MS) || 60000;
// tools/call wraps slow-but-normal ctx_* ops (ctx_index, ctx_fetch_and_index,
// ctx_batch_execute) that routinely run >15s; default to Claude Code's 600s hook bound.
const TOOL_TIMEOUT = Number(process.env.CAVE_CONTEXT_TOOL_TIMEOUT_MS) || 600000;

// Resolve the upstream context-mode spawn command: honour CAVE_CONTEXT_UPSTREAM_CMD override, else default to bin/bnx.sh context-mode.
function upstreamCmd() {
  if (process.env.CAVE_CONTEXT_UPSTREAM_CMD) {
    try { const a = JSON.parse(process.env.CAVE_CONTEXT_UPSTREAM_CMD); if (Array.isArray(a) && a.length) return a; } catch { /* fall through */ }
  }
  // Default: launch context-mode through the bin/bnx.sh launcher (bun add -g / npx -y by
  // bun presence). bnx.sh dispatches the package name "context-mode" as an npm package.
  const bnx = fileURLToPath(new URL("../bin/bnx.sh", import.meta.url));
  return [bnx, "context-mode"];
}

export class Upstream {
  constructor() { this.child = null; this.rl = null; this.pending = new Map(); this.nextId = 1; this.tools = []; this.alive = false; }

  // Mark the child dead and reject everything still pending. Called from exit/error so a
  // crash mid-session does not leave callers writing to dead stdin and waiting out the timer.
  _die(reason) {
    this.alive = false;
    this.child = null;
    for (const p of this.pending.values()) p.reject(new Error(reason));
    this.pending.clear();
  }

  start() {
    const [bin, ...args] = upstreamCmd();
    // One-time diagnostic (server spawns once per session, so no per-event spam): without
    // CLAUDE_PLUGIN_DATA the helper leaves CONTEXT_MODE_DIR unset and context-mode uses its default.
    if (!String(process.env.CLAUDE_PLUGIN_DATA ?? "").trim()) process.stderr.write("[cave-context] CLAUDE_PLUGIN_DATA unset — context-mode uses its default storage dir\n");
    this.child = spawn(bin, args, { stdio: ["pipe", "pipe", "inherit"], env: contextModeEnv() });
    this.alive = true;
    this.child.on("exit", () => this._die("upstream exited"));
    this.child.on("error", () => this._die("upstream spawn error"));
    this.rl = readline.createInterface({ input: this.child.stdout });
    this.rl.on("line", (l) => this._onLine(l));
    return (async () => {
      try {
        await this._request("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "cave-context", version: "0.1.0" } }, HANDSHAKE_TIMEOUT);
        this._notify("notifications/initialized", {});
        const res = await this._request("tools/list", {}, HANDSHAKE_TIMEOUT);
        this.tools = res?.tools ?? [];
        return this.tools;
      } catch (e) {
        // Handshake failed/timed out (slow cold `npx` fetch, or upstream down): kill the child
        // and mark dead so the server's ensureUp re-spawns on the next call instead of caching
        // an empty tool list for the rest of the session.
        this.stop();
        throw e;
      }
    })();
  }

  _send(o) { try { this.child.stdin.write(JSON.stringify(o) + "\n"); } catch { /* ignore */ } }
  _notify(method, params) { this._send({ jsonrpc: "2.0", method, params }); }
  _request(method, params, timeoutMs = HANDSHAKE_TIMEOUT) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`upstream request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this._send({ jsonrpc: "2.0", id, method, params });
    });
  }
  _onLine(line) {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    if (msg.id != null && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message || "upstream error")) : resolve(msg.result);
    }
  }
  callTool(name, args) {
    // Fail fast on a dead child instead of writing to dead stdin and waiting out the timer.
    if (!this.alive || !this.child) return Promise.reject(new Error("upstream not running"));
    return this._request("tools/call", { name, arguments: args ?? {} }, TOOL_TIMEOUT);
  }
  stop() { this.alive = false; try { this.rl?.close(); } catch { /* ignore */ } try { this.child?.kill(); } catch { /* ignore */ } }
}
