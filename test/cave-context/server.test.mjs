import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reminderText } from "../../plugins/cave-context/mcp/caveman.mjs";

const SERVER = new URL("../../plugins/cave-context/mcp/server.mjs", import.meta.url).pathname;

function rpc(proc, msgs) {
  return new Promise((resolve) => {
    const got = []; let buf = "";
    proc.stdout.on("data", (d) => {
      buf += d;
      let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) got.push(JSON.parse(l)); }
      if (got.length >= msgs.filter((m) => m.id != null).length) resolve(got);
    });
    for (const m of msgs) proc.stdin.write(JSON.stringify(m) + "\n");
  });
}

test("server lists embedded ctx tools + hook tools and routes calls", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-srv-"));
  const proc = spawn("node", [SERVER], { env: { ...process.env, CONTEXT_MODE_DIR: dir, CLAUDE_PROJECT_DIR: dir, CAVE_CONTEXT_NO_UPSTREAM: "1" }, stdio: ["pipe", "pipe", "inherit"] });
  try {
    const out = await rpc(proc, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ctx_search", arguments: { queries: ["hello"] } } },
    ]);
    const list = out.find((m) => m.id === 2).result.tools.map((t) => t.name);
    assert.ok(list.includes("ctx_search"), "ctx_search listed from embedded tools");
    assert.ok(list.includes("hook_userpromptsubmit"), "hook tool listed");
    const callRes = out.find((m) => m.id === 3).result;
    assert.ok(Array.isArray(callRes.content), "ctx_search returns MCP content envelope");
  } finally { proc.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test("server routes hook_ tools/call through HANDLERS and returns both channels", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-srv-"));
  const proc = spawn("node", [SERVER], { env: { ...process.env, CONTEXT_MODE_DIR: dir, CAVE_CONTEXT_NO_UPSTREAM: "1", CLAUDE_PLUGIN_DATA: dir }, stdio: ["pipe", "pipe", "inherit"] });
  try {
    const out = await rpc(proc, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "hook_userpromptsubmit", arguments: { hook_event_name: "UserPromptSubmit", prompt: "/caveman ultra" } } },
    ]);
    const result = out.find((m) => m.id === 4).result;
    // Routing + content wrapping: handler output is JSON-stringified into the text channel.
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(parsed.hookSpecificOutput, "hook handler output carries hookSpecificOutput");
    // Caveman level is fixed at full — the "/caveman ultra" arg is ignored.
    assert.ok(parsed.hookSpecificOutput.additionalContext.includes(reminderText()));
    assert.doesNotMatch(parsed.hookSpecificOutput.additionalContext, /ultra/);
    // Contract: structuredContent must deep-equal the parsed handler result (mcp_tool extraction channel).
    assert.deepEqual(result.structuredContent, parsed);
  } finally { proc.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test("server filters denied ctx_* tools (stats/doctor/upgrade/insight) from tools/list and rejects calling them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-srv-"));
  const proc = spawn("node", [SERVER], { env: { ...process.env, CONTEXT_MODE_DIR: dir, CLAUDE_PROJECT_DIR: dir }, stdio: ["pipe", "pipe", "inherit"] });
  try {
    const out = await rpc(proc, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ctx_stats", arguments: {} } },
    ]);
    const list = out.find((m) => m.id === 2).result.tools.map((t) => t.name);
    assert.ok(list.includes("ctx_search"), "non-denied upstream tool still exposed");
    for (const denied of ["ctx_stats", "ctx_doctor", "ctx_upgrade", "ctx_insight"]) {
      assert.ok(!list.includes(denied), `${denied} must be filtered from tools/list`);
    }
    // Calling a denied tool errors like an unknown tool — never forwarded upstream.
    const call = out.find((m) => m.id === 3);
    assert.ok(call.error, "calling a denied tool returns a JSON-RPC error");
    assert.match(call.error.message, /unknown tool: ctx_stats/);
  } finally { proc.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test("server advertises the compress tool with a typed schema", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-srv-"));
  const proc = spawn("node", [SERVER], { env: { ...process.env, CONTEXT_MODE_DIR: dir, CAVE_CONTEXT_NO_UPSTREAM: "1" }, stdio: ["pipe", "pipe", "inherit"] });
  try {
    const out = await rpc(proc, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ]);
    const tools = out.find((m) => m.id === 2).result.tools;
    const compress = tools.find((t) => t.name === "compress");
    assert.ok(compress, "compress tool is advertised");
    assert.deepEqual(compress.inputSchema.required, ["text"]);
    assert.equal(compress.inputSchema.properties.text.type, "string");
  } finally { proc.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test("every advertised tool exposes a JSON-Schema inputSchema (type: object)", async () => {
  // Regression: Claude Code Zod-validates each tools/list entry's inputSchema.type === "object"
  // and drops the whole server ("tools fetch failed") if any tool fails. The embedded upstream
  // ctx_* tools must be emitted as converted JSON Schema, not raw Zod objects (which have no .type).
  // Real upstream (no CAVE_CONTEXT_NO_UPSTREAM — that flag never gated the embed Upstream anyway).
  const dir = mkdtempSync(join(tmpdir(), "cc-srv-schema-"));
  const proc = spawn("node", [SERVER], { env: { ...process.env, CONTEXT_MODE_DIR: dir, CLAUDE_PROJECT_DIR: dir }, stdio: ["pipe", "pipe", "inherit"] });
  try {
    const out = await rpc(proc, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ]);
    const tools = out.find((m) => m.id === 2).result.tools;
    // The upstream ctx_* tools (the ones the client rejected) must be present and valid.
    assert.ok(tools.some((t) => t.name === "ctx_execute"), "embedded ctx_* tools present in tools/list");
    for (const t of tools) {
      assert.equal(t.inputSchema?.type, "object", `tool ${t.name}: inputSchema.type must be "object" (Claude Code Zod-validates this)`);
    }
    // Guard against silent degradation: a permissive fallback schema also satisfies
    // type:"object", so assert the SDK conversion is actually retaining the per-parameter
    // schema. If the SDK-internal tools/list access ever breaks, this fails loudly instead
    // of quietly serving param-less tools.
    const ctxExecute = tools.find((t) => t.name === "ctx_execute");
    assert.ok(ctxExecute.inputSchema.properties?.code, "ctx_execute retains the rich SDK-converted schema, not the permissive fallback");
  } finally { proc.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test("server drains in-flight fire-and-forget captures on stdin-close shutdown", async () => {
  // Regression guard: PostToolUse/UserPromptSubmit capture runs fire-and-forget. A session that
  // ends WITHOUT a compaction (plain stdin close) must not lose its tail of events —
  // server.mjs drains in-flight captures in its rl.on("close") handler before process.exit().
  // Real capture path (no CAVE_CONTEXT_NO_UPSTREAM, which would short-circuit the delegate to null).
  const dir = mkdtempSync(join(tmpdir(), "cc-srv-drain-"));
  const sessionId = "s-shutdown-drain";
  const priorEnv = { d: process.env.CONTEXT_MODE_DIR, p: process.env.CONTEXT_MODE_PROJECT_DIR, c: process.env.CLAUDE_PROJECT_DIR };
  const proc = spawn("node", [SERVER], { env: { ...process.env, CONTEXT_MODE_DIR: dir, CLAUDE_PROJECT_DIR: dir }, stdio: ["pipe", "pipe", "inherit"] });
  try {
    const exited = new Promise((res) => proc.on("exit", res));
    let buf = "";
    proc.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        // The hook returned {} (capture is now fire-and-forget, in flight). Close stdin to
        // trigger the drain-on-shutdown path; without the drain the capture would be lost.
        if (msg.id === 2) proc.stdin.end();
      }
    });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } } }) + "\n");
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "hook_posttooluse", arguments: { session_id: sessionId, cwd: dir, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "git status" }, tool_response: "On branch main\nnothing to commit" } } }) + "\n");
    await exited;

    // After a clean shutdown the fire-and-forget capture must have been drained to disk.
    process.env.CONTEXT_MODE_DIR = dir;
    process.env.CONTEXT_MODE_PROJECT_DIR = dir;
    process.env.CLAUDE_PROJECT_DIR = dir;
    const H = (p) => new URL(`../../plugins/cave-context/bin/context-mode/hooks/${p}`, import.meta.url).pathname;
    const { SessionDB } = await import(H("session-db.bundle.mjs"));
    const { getSessionDBPath } = await import(H("session-helpers.mjs"));
    const reader = new SessionDB({ dbPath: getSessionDBPath() });
    const rollup = reader.getSessionRollup(sessionId);
    reader.close();
    assert.ok(rollup.tool_calls >= 1, `shutdown drain must persist the in-flight capture, got tool_calls=${rollup.tool_calls}`);
  } finally {
    proc.kill();
    rmSync(dir, { recursive: true, force: true });
    // restore env so later tests in this file are unaffected
    for (const [k, v] of [["CONTEXT_MODE_DIR", priorEnv.d], ["CONTEXT_MODE_PROJECT_DIR", priorEnv.p], ["CLAUDE_PROJECT_DIR", priorEnv.c]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("server tools/call compress returns well-formed MCP response on empty input", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-srv-"));
  const proc = spawn("node", [SERVER], { env: { ...process.env, CONTEXT_MODE_DIR: dir, CAVE_CONTEXT_NO_UPSTREAM: "1" }, stdio: ["pipe", "pipe", "inherit"] });
  try {
    const out = await rpc(proc, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "compress", arguments: { text: "" } } },
    ]);
    const res = out.find((m) => m.id === 2).result;
    // Must have a content array (MCP tool response shape) and carry valid:false for empty input
    assert.ok(Array.isArray(res.content), "response has content array");
    const structured = res.structuredContent ?? JSON.parse(res.content[0].text);
    assert.equal(structured.valid, false);
    assert.match(structured.reason, /empty/i);
  } finally { proc.kill(); rmSync(dir, { recursive: true, force: true }); }
});
