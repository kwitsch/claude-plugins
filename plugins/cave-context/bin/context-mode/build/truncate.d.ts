/**
 * truncate — Pure string truncation and escaping utilities for context-mode.
 *
 * These helpers are used by the core ContentStore (chunking) and
 * SessionDB (snapshot building). They are extracted here so any
 * consumer can import them without pulling in the full store or executor.
 */
/**
 * Return a prefix of `str` no longer than `maxChars` UTF-16 code units, with
 * the cut backed off by one unit if it would split a surrogate pair. Mirrors
 * the surrogate-safety semantics of the internal `byteSafePrefix`, but uses
 * a character budget rather than a byte budget.
 *
 * Use this instead of bare `str.slice(0, n)` whenever the result is later
 * JSON-encoded for an RFC 8259-strict consumer (e.g. tool_result payloads
 * sent back to the host LLM API). `JSON.stringify` will emit a lone high
 * surrogate as a literal `\uD8xx` escape, which is invalid JSON.
 *
 * @param str      - Input string.
 * @param maxChars - Hard cap in UTF-16 code units.
 */
export declare function charSafePrefix(str: string, maxChars: number): string;
/**
 * Serialize a value to JSON, then truncate the result to `maxBytes` bytes.
 * If truncation occurs, the string is cut at a UTF-8-safe boundary and
 * "... [truncated]" is appended. The result is NOT guaranteed to be valid
 * JSON after truncation — it is suitable only for display/logging.
 *
 * The returned string is always <= `maxBytes` bytes. When `maxBytes` is
 * smaller than the marker, the marker itself is byte-safely truncated.
 *
 * @param value    - Any JSON-serializable value.
 * @param maxBytes - Maximum byte length of the returned string.
 * @param indent   - JSON indentation spaces (default 2). Pass 0 for compact.
 */
export declare function truncateJSON(value: unknown, maxBytes: number, indent?: number): string;
/**
 * Escape a string for safe embedding in an XML or HTML attribute or text node.
 * Replaces the five XML-reserved characters: `&`, `<`, `>`, `"`, `'`.
 *
 * Used by the resume snapshot template builder to embed user content in
 * `<tool_response>` and `<user_message>` XML tags without breaking the
 * structured prompt format.
 */
export declare function escapeXML(str: string): string;
/**
 * Return `str` unchanged if it fits within `maxBytes`, otherwise return a
 * byte-safe slice with an ellipsis appended. Useful for single-value fields
 * (e.g., tool response strings) where head+tail splitting is not needed.
 *
 * The returned string is always <= `maxBytes` bytes. When `maxBytes` is
 * smaller than the ellipsis marker, the marker itself is byte-safely truncated.
 *
 * @param str      - Input string.
 * @param maxBytes - Hard byte cap.
 */
export declare function capBytes(str: string, maxBytes: number): string;
