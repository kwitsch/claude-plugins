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

test("server filters ctx_stats/ctx_doctor/ctx_upgrade from tools/list and rejects calling them", async () => {
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
    for (const denied of ["ctx_stats", "ctx_doctor", "ctx_upgrade"]) {
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
