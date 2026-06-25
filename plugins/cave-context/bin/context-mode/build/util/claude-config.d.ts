export declare function resolveClaudeConfigDir(env?: NodeJS.ProcessEnv): string;
/** Resolve the global settings.json path, honoring CLAUDE_CONFIG_DIR. */
export declare function resolveClaudeGlobalSettingsPath(env?: NodeJS.ProcessEnv): string;
/**
 * Issue #451 round-3: cross-adapter deny-policy parity.
 *
 * `resolveClaudeGlobalSettingsPath` hardcodes the `.claude` segment, so
 * non-Claude adapters (cursor, codex, qwen-code, gemini-cli, jetbrains-copilot,
 * vscode-copilot, etc.) never had their global settings consulted by the
 * security policy reader. This helper returns the union of:
 *
 *   1. The currently-detected adapter's home-rooted settings.json (when the
 *      adapter is non-claude — claude is already covered by entry 2).
 *   2. The claude global settings.json (always — defense in depth).
 *
 * Static import of `../adapters/detect.js` is safe — detect.ts only imports
 * `node:` builtins, `./types.js` (type-only), and `./client-map.js` (pure
 * data). It does NOT import claude-config back, so no cycle.
 *
 * History: this used `createRequire(import.meta.url).resolve(...)` to lazy-
 * load detect at call time. That pattern requires `require(esm)`, which is
 * flag-gated on Node 22.x before 22.12 (`--experimental-require-module`).
 * CI run 25877550371 on Node 22.5 silently failed every detect.* call —
 * the catch block ate the error and every cross-adapter deny-policy test
 * returned an empty policy list. Static import sidesteps the require(esm)
 * gate entirely, so the same code works on every supported Node version
 * (20.x, 22.5, 22.12+, 24+) without needing the experimental flag.
 *
 * The returned array is deduplicated and order-stable: adapter-specific path
 * first (most specific), claude global second (fallback).
 */
export declare function resolveAdapterGlobalSettingsPaths(env?: NodeJS.ProcessEnv): string[];
