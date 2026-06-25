/**
 * adapters/claude-code-base — Shared base for Claude Code wire-protocol adapters.
 *
 * Claude Code and Qwen Code use the identical JSON stdin/stdout hook protocol:
 *   - Input fields: tool_name, tool_input, tool_output, is_error, session_id,
 *     transcript_path, source
 *   - Blocking: `permissionDecision: "deny"` in response
 *   - Arg modification: `updatedInput` field in response
 *   - Output modification: `updatedMCPToolOutput` field in response
 *   - Context injection: `additionalContext` at response root (not wrapped)
 *   - PreCompact/SessionStart: stdout on exit 0
 *
 * This base class implements the 8 shared parse/format methods.
 * Subclasses provide platform-specific config (env vars, settings path,
 * session ID priority, hook config, diagnostics, upgrade).
 */
import { BaseAdapter } from "./base.js";
import type { PreToolUseEvent, PostToolUseEvent, PreCompactEvent, SessionStartEvent, PreToolUseResponse, PostToolUseResponse, PreCompactResponse, SessionStartResponse } from "./types.js";
export interface ClaudeCodeWireInput {
    tool_name?: string;
    tool_input?: Record<string, unknown>;
    tool_output?: string;
    is_error?: boolean;
    session_id?: string;
    transcript_path?: string;
    source?: string;
}
export declare abstract class ClaudeCodeBaseAdapter extends BaseAdapter {
    /**
     * Environment variable name for the project directory.
     * Claude Code: "CLAUDE_PROJECT_DIR", Qwen Code: "QWEN_PROJECT_DIR"
     */
    protected abstract readonly projectDirEnvVar: string;
    parsePreToolUseInput(raw: unknown): PreToolUseEvent;
    parsePostToolUseInput(raw: unknown): PostToolUseEvent;
    parsePreCompactInput(raw: unknown): PreCompactEvent;
    parseSessionStartInput(raw: unknown): SessionStartEvent;
    formatPreToolUseResponse(response: PreToolUseResponse): unknown;
    formatPostToolUseResponse(response: PostToolUseResponse): unknown;
    formatPreCompactResponse(response: PreCompactResponse): unknown;
    formatSessionStartResponse(response: SessionStartResponse): unknown;
    /**
     * Extract session ID from wire input. Default priority (Claude Code):
     *   transcript_path UUID > session_id > env var > ppid fallback
     *
     * Override in subclasses for different priority (e.g., Qwen: session_id first).
     */
    protected abstract extractSessionId(input: ClaudeCodeWireInput): string;
}
