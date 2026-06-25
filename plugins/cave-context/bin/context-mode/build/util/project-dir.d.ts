import type { PlatformId } from "../adapters/types.js";
/**
 * Project-dir resolution helpers — shared between `start.mjs` (the MCP entry
 * point) and `src/server.ts getProjectDir()` (the consumer).
 *
 * Background: when Claude Code runs `/ctx-upgrade`, it kills + respawns the
 * MCP server. The respawn happens with `cwd` set to the plugin install
 * directory (`~/.claude/plugins/cache/context-mode/context-mode/<version>/`).
 * The legacy `start.mjs` then set `CLAUDE_PROJECT_DIR = originalCwd`, which
 * poisoned every downstream `ctx_stats` / SessionDB / hash computation —
 * sessions silently re-rooted under the plugin install path.
 *
 * Defense-in-depth fix (v1.0.113):
 *   - `start.mjs` calls `isPluginInstallPath(originalCwd)` and skips the env
 *     auto-set when true (no poisoning at the source).
 *   - `getProjectDir()` calls `resolveProjectDir(...)` which rejects plugin-
 *     pathed env vars and the plugin cwd, preferring `process.env.PWD`
 *     (shell-set, survives `process.chdir`) before falling back.
 */
/**
 * Detect whether a path lives inside an agent plugin install tree —
 * specifically `<home>/.claude/plugins/cache/<plugin>/<plugin>/<version>/`,
 * `<home>/.codex/plugins/cache/<plugin>/<plugin>/<version>/`, or the
 * marketplace mirror under `<home>/.{claude,codex}/plugins/marketplaces/...`.
 *
 * Cross-OS: matches both POSIX (`/`) and Windows (`\`) path separators.
 * Independent of `home` location — we only care about the agent plugin
 * suffix pattern.
 */
export declare function isPluginInstallPath(p: string): boolean;
/**
 * Read the per-session project dir from Claude Code's transcript files.
 *
 * Claude Code writes session transcripts under
 * `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. Each line is a JSON
 * event; an early line (typically line 2) carries a `cwd` field with the
 * literal project directory the session is running against. The encoded dir
 * name itself is lossy (`/` and `.` both become `-`), so we read the JSONL.
 *
 * This is the strongest available signal when Claude Code does NOT propagate
 * `CLAUDE_PROJECT_DIR` to the spawned MCP env (the common case when Claude
 * Code is launched from the desktop app rather than `cd <project> && claude`).
 *
 * Returns `undefined` when no transcript exists, the projects dir is empty,
 * or no transcript carries a `cwd` field — caller falls through.
 *
 * Multi-window safety: the most-recently-modified jsonl wins. When the user
 * actively talks to one Claude Code window, that window's transcript is the
 * one being written to RIGHT NOW, so its mtime is freshest. Other windows'
 * transcripts have older mtimes and are correctly ignored.
 */
export declare function resolveProjectDirFromTranscript(opts: {
    projectsRoot: string;
    /**
     * Optional freshness guard. Claude Code updates the active transcript while
     * the session is being used; stale transcripts from previous days must not
     * become a global project-dir signal for other hosts that merely have
     * ~/.claude on disk.
     */
    maxAgeMs?: number;
    /** Test seam for maxAgeMs. Defaults to Date.now(). */
    nowMs?: number;
}): string | undefined;
/**
 * Issue #45 / c4529042182 — recover the project-cwd from a Codex CLI
 * session log when the spawned MCP child inherits a non-project cwd
 * (e.g. $HOME when Codex was launched from anywhere outside the project).
 *
 * Codex writes its session transcripts to either
 * `${CODEX_HOME ?? ~/.codex}/sessions/<uuid>.jsonl` (CLI) or a dated desktop
 * layout such as
 * `${CODEX_HOME ?? ~/.codex}/sessions/YYYY/MM/DD/rollout-*.jsonl`.
 * The cwd appears on `meta.cwd` for the CLI shape and on
 * `payload.cwd` in `type: "session_meta"` records for Codex Desktop. Codex
 * publishes NO workspace env var to its child MCP processes — so unlike
 * Claude/Pi/Cursor, we have no env signal at all. The session log is the
 * strongest available signal.
 *
 * Mirror of `resolveProjectDirFromTranscript` for Claude Code; differences:
 *   • Sessions may live flat or in a dated hierarchy (no per-project encoded
 *     subdir like Claude's `~/.claude/projects/<encoded>/`).
 *   • The cwd is nested on `meta.cwd` or `payload.cwd`, not top-level `cwd`.
 *
 * Returns `null` when:
 *   • `codexHome` or its `sessions/` subdir does not exist.
 *   • No `.jsonl` files exist or none has a parseable cwd string.
 *   • The newest log is older than `transcriptMaxAgeMs` (multi-window guard).
 *   • The resolved cwd points at a plugin install path (poisoned).
 */
