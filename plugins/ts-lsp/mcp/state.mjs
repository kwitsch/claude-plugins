'use strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export const EXPIRY_MS = 24 * 60 * 60 * 1000;

function dataRoot() {
  const base = process.env.CLAUDE_PLUGIN_DATA
    || join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'ts-lsp');
  return join(base, 'state');
}
export function statePath(cwd) {
  const h = createHash('md5').update(String(cwd ?? '')).digest('hex');
  return join(dataRoot(), `lsp-${h}.json`);
}
export function freshState() {
  return { warmupDone: false, navCount: 0, readCount: 0, blockedNoNav: 0, lspUnavailable: false, updated: 0 };
}
export function readState(cwd) {
  try {
    const p = statePath(cwd);
    if (!existsSync(p)) return freshState();
    const s = JSON.parse(readFileSync(p, 'utf8'));
    if (!s || typeof s.updated !== 'number' || Date.now() - s.updated > EXPIRY_MS) return freshState();
    return { ...freshState(), ...s };
  } catch { return freshState(); }
}
export function writeState(cwd, s) {
  try {
    const p = statePath(cwd);                 // resolves dataRoot() once (vs twice)
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ ...freshState(), ...s, updated: Date.now() }));
  } catch { /* fail-open: never block on persistence errors */ }
}
export function resetState(cwd) {
  try { rmSync(statePath(cwd), { force: true }); } catch { /* ignore */ }
}
