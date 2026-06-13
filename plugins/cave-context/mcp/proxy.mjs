// proxy.mjs — client to the upstream context-mode MCP server over stdio.
import { spawn } from "node:child_process";
import readline from "node:readline";

const PROTOCOL = "2025-11-25";
// Handshake (initialize / tools/list) must fail fast if the upstream is unavailable.
const HANDSHAKE_TIMEOUT = 15000;
// tools/call wraps slow-but-normal ctx_* ops (ctx_index, ctx_fetch_and_index,
// ctx_batch_execute) that routinely run >15s; default to Claude Code's 600s hook bound.
const TOOL_TIMEOUT = Number(process.env.CAVE_CONTEXT_TOOL_TIMEOUT_MS) || 600000;

function upstreamCmd() {
  if (process.env.CAVE_CONTEXT_UPSTREAM_CMD) {
    try { const a = JSON.parse(process.env.CAVE_CONTEXT_UPSTREAM_CMD); if (Array.isArray(a) && a.length) return a; } catch { /* fall through */ }
  }
  return ["npx", "-y", "context-mode"]; // bare-launch form confirmed in Task 0
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
    this.child = spawn(bin, args, { stdio: ["pipe", "pipe", "inherit"] });
    this.alive = true;
    this.child.on("exit", () => this._die("upstream exited"));
    this.child.on("error", () => this._die("upstream spawn error"));
    this.rl = readline.createInterface({ input: this.child.stdout });
    this.rl.on("line", (l) => this._onLine(l));
    return (async () => {
      await this._request("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "cave-context", version: "0.1.0" } }, HANDSHAKE_TIMEOUT);
      this._notify("notifications/initialized", {});
      const res = await this._request("tools/list", {}, HANDSHAKE_TIMEOUT);
      this.tools = res?.tools ?? [];
      return this.tools;
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
