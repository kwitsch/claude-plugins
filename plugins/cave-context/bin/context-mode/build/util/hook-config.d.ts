import { type HookAdapter } from "../adapters/types.js";
export declare function getCommandsFromHookEntry(entry: unknown): string[];
/**
 * Extract the hook script path from a hook command string.
 *
 * Post Algo-D2 this is a thin wrapper around `parseNodeCommand` with a
 * single legacy fallback retained for stale-entry cleanup
 * (`configureAllHooks` walks pre-v1.0.124 settings.json shapes that
 * predate `buildNodeCommand`). The legacy branches are deliberately
 * narrow:
 *
 *   1) Canonical: `"<nodePath>" "<scriptPath>.mjs"` — `parseNodeCommand`
 *      handles this; round-trips with `buildNodeCommand`.
 *   2) Legacy quoted: `node "<scriptPath>.mjs"` — emitted by claude-code
 *      pre-D3. The script segment is fully quoted, no whitespace
 *      ambiguity.
 *   3) Legacy unquoted: `node <scriptPath>.mjs` — only when the entire
 *      command is whitespace-safe (exactly two whitespace-separated
 *      tokens). The #548 wire shape — `node C:/Users/High Ground …` —
 *      contains internal whitespace so this branch refuses it. Returns
 *      `null` instead of grabbing the tail after the last whitespace.
 *
 * Anything else returns `null`, letting the doctor (Algo-D1) fall
 * through to direct `existsSync` instead of trusting the regex.
 */
export declare function extractHookScriptPath(command: string): string | null;
export declare function getHookScriptPaths(adapter: HookAdapter, pluginRoot: string): string[];
