/**
 * error-classifier — PRD-context-as-a-service §5 ABI parity
 *
 * Pure classifiers that derive per-event metadata from PostToolUse hook
 * stdin, mirroring the seed shape produced by context-mode-platform's
 * `seed.ts` so the bridge can ship full seed-shape parity.
 *
 * The dashboard reads three derived columns that are populated by the
 * platform seeder but, per the OSS handoff (ANOMALY #3), are NEVER READ
 * by the engine when ingesting live events:
 *
 *   • error_category   — one of 10 fixed buckets
 *   • error_tool       — tool name that produced the error
 *   • command_type     — git / test / build / lint / install / format / run / other
 *   • command_tool     — first token of the command (npm, git, pytest, …)
 *   • duration_bucket  — fast / medium / slow / timeout
 *
 * We populate them anyway, with sane defaults derived from message text
 * and tool name, so the dashboard renders symmetrically with seed.
 *
 * Hard constraints:
 *   1. Pure functions — no I/O, no globals, no module state.
 *   2. `error_category` MUST match seed's `pickErrorClassification`
 *      output exactly. The literal union below is the ABI.
 *   3. No external dependencies; TypeScript stdlib only.
 *   4. Robust to null / undefined / empty / malformed input.
 */
export type ErrorCategory = "file_not_found" | "command_not_found" | "edit_match_failed" | "test_failed" | "syntax_error" | "runtime_error" | "permission_denied" | "git_conflict" | "timeout" | "unknown";
export type CommandType = "test" | "build" | "lint" | "git" | "install" | "format" | "run" | "other";
export type DurationBucket = "fast" | "medium" | "slow" | "timeout";
export interface ErrorClassification {
    error_category: ErrorCategory;
    error_tool: string;
}
export interface CommandClassification {
    command_type: CommandType;
    command_tool: string;
}
/**
 * Classify an error message + tool name into one of seed's 10 categories.
 *
 * Patterns (ordered most-specific → least-specific so the first match
 * wins). Rationale for each pattern is inline.
 *
 *  • file_not_found   — Node's ENOENT, Python's FileNotFoundError, and
 *                       Claude's "Cannot find module" all signal a
 *                       missing file/path.
 *  • command_not_found — POSIX shells emit "command not found" (exit 127)
 *                       and "bash: <bin>: not found"; npx prints similar.
 *  • edit_match_failed — Claude's Edit tool prints "old_string not found"
 *                       or "matches multiple locations" when the patch
 *                       context is stale.
 *  • test_failed      — vitest/jest/pytest format `FAIL ` prefix; npm
 *                       prints "Test failed".
 *  • syntax_error     — SyntaxError (JS/TS), tsc TS-codes, or Python's
 *                       SyntaxError header.
 *  • runtime_error    — TypeError/ReferenceError/RangeError (uncaught).
 *  • permission_denied — EACCES / "permission denied" from fs or sudo.
 *  • git_conflict     — git's "CONFLICT" header on rebase/merge, plus
 *                       "Merge conflict in".
 *  • timeout          — explicit "timeout"/"timed out"/"ETIMEDOUT".
 *  • unknown          — fallthrough; never throws.
 */
export declare function classifyError(message: unknown, toolName: unknown): ErrorClassification;
/**
 * Classify a Bash command into a workflow bucket. The bucket is derived
 * from the (tool, sub-verb) pair: `npm test` → test, `npm run build` →
 * build, `git commit` → git, `pip install` → install, etc.
 *
 * Heuristic ordering — most-specific verb checks first; falls through to
 * `run` for generic execution and `other` for anything we can't classify.
 */
export declare function classifyCommand(command: unknown): CommandClassification;
/**
 * Bucketise a latency_ms reading into the four fixed buckets the
 * dashboard renders. Bucket edges (in ms):
 *
 *    fast    : [0,     1_000)
 *    medium  : [1_000, 10_000)
 *    slow    : [10_000, 60_000)
 *    timeout : [60_000, ∞)
 *
 * Defensive: negative and non-numeric inputs collapse to `fast` (the
 * neutral bucket) rather than throwing, because hooks have been seen
 * to emit `null` for very short calls.
 */
export declare function bucketizeDuration(latencyMs: unknown): DurationBucket;