export declare function resolveCodexSessionCwd(opts?: {
    /** Defaults to `process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex")`. */
    codexHome?: string;
    /**
     * Optional freshness guard — Codex appends to the active log while the
     * session is running, so a stale log from days ago must not become a
     * global project-dir signal.
     */
    transcriptMaxAgeMs?: number;
    /** Test seam for transcriptMaxAgeMs. Defaults to Date.now(). */
    now?: number;
}): string | null;
/**
 * Pure project-dir resolver. Mirror of the env-var chain inside
 * `src/server.ts getProjectDir()`, but takes its inputs explicitly so the
 * resolver can be exercised under test without process-level mutation.
 *
 * Resolution order:
 *   1. Adapter-priority env vars (CLAUDE / GEMINI / VSCODE / OPENCODE / PI /
 *      IDEA / CONTEXT_MODE) — first non-empty AND non-plugin-path wins.
 *   2. Claude Code transcript heuristic — read `cwd` from the most-recently-
 *      modified `~/.claude/projects/<encoded>/<session>.jsonl`. This is the
 *      most reliable signal when Claude Code launched MCP from a non-project
 *      cwd (desktop-app launch, `/ctx-upgrade` respawn, etc.).
 *   3. `process.env.PWD` — shell-set, NOT updated by `process.chdir()`, so
 *      it survives the `start.mjs` chdir into the plugin dir. Skipped if
 *      it too points at a plugin install path.
 *   4. `cwd` — last resort. Returned even if it is a plugin path; the
 *      caller is responsible for rendering a graceful "no project context"
 *      message rather than panicking. Keeping the function total preserves
 *      operation of project-independent tools (sandbox execute, fetch).
 */
export declare function resolveProjectDir(opts: {
    env: Record<string, string | undefined>;
    cwd: string;
    pwd: string | undefined;
    /** Optional override; production code passes `~/.claude/projects`. */
    transcriptsRoot?: string;
    /** Optional freshness guard for Claude Code transcript project recovery. */
    transcriptMaxAgeMs?: number;
    /** Test seam for transcriptMaxAgeMs. Defaults to Date.now(). */
    nowMs?: number;
    /**
     * Issue #545 — opt-in tightening. When set, the candidate list is built
     * algorithmically from `workspaceEnvVarsFor(strictPlatform)` plus the
     * universal escape hatch. Foreign workspace vars (e.g. CLAUDE_PROJECT_DIR
     * leaked into Pi's MCP child env) cannot win, regardless of cascade order.
     *
     * When `undefined`, the legacy literal candidate order is used (semver lock
     * for `start.mjs` and any non-strict consumer).
     */
    strictPlatform?: PlatformId;
    /**
     * Issue #45 — override `${CODEX_HOME ?? ~/.codex}` for tests. When
     * `strictPlatform === "codex"` and the env cascade yields nothing, the
     * resolver reads `meta.cwd` from the newest session.jsonl under
     * `${codexHome}/sessions/`.
     */
    codexHome?: string;
}): string;
