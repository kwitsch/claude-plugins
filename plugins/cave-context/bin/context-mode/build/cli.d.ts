#!/usr/bin/env node
/**
 * context-mode CLI
 *
 * Usage:
 *   context-mode                              → Start MCP server (stdio)
 *   context-mode doctor                       → Diagnose runtime issues, hooks, FTS5, version
 *   context-mode upgrade                      → Fix hooks, permissions, and settings
 *   context-mode hook <platform> <event>      → Dispatch a hook script (used by platform hook configs)
 *   CONTEXT_MODE_DIR=/abs/path context-mode   → Override sessions/content storage root
 *     Empty/whitespace is ignored; non-empty values must be absolute.
 *
 * Platform auto-detection: CLI detects which platform is running
 * (Claude Code, Gemini CLI, OpenCode, etc.) and uses the appropriate adapter.
 */
/** Normalize Windows backslash paths to forward slashes for Bash (MSYS2) compatibility. */
export declare function toUnixPath(p: string): string;
export declare function npmExecFile(args: string[], opts?: Record<string, unknown>): void;
export declare function npmExec(command: string, opts?: Record<string, unknown>): void;
/**
 * Open a URL in the user's default browser without invoking a shell.
 *
 * Uses `execFile` with an arg array so the URL cannot be interpreted as
 * shell metacharacters.  Original code used `execSync(`open "${url}"`)`
 * which would shell-interpolate the URL — fragile if the URL ever
 * becomes attacker-controlled (remote, weak port-validation, etc).
 *
 * Best-effort: if the OS opener is missing the function logs a copyable
 * URL hint and returns; it never throws.  `runner` is injectable for
 * tests; default is `child_process.execFile` (callback form, fire-and-
 * forget).
 */
export type ExecFileFn = (file: string, args: readonly string[], opts?: Record<string, unknown>) => unknown;
export declare function openInBrowser(url: string, platform?: NodeJS.Platform, runner?: ExecFileFn): void;
