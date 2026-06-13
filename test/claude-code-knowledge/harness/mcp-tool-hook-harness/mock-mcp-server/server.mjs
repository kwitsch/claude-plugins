#!/usr/bin/env node
/**
 * Minimal zero-dependency MCP stdio server for testing the `type:"mcp_tool"`
 * hook handler in Claude Code.
 *
 * Transport: newline-delimited JSON-RPC 2.0 over stdin/stdout (MCP stdio).
 * All diagnostics go to stderr ONLY. stdout carries protocol messages exclusively.
 *
 * Each tool returns a single text content block. Claude Code treats that text
 * like command-hook stdout: if it is valid JSON output it becomes a hook
 * decision, otherwise it is shown as plain text. The tools below emit one
 * decision shape each so the harness can observe which decisions take effect
 * on which event.
 *
 * Args every emit_* tool accepts (passed by the hook `input` via ${...} substitution):
 *   - event:  the hook event name (use "${hook_event_name}")
 *   - marker: a unique token the harness greps for afterwards
 */

import { stdin, stdout, stderr } from 'node:process';

const PROTOCOL_VERSION_FALLBACK = '2025-06-18';

const TOOLS = [
  {
    name: 'emit_block',
    description: 'Return top-level {"decision":"block","reason":"harness:<marker>"}.',
    inputSchema: schema(),
  },
  {
    name: 'emit_pretool_deny',
    description: 'Return hookSpecificOutput with permissionDecision="deny" (PreToolUse style).',
    inputSchema: schema(),
  },
  {
    name: 'emit_context',
    description: 'Return hookSpecificOutput.additionalContext="HARNESS_CTX_<marker>".',
    inputSchema: schema(),
  },
  {
    name: 'emit_continue_false',
    description: 'Return universal {"continue":false,"stopReason":"harness:<marker>"}.',
    inputSchema: schema(),
  },
  {
    name: 'emit_error',
    description: 'Return isError:true with plain text (tests the non-blocking failure path).',
    inputSchema: schema(),
  },
  {
    name: 'emit_noop',
    description: 'Return plain non-JSON text (no decision).',
    inputSchema: schema(),
  },
];

function schema() {
  return {
    type: 'object',
    properties: {
      event: { type: 'string', description: 'Hook event name' },
      marker: { type: 'string', description: 'Unique tracking token' },
    },
  };
}

function emit(name, args) {
  const ev = (args && args.event) || 'UnknownEvent';
  const m = (args && args.marker) || 'NO_MARKER';
  switch (name) {
    case 'emit_block':
      return { text: JSON.stringify({ decision: 'block', reason: `harness:${m}` }), isError: false };
    case 'emit_pretool_deny':
      return {
        text: JSON.stringify({
          hookSpecificOutput: {
            hookEventName: ev,
            permissionDecision: 'deny',
            permissionDecisionReason: `harness:${m}`,
          },
        }),
        isError: false,
      };
    case 'emit_context':
      return {
        text: JSON.stringify({
          hookSpecificOutput: { hookEventName: ev, additionalContext: `HARNESS_CTX_${m}` },
        }),
        isError: false,
      };
    case 'emit_continue_false':
      return { text: JSON.stringify({ continue: false, stopReason: `harness:${m}` }), isError: false };
    case 'emit_error':
      return { text: `harness error ${m}`, isError: true };
    case 'emit_noop':
      return { text: `harness noop ${m}`, isError: false };
    default:
      return { text: JSON.stringify({ systemMessage: `harness unknown tool ${name}` }), isError: true };
  }
}

function send(msg) {
  stdout.write(JSON.stringify(msg) + '\n');
}

function log(...a) {
  stderr.write(`[mock-mcp] ${a.join(' ')}\n`);
}

function handle(line) {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    log('non-JSON line ignored');
    return;
  }
  const { id, method, params } = req;

  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: (params && params.protocolVersion) || PROTOCOL_VERSION_FALLBACK,
          capabilities: { tools: {} },
          serverInfo: { name: 'hook-harness-mock', version: '1.0.0' },
        },
      });
      return;
    case 'notifications/initialized':
    case 'initialized':
      return; // notification, no response
    case 'ping':
      send({ jsonrpc: '2.0', id, result: {} });
      return;
    case 'tools/list':
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      return;
    case 'tools/call': {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      const out = emit(name, args);
      log(`call ${name} args=${JSON.stringify(args)} -> isError=${out.isError} text=${out.text}`);
      send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: out.text }], isError: out.isError },
      });
      return;
    }
    default:
      if (id !== undefined && id !== null) {
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
      return;
  }
}

let buf = '';
stdin.setEncoding('utf8');
stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) handle(line);
  }
});
stdin.on('end', () => process.exit(0));
log('started');
