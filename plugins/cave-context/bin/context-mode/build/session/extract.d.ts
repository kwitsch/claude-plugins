/**
 * Session event extraction — pure functions, zero side effects.
 * Extracts structured events from Claude Code tool calls and user messages.
 *
 * All 13 event categories as specified in PRD Section 3.
 */
export interface SessionEvent {
    /** e.g. "file_read", "file_write", "cwd", "error_tool", "git", "task",
     *  "decision", "rule", "env", "role", "skill", "subagent", "data", "intent" */
    type: string;
    /** e.g. "file", "cwd", "error", "git", "task", "decision",
     *  "rule", "env", "role", "skill", "subagent", "data", "intent" */
    category: string;
    /** Extracted payload — full data, no truncation */
    data: string;
    /** 1=critical (rules, files, tasks) … 5=low */
    priority: number;
    /**
     * Optional — bytes context-mode prevented from entering the model context
     * window for this event. Currently populated by external_ref when a
     * ctx_fetch_and_index tool_response carries the
     * `Fetched and indexed N sections (XKB)` preamble.
     */
    bytes_avoided?: number;
}
export interface ToolCall {
    toolName: string;
    toolInput: Record<string, unknown>;
    toolResponse?: string;
    isError?: boolean;
}
/**
 * Hook input shape as received from Claude Code PostToolUse hook stdin.
 * Uses snake_case to match the raw hook JSON.
 */
export interface HookInput {
    tool_name: string;
    tool_input: Record<string, unknown>;
    tool_response?: string;
    /** Optional structured output from the tool (may carry isError) */
    tool_output?: {
        isError?: boolean;
        is_error?: boolean;
    };
}
/** Reset error-resolution state (for testing). */
export declare function resetErrorResolutionState(): void;
/** Reset iteration-loop state (for testing). */
export declare function resetIterationLoopState(): void;
/**
 * Extract session events from a PostToolUse hook input.
 *
 * Accepts the raw hook JSON shape (snake_case keys) as received from stdin.
 * Returns an array of zero or more SessionEvents. Never throws.
 */
export declare function extractEvents(rawInput: HookInput): SessionEvent[];
/**
 * Extract session events from a UserPromptSubmit hook input (user message text).
 *
 * Handles: decision, role, intent, data categories.
 * Returns an array of zero or more SessionEvents. Never throws.
 */
export declare function extractUserEvents(message: string): SessionEvent[];
/**
 * Issue #4 (new PRD) — SessionStart settings + MCP servers snapshot.
 *
 * Emits ONE session_settings_snapshot event when ≥1 setting is available
 * on the SessionStart input. The data field carries key:value tokens
 * (mcp_count, mcp_servers, model, permission_mode) so the platform can
 * compute MCP integration counts and primary-model adoption per org.
 * mcp_servers list is truncated to first 8 names.
 */
export declare function extractSessionSettings(input: unknown): SessionEvent[];
/**
 * §11 Layer 1 + Layer 3 — multilingual prompt features.
 *
 * Reference: context-mode-platform/docs/prds/2026-06-insight-data-flow/
 *   11-multilingual-prompt-algorithm.md
 *
 * Script-agnostic via Unicode property regex (`\p{L}`, `\p{Lu}`,
 * `\p{Script=X}`). No per-language tables, no franc/fasttext deps.
 * Layer 1 returns 10 numeric/string features; Layer 3 appends a
 * `prompt_word_tokens: string[]` array for the platform's streaming
 * word-frequency UPSERT.
 *
 * Privacy: features carry no prose. Layer 3 tokens are deduped
 * letter-only words ≥3 chars; platform aggregates by (org_id, week,
 * word) so no individual token surfaces in UI.
 */
export interface PromptFeatures {
    prompt_length: number;
    prompt_word_count: number;
    prompt_uppercase_ratio: number;
    prompt_file_ref_count: number;
    prompt_path_ref_count: number;
    prompt_script_primary: string | null;
    prompt_script_count: number;
    prompt_question_glyph_count: number;
    prompt_code_block_count: number;
    prompt_url_count: number;
    prompt_word_tokens: string[];
}
/**
 * Verbatim mirror of §11 Layer 1 reference implementation + Layer 3
 * token extraction. Uses Unicode property regex per the spec — the
 * "no regex" project default does NOT apply here because the spec
 * explicitly mandates `\p{Script=X}` for script-agnostic classification.
 */
export declare function extractUserPromptFeatures(prompt: unknown): PromptFeatures;
