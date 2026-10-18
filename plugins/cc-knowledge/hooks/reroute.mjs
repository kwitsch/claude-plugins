// Pure logic of the claude-code-guide reroute mod (hooks/register.ts). Zero-dep; never references `$`.

export const REROUTE_TARGET = "cc-knowledge:claude-code-expert";

/**
 * Normalize a subagent_type: lowercase, collapse non-alphanumeric runs to `-`, trim.
 * @param {unknown} value
 * @returns {string}
 */
export function normalize(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The subagent_type an Agent call should run with: the expert for any spelling of
 * `claude-code-guide`, else the type unchanged. Loop-safe: the target is not a guide.
 * @template T
 * @param {T} subagentType
 * @returns {T | typeof REROUTE_TARGET}
 */
export function rerouteType(subagentType) {
  return normalize(subagentType) === "claude-code-guide" ? REROUTE_TARGET : subagentType;
}
