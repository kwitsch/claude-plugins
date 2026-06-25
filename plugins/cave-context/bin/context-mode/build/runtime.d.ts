export declare function isAllowlistedShell(shellPath: string): boolean;
export type Language = "javascript" | "typescript" | "python" | "shell" | "ruby" | "go" | "rust" | "php" | "perl" | "r" | "elixir" | "csharp";
export interface RuntimeInfo {
    command: string;
    available: boolean;
    version: string;
    preferred: boolean;
}
export interface RuntimeMap {
    javascript: string | null;
    typescript: string | null;
    python: string | null;
    shell: string;
    ruby: string | null;
    go: string | null;
    rust: string | null;
    php: string | null;
    perl: string | null;
    r: string | null;
    elixir: string | null;
    csharp: string | null;
}
/**
 * Resolve the JavaScript runtime used by PolyglotExecutor.
 *
 * PR #190 (f69b0d2) made `process.execPath` the default so snap-Node
 * envs would not re-invoke the snap wrapper via PATH. That assumed
 * `process.execPath` always points at a JS runtime — true on Node,
 * tsx, and snap-Node, but FALSE when context-mode runs in-process
 * inside a bun-compiled self-contained binary (OpenCode, Kilo, …).
 * In those hosts, `process.execPath` resolves to `opencode.exe` /
 * `opencode` (NOT node), and spawning that with a `.js` argument
 * triggers the yargs "Failed to change directory" error (#731).
 *
 * Fix: gate `process.execPath` on the existing `JS_RUNTIMES`
 * allowlist (single source of truth — same set used by
 * `buildNodeCommand()` in src/adapters/types.ts since PR #708). When
 * the execPath basename is not a known JS runtime, fall back to a
 * PATH-resolved `node`. If neither is reachable, return `null` and
 * let ctx_doctor surface an actionable error.
 *
 * The cross-OS guard is the allowlist itself — NOT a `win32` check.
 * OpenCode ships self-contained binaries on macOS and Linux too,
 * and the bug reproduces identically there.
 */
export declare function resolveJavascriptRuntime(bun: string | null, deps?: {
    execPath?: string;
    commandExists?: (cmd: string) => boolean;
}): string | null;
export declare function detectRuntimes(): RuntimeMap;
export declare function hasBunRuntime(): boolean;
/**
 * Resolved JS runtime for hook spawn commands. `path` is the absolute (or
 * bare-name on POSIX where PATH resolution is reliable) binary path.
 * `isBun` is true only when we successfully probed a Bun ≥1.0 install.
 */
export interface HookRuntime {
    readonly path: string;
    readonly isBun: boolean;
}
/**
 * Reset the hook-runtime resolution cache. Test-only — production code
 * should never call this. Vitest mocks `node:child_process`/`node:fs`
 * per-test, so the per-process cache from a previous test would otherwise
 * mask the mock and yield the host's real bun/node detection result.
 */
export declare function resetHookRuntimeCache(): void;
/**
 * Resolve the JS runtime to use for spawning hook scripts (issue #738).
 *
 * Returns Bun when:
 *   - a bun binary is located via {@link bunCommand} (already handles the
 *     Windows .cmd shim trap from #506 + absolute path fallbacks), AND
 *   - `bun --version` exits 0 within the probe timeout, AND
 *   - the reported semver major is ≥1.
 *
 * Returns Node (`process.execPath`) on every other path — missing bun,
 * version probe failure, version <1, malformed version banner. Silent
 * fallback: never throws, never logs to stderr (a noisy log would clutter
 * the same MCP boot output that #719 tightened up).
 *
 * Result is cached at module load so the cost is amortised across every
 * hook command emission for the lifetime of the process. The cache also
 * keeps the behaviour deterministic — if the user `brew uninstall bun`
 * mid-session, the cached resolution stays valid for that session and the
 * next MCP boot re-detects.
 *
 * Why bun ≥1.0 instead of "any bun":
 *   - Bun 0.x had multiple ESM/module-resolution regressions that broke
 *     dynamic `import()` inside hooks (and our hooks do ~7 dynamic imports
 *     in `pretooluse.mjs`).
 *   - 1.0 ships stable npm-compat that our better-sqlite3-adjacent code
 *     relies on indirectly (hooks share `ensure-deps.mjs` which is
 *     bun-safe past 1.0 but not 0.x).
 *
 * NOT used by:
 *   - `buildNodeCommand` — kept on `process.execPath` for openclaw doctor /
 *     upgrade hints which must invoke the better-sqlite3-loading CLI on
 *     Node (#543: bun cannot dlopen better-sqlite3's prebuilt .node).
 *   - `ensure-deps.mjs` — separate path, must stay on Node for the same
 *     reason.
 *   - `ctx_upgrade` — separate path, must stay on Node for the same reason.
 */
export declare function resolveHookRuntime(): HookRuntime;
export declare function getRuntimeSummary(runtimes: RuntimeMap): string;
export declare function getAvailableLanguages(runtimes: RuntimeMap): Language[];
export declare function buildCommand(runtimes: RuntimeMap, language: Language, filePath: string): string[];
