/**
 * adapters/detect — Auto-detect which platform is running.
 *
 * Detection priority:
 *   1. Environment variables (high confidence)
 *   2. Config directory existence (medium confidence)
 *   3. Fallback to Claude Code (low confidence — most common)
 *
 * Verified env vars per platform (from source code audit):
 *   - Claude Code:    CLAUDE_CODE_ENTRYPOINT, CLAUDE_PLUGIN_ROOT,
 *                     CLAUDE_PROJECT_DIR, CLAUDE_SESSION_ID | ~/.claude/
 *   - Gemini CLI:     GEMINI_PROJECT_DIR (hooks), GEMINI_CLI (MCP) | ~/.gemini/
 *   - KiloCode:       KILO, KILO_PID | ~/.config/kilo/
 *   - OpenCode:       OPENCODE_PROJECT_DIR, OPENCODE_CLIENT,
 *                     OPENCODE_TERMINAL, OPENCODE, OPENCODE_PID |
 *                     ~/.config/opencode/
 *   - OpenClaw:       OPENCLAW_HOME, OPENCLAW_CLI | ~/.openclaw/
 *   - Codex CLI:      CODEX_CI, CODEX_THREAD_ID | ~/.codex/
 *   - Cursor:         CURSOR_TRACE_ID (MCP), CURSOR_CLI (terminal) | ~/.cursor/
 *   - VS Code Copilot: VSCODE_PID, VSCODE_CWD | ~/.vscode/
 *   - JetBrains Copilot: IDEA_INITIAL_DIRECTORY, IDEA_HOME, JETBRAINS_CLIENT_ID | ~/.config/JetBrains/
 */
import type { PlatformId, DetectionSignal, HookAdapter } from "./types.js";
/** Test-only: reset the installed_plugins.json memo so each test starts cold. */
export declare function __resetClaudeCodePluginCacheForTests(): void;
/**
 * Test-only: pretend installed_plugins.json does not exist (or has no
 * context-mode entry). Lets tests that exercise the genuine vscode-copilot
 * env-var path run on a developer machine that actually has context-mode
 * installed as a Claude Code plugin.
 */
export declare function __seedClaudeCodePluginCacheMissForTests(): void;
/**
 * Tag for each PLATFORM_ENV_VARS row.
 *   - `workspace`: env var names a project/working directory. Used by
 *     `resolveProjectDir({ strictPlatform })` to form the candidate list,
 *     and by Pi's bridge to scrub foreign workspace vars on child spawn.
 *   - `identification`: env var only signals which host is running; carries
 *     no project path. PRESERVED in normal operation (some are load-bearing
 *     for hook integrations on the host that owns them, e.g. CLAUDE_PLUGIN_ROOT
 *     for Claude Code's hook context).
 *
 * Issue #545 — algorithmic env-leak fix. The split allows resolveProjectDir
 * to derive ALLOW (own workspace vars) and BAN (other platforms' workspace
 * vars) sets from a single registry, satisfying MUST-3 (15 adapters equal).
 *
 * Issue #561 — FOREIGN identification vars MUST be scrubbed when spawning a
 * child under a different host (e.g. Pi spawning context-mode child must
 * scrub Claude Code identification vars CLAUDE_CODE_ENTRYPOINT /
 * CLAUDE_PLUGIN_ROOT to prevent detectPlatform() in the child from
 * misidentifying the host as claude-code and writing Pi's data into
 * ~/.claude/context-mode/). See `foreignIdentificationEnv()` below.
 */
export type EnvVarRole = "workspace" | "identification";
export interface PlatformEnvEntry {
    readonly name: string;
    readonly role: EnvVarRole;
    /**
     * When `false`, this entry is NOT used as a high-confidence detection
     * signal — only consumed by `workspaceEnvVarsFor`/`foreignWorkspaceEnv`
     * (project-dir cascade and bridge env scrub). Use for consumer-set
     * workspace vars that the host runtime never emits itself, so that a
     * stale env var on an unrelated host does not misclassify the platform.
     * Default: `true` (entry participates in detection).
     *
     * Issue #542 — PI_PROJECT_DIR / PI_WORKSPACE_DIR are consumer-set and
     * MUST NOT trigger Pi detection on their own.
     */
    readonly detect?: boolean;
}
export declare const PLATFORM_ENV_VARS: ReadonlyMap<PlatformId, readonly PlatformEnvEntry[]>;
/**
 * Backwards-compat shim: legacy `string[]` shape used by detection logic and
 * by tests that iterate the registry to clear env vars. Always returns the
 * names in registry order.
 */
export declare function getEnvVarNames(platform: PlatformId): string[];
/**
 * Issue #545 — return only role=workspace env var names for a platform, in
 * registry order. Empty array for adapters with no workspace var (e.g.
 * codex, kilo, zed, antigravity, openclaw, kiro). Consumed by
 * `resolveProjectDir({ strictPlatform })` to build the cascade.
 */
export declare function workspaceEnvVarsFor(platform: PlatformId): string[];
/**
 * Issue #545 — return the union of workspace env vars from ALL platforms
 * EXCEPT the given one. Consumed by Pi's bridge env scrub (strip foreign
 * workspace vars from spawned MCP child) and by the matrix regression test.
 */
export declare function foreignWorkspaceEnv(platform: PlatformId): Set<string>;
/**
 * Issue #561 — return the union of identification env vars from ALL
 * platforms EXCEPT the given one. Sibling of `foreignWorkspaceEnv`,
 * filtered on `role === "identification"` instead of "workspace".
 *
 * Consumed by Pi's bridge env scrub: when Pi spawns the context-mode
 * MCP child, the child inherits the host shell env including any
 * identification vars set by a co-resident Claude Code session
 * (CLAUDE_CODE_ENTRYPOINT / CLAUDE_PLUGIN_ROOT). Without scrubbing,
 * `detectPlatform()` in the child falls through env priority order and
 * resolves to claude-code first — Pi's session data then writes into
 * `~/.claude/context-mode/` instead of Pi's own dir. Scrubbing FOREIGN
 * identification vars (everyone else's) preserves Pi's OWN identification
 * vars (PI_CONFIG_DIR / PI_SESSION_FILE / PI_COMPILED) so the child still
 * detects pi correctly.
 *
 * Algorithmic, registry-driven — adding adapter #16 grows the scrub
 * automatically (no edit to mcp-bridge.ts).
 */
export declare function foreignIdentificationEnv(platform: PlatformId): Set<string>;
/**
 * Sync map from platform identifier → home-relative path segments where that
 * platform stores its config. Mirrors the `super([...])` argument passed by
 * each adapter — kept in sync as the single source of truth used when we need
 * a session dir BEFORE an adapter has been instantiated (race window between
 * MCP server start and `initialize` handshake completion).
 *
 * Returns `null` for "unknown" or any string outside the supported set so the
 * caller can decide on a safe fallback.
 */
export declare function getSessionDirSegments(platform: string): string[] | null;
/**
 * Detect the current platform by checking env vars and config dirs.
 *
 * @param clientInfo - Optional MCP clientInfo from initialize handshake.
 *   When provided, takes highest priority (zero-config detection).
 */
export declare function detectPlatform(clientInfo?: {
    name: string;
    version?: string;
}): DetectionSignal;
/**
 * Get the adapter instance for a given platform.
 * Lazily imports platform-specific adapter modules.
 */
export declare function getAdapter(platform?: PlatformId): Promise<HookAdapter>;
