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
// ─────────────────────────────────────────────────────────
// Base adapter for Claude Code wire protocol
// ─────────────────────────────────────────────────────────
export class ClaudeCodeBaseAdapter extends BaseAdapter {
    // ── Input parsing (shared wire format) ─────────────────
    parsePreToolUseInput(raw) {
        const input = raw;
        return {
            toolName: input.tool_name ?? "",
            toolInput: input.tool_input ?? {},
            sessionId: this.extractSessionId(input),
            projectDir: process.env[this.projectDirEnvVar] ?? process.cwd(),
            raw,
        };
    }
    parsePostToolUseInput(raw) {
        const input = raw;
        return {
            toolName: input.tool_name ?? "",
            toolInput: input.tool_input ?? {},
            toolOutput: input.tool_output,
            isError: input.is_error,
            sessionId: this.extractSessionId(input),
            projectDir: process.env[this.projectDirEnvVar] ?? process.cwd(),
            raw,
        };
    }
    parsePreCompactInput(raw) {
        const input = raw;
        return {
            sessionId: this.extractSessionId(input),
            projectDir: process.env[this.projectDirEnvVar] ?? process.cwd(),
            raw,
        };
    }
    parseSessionStartInput(raw) {
        const input = raw;
        const rawSource = input.source ?? "startup";
        let source;
        switch (rawSource) {
            case "compact":
                source = "compact";
                break;
            case "resume":
                source = "resume";
                break;
            case "clear":
                source = "clear";
                break;
            default:
                source = "startup";
        }
        return {
            sessionId: this.extractSessionId(input),
            source,
            projectDir: process.env[this.projectDirEnvVar] ?? process.cwd(),
            raw,
        };
    }
    // ── Response formatting (shared wire format) ───────────
    formatPreToolUseResponse(response) {
        if (response.decision === "deny") {
            return {
                permissionDecision: "deny",
                reason: response.reason ?? "Blocked by context-mode hook",
            };
        }
        if (response.decision === "modify" && response.updatedInput) {
            return { updatedInput: response.updatedInput };
        }
        if (response.decision === "context" && response.additionalContext) {
            return { additionalContext: response.additionalContext };
        }
        if (response.decision === "ask") {
            return { permissionDecision: "ask" };
        }
        // "allow" — return undefined for passthrough
        return undefined;
    }
    formatPostToolUseResponse(response) {
        const result = {};
        if (response.additionalContext) {
            result.additionalContext = response.additionalContext;
        }
        if (response.updatedOutput) {
            result.updatedMCPToolOutput = response.updatedOutput;
        }
        return Object.keys(result).length > 0 ? result : undefined;
    }
    formatPreCompactResponse(response) {
        return response.context ?? "";
    }
    formatSessionStartResponse(response) {
        return response.context ?? "";
    }
}
