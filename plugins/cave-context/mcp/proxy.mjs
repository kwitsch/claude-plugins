// proxy.mjs — client to the upstream context-mode MCP server over stdio.
import { spawn } from "node:child_process";
import readline from "node:readline";

const PROTOCOL = "2025-11-25";

function upstreamCmd() {
  if (process.env.CAVE_CONTEXT_UPSTREAM_CMD) {
    try { const a = JSON.parse(process.env.CAVE_CONTEXT_UPSTREAM_CMD); if (Array.isArray(a) && a.length) return a; } catch { /* fall through */ }
  }
  return ["npx", "-y", "context-mode"]; // bare-launch form confirmed in Task 0
}

export class Upstream {
  constructor() { this.child = null; this.pending = new Map(); this.nextId = 1; this.tools = []; }

  start() {
    const [bin, ...args] = upstreamCmd();
    this.child = spawn(bin, args, { stdio: ["pipe", "pipe", "inherit"] });
    this.child.on("exit", () => { for (const p of this.pending.values()) p.reject(new Error("upstream exited")); this.pending.clear(); });
    this.child.on("error", () => { for (const p of this.pending.values()) p.reject(new Error("upstream spawn error")); this.pending.clear(); });
    readline.createInterface({ input: this.child.stdout }).on("line", (l) => this._onLine(l));
    return (async () => {
      await this._request("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "cave-context", version: "0.1.0" } });
      this._notify("notifications/initialized", {});
      const res = await this._request("tools/list", {});
      this.tools = res?.tools ?? [];
      return this.tools;
    })();
  }

  _send(o) { try { this.child.stdin.write(JSON.stringify(o) + "\n"); } catch { /* ignore */ } }
  _notify(method, params) { this._send({ jsonrpc: "2.0", method, params }); }
  _request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this._send({ jsonrpc: "2.0", id, method, params }); });
  }
  _onLine(line) {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    if (msg.id != null && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message || "upstream error")) : resolve(msg.result);
    }
  }
  callTool(name, args) { return this._request("tools/call", { name, arguments: args ?? {} }); }
  stop() { try { this.child?.kill(); } catch { /* ignore */ } }
}
