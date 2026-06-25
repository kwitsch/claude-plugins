/**
 * adapters/types — Platform adapter interface for multi-platform hook support.
 *
 * Defines the contract that each platform adapter must implement.
 * Three paradigms exist across supported platforms:
 *   A) JSON stdin/stdout — Claude Code, Gemini CLI, VS Code Copilot, Copilot CLI, Cursor
 *   B) TS Plugin Functions — OpenCode
 *   C) MCP-only (no hooks) — Codex CLI
 *
 * The MCP server layer is 100% portable and needs no adapter.
 * Only the hook layer requires platform-specific adapters.
 */
// ─────────────────────────────────────────────────────────
// Hook paradigm
// ─────────────────────────────────────────────────────────
import { resolveHookRuntime } from "../runtime.js";
// ─────────────────────────────────────────────────────────
// Platform detection
// ─────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────
// Cross-platform command helpers (#369, #372)
// ─────────────────────────────────────────────────────────
/**
 * Build a cross-platform `node <script>` command string.
 *
 * Fixes two Windows bugs:
 *   #369 — Bare `node` fails on Windows Git Bash (MSYS) because PATH
 *          resolution is unreliable. Uses `process.execPath` instead.
 *   #372 — MSYS rewrites absolute paths on non-C: drives (e.g.
 *          `C:\Users\...` → `D:\c\Users\...`). Forward slashes +
 *          double-quoting prevents the translation.
 *
 * Safe on macOS/Linux — quoting and forward slashes are no-ops there.
 */
export function buildNodeCommand(scriptPath, opts) {
    let nodePath = process.execPath.replace(/\\/g, "/");
    if (isInProcessPluginPlatform(opts?.platform)) {
        const base = nodePath.split("/").pop().replace(/\.exe$/i, "");
        if (!JS_RUNTIMES.has(base)) {
            nodePath = opts?.jsRuntime?.replace(/\\/g, "/") ?? "node";
        }
    }
    const safePath = scriptPath.replace(/\\/g, "/");
    return `"${nodePath}" "${safePath}"`;
}
/**
 * Build a cross-platform hook spawn command using the resolved JS runtime
 * (issue #738). Identical wire-format to {@link buildNodeCommand} — two
 * double-quoted, forward-slashed tokens separated by whitespace — so it
 * round-trips through {@link parseNodeCommand} unchanged.
 *
 * The only difference is the runtime path: when a Bun ≥1.0 install is
 * detected at process start, that path is used in place of `process.execPath`.
 * Hooks run end-to-end in pure JS (no native modules) so swapping the
 * runtime is a no-op for output but cuts ~40-60ms of Node cold-start per
 * tool call.
 *
 * Why a SEPARATE helper instead of repurposing {@link buildNodeCommand}:
 *   `buildNodeCommand` is also called by openclaw plugin (doctor / upgrade
 *   command suggestions in `src/adapters/openclaw/plugin.ts`). Those CLI
 *   targets MUST stay on Node because they load better-sqlite3, which has
 *   no Bun-compatible prebuild yet (#543). Keeping the two helpers separate
 *   makes the audit trivial: anything emitting a hook spawn command uses
 *   `buildHookRuntimeCommand`; anything emitting a user-visible CLI command
 *   stays on `buildNodeCommand`.
 *
 * `opts.platform` is forwarded to {@link isInProcessPluginPlatform} so the
 * existing opencode/kilo in-process JS-runtime substitution still works
 * (those platforms inject their own runtime via `opts.jsRuntime`).
 */
export function buildHookRuntimeCommand(scriptPath, opts) {
    // In-process plugin platforms (opencode/kilo) inject their own runtime —
    // delegate to buildNodeCommand which already handles that special case.
    if (isInProcessPluginPlatform(opts?.platform)) {
        return buildNodeCommand(scriptPath, opts);
    }
    const runtime = resolveHookRuntime();
    const runtimePath = runtime.path.replace(/\\/g, "/");
    const safePath = scriptPath.replace(/\\/g, "/");
    return `"${runtimePath}" "${safePath}"`;
}
/**
 * Strict inverse of `buildNodeCommand`.
 *
 * Returns `{ nodePath, scriptPath }` ONLY when `cmd` could have been
 * produced by `buildNodeCommand` — i.e. exactly two double-quoted args
 * separated by whitespace. Anything else (bare `node …`, single quotes,
 * unquoted ambiguous input, CLI dispatcher entries) returns `null`.
 *
 * Why strict: the legacy `\S+\.mjs` fallback in
 * `src/util/hook-config.ts:24` and the two-step regex in
 * `src/adapters/claude-code/hooks.ts:178` silently grabbed the path tail
 * after the last whitespace whenever the host wire-format dropped quotes,
 * producing the #548 doubled-path FAIL when `pluginRoot` contained
 * spaces (e.g. `C:\Users\High Ground Services\…`). A canonical inverse
 * lets every emit (`buildNodeCommand`) round-trip through every parse
 * (`parseNodeCommand`) without inventing fallbacks. Adapter #16 inherits
 * the contract by importing one module.
 */
export function parseNodeCommand(cmd) {
    if (typeof cmd !== "string" || cmd.length === 0)
        return null;
    // Match `"<nodePath>" "<scriptPath>"` with arbitrary whitespace
    // separator. Both segments must be non-empty and contain no embedded
    // double quotes — buildNodeCommand never emits embedded quotes.
    const m = cmd.match(/^"([^"]+)"\s+"([^"]+)"\s*$/);
    if (!m)
        return null;
    return { nodePath: m[1], scriptPath: m[2] };
}
/** Known JS runtime binary names (base filename without extension). */
export const JS_RUNTIMES = new Set(["node", "bun", "deno"]);
/** Platforms where context-mode runs as an in-process TS plugin (not MCP stdio). */
export const IN_PROCESS_PLUGIN_PLATFORMS = new Set(["opencode", "kilo"]);
export function isInProcessPluginPlatform(p) {
    return !!p && IN_PROCESS_PLUGIN_PLATFORMS.has(p);
}
