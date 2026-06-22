'use strict';
// state.mjs — persistent per-workspace LSP gate state for enforcement tracking.
// Stores warm-up status, navigation counts, and escape-hatch flags per cwd hash.
// State files live under CLAUDE_PLUGIN_DATA or XDG_STATE_HOME; expire after EXPIRY_MS.
// No stdout output; all I/O errors are swallowed to keep behavior fail-open.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export const EXPIRY_MS = 24 * 60 * 60 * 1000;

// Resolve the directory that holds all state files, preferring CLAUDE_PLUGIN_DATA.
function dataRoot() {
  const base = process.env.CLAUDE_PLUGIN_DATA
    || join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'shell-lsp');
  return join(base, 'state');
}
// Return the absolute path to the state JSON file for the given working directory.
export function statePath(cwd) {
  const h = createHash('md5').update(String(cwd ?? '')).digest('hex');
  return join(dataRoot(), `lsp-${h}.json`);
}
// Return a zeroed state object with all gate counters at their initial values.
export function freshState() {
  return { warmupDone: false, navCount: 0, readCount: 0, blockedNoNav: 0, lspUnavailable: false, updated: 0 };
}
// Load the current gate state for a cwd; returns freshState on missing or expired files.
export function readState(cwd) {
  try {
    const p = statePath(cwd);
    if (!existsSync(p)) return freshState();
    const s = JSON.parse(readFileSync(p, 'utf8'));
    if (!s || typeof s.updated !== 'number' || Date.now() - s.updated > EXPIRY_MS) return freshState();
    return { ...freshState(), ...s };
  } catch { return freshState(); }
}
// Persist gate state for a cwd, stamping the current time into `updated`.
export function writeState(cwd, s) {
  try {
    const p = statePath(cwd);                 // resolves dataRoot() once (vs twice)
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ ...freshState(), ...s, updated: Date.now() }));
  } catch { /* fail-open: never block on persistence errors */ }
}
// Delete the state file for a cwd, effectively resetting all gate counters.
export function resetState(cwd) {
  try { rmSync(statePath(cwd), { force: true }); } catch { /* ignore */ }
}
