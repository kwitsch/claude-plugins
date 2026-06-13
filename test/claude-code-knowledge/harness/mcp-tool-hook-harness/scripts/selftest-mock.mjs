#!/usr/bin/env node
/**
 * selftest-mock.mjs — verify the stdio MCP mock server speaks the protocol and
 * emits the expected decision payloads. Runs without Claude Code.
 */
import { spawn } from 'node:child_process';
import { MOCK_SERVER } from './lib.mjs';

function newClient() {
  const child = spawn('node', [MOCK_SERVER], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '';
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  let id = 0;
  function call(method, params) {
    const myId = ++id;
    return new Promise((resolve) => {
      pending.set(myId, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
    });
  }
  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
  return { child, call, notify };
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok:', msg);
  }
}

const c = newClient();
const init = await c.call('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
assert(init.result?.serverInfo?.name === 'hook-harness-mock', 'initialize returns serverInfo');
c.notify('notifications/initialized', {});

const list = await c.call('tools/list', {});
const names = (list.result?.tools || []).map((t) => t.name);
assert(names.includes('emit_block') && names.includes('emit_context'), 'tools/list exposes emit tools');

const ctx = await c.call('tools/call', { name: 'emit_context', arguments: { event: 'PostToolUse', marker: 'XYZ' } });
const ctxText = ctx.result?.content?.[0]?.text || '';
const ctxObj = JSON.parse(ctxText);
assert(ctxObj.hookSpecificOutput?.hookEventName === 'PostToolUse', 'emit_context echoes event name');
assert(ctxObj.hookSpecificOutput?.additionalContext === 'HARNESS_CTX_XYZ', 'emit_context wraps marker');

const blk = await c.call('tools/call', { name: 'emit_block', arguments: { marker: 'ABC' } });
const blkObj = JSON.parse(blk.result?.content?.[0]?.text || '{}');
assert(blkObj.decision === 'block' && blkObj.reason === 'harness:ABC', 'emit_block returns block decision');

const cf = await c.call('tools/call', { name: 'emit_continue_false', arguments: { marker: 'STOPME' } });
const cfObj = JSON.parse(cf.result?.content?.[0]?.text || '{}');
assert(cfObj.continue === false && cfObj.stopReason === 'harness:STOPME', 'emit_continue_false returns continue:false');

const er = await c.call('tools/call', { name: 'emit_error', arguments: { marker: 'E1' } });
assert(er.result?.isError === true, 'emit_error sets isError:true');

c.child.stdin.end();
c.child.kill();
console.log('\nmock self-test complete.');
