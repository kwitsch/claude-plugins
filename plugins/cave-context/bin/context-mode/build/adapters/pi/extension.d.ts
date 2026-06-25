/**
 * Pi coding agent extension for context-mode.
 *
 * Follows the OpenClaw adapter pattern: imports shared session modules,
 * registers Pi-specific hooks. NO copy-paste of session logic.
 * NO external npm dependencies beyond what Pi runtime provides.
 *
 * Entry point: `export default function(pi: ExtensionAPI) { ... }`
 *
 * Lifecycle: session_start, tool_call, tool_result, before_agent_start,
 * session_before_compact, session_compact, session_shutdown.
 */
/**
 * Strip heredoc + single-quoted + double-quoted content from a shell command
 * so the routing regex only sees command tokens, not user-provided strings.
 *
 * Mirrors hooks/core/routing.mjs:196–209. Inlined here because the Pi
 * extension is bundled as a standalone build artifact (.pi/extensions/...)
 * and cannot import hooks/core/* at runtime — they live in a sibling tree
 * and may not be present in every Pi installation.
 *
 * Exported for unit tests.
 */
export declare function stripQuotedContent(cmd: string): string;
/**
 * Returns true iff `segment` is a curl/wget invocation that is SAFE to allow
 * through the Pi routing block — i.e. it cannot flood the model's context
 * window because the response body is written to disk (or appended to a file)
 * and no verbose/trace flag is dumping headers to stderr.
 *
 * Mirrors hooks/core/routing.mjs:672–701. Segments that are NOT curl/wget
 * return `true` (nothing to evaluate). The caller is expected to split chained
 * commands on `&&`, `||`, `;` and call this per segment.
 *
 * Issue #625 — without this, the only escape hatch when the MCP bridge dies
 * is `gh` CLI or a full Pi restart. Neither is acceptable as baseline UX.
 *
 * Exported for unit tests.
 */
export declare function isSafeCurlWget(segment: string): boolean;
/**
 * Settles when the MCP bridge bootstrap has finished — resolves on
 * success AND on failure (the bootstrap is best-effort; failures are
 * logged to stderr but never propagated). Exposed for tests so they
 * can `await` the wiring deterministically without relying on internal
 * timing or `setImmediate` polling.
 *
 * Reset to a fresh promise on every `piExtension(pi)` call so repeated
 * registrations in one test process don't see a stale resolution from
 * a prior load.
 */
export declare let _mcpBridgeReady: Promise<void>;
/**
 * Returns true iff `argv` matches a Pi top-level short-circuit invocation
 * (help or version). Only argv[0] is inspected — Pi's runCli only checks
 * the first token, and subcommand-level `--help` (e.g. `pi stats --help`)
 * still spins up a real session, so we must NOT skip bootstrap there.
 *
 * Exported for unit tests.
 */
export declare function isPiShortCircuitArgv(argv: readonly string[]): boolean;
/**
 * Issue #545 — Pi workspace resolver.
 *
 * Pi's runtime sets PI_CONFIG_DIR to ~/.pi (its CONFIG dir, not the user's
 * project). The extension previously used this as the project anchor, which
 * meant every Pi session re-rooted under ~/.pi — collapsing all of a user's
 * projects into a single phantom workspace. This helper picks the user's
 * actual project directory while NEVER returning a path equal to or under
 * ~/.pi/.
 *
 * Cascade:
 *   1. PI_WORKSPACE_DIR — set by Pi's bridge (extension-set, freshest)
 *   2. PI_PROJECT_DIR   — legacy/user override
 *   3. PWD              — shell-set, survives process.chdir
 *   4. cwd              — last resort
 *
 * Each candidate is rejected if it equals ~/.pi or lives under ~/.pi/. If
 * every candidate is poisoned, falls back to homedir() as a safe non-config
 * anchor — caller may still render a "no project context" notice but the
 * function stays total.
 */
export declare function resolvePiWorkspaceDir(opts: {
    env: Record<string, string | undefined>;
    pwd: string | undefined;
    cwd: string;
    /** Optional override for tests; defaults to `os.homedir()`. */
    home?: string;
}): string;
/** Pi extension default export. Called once by Pi runtime with the extension API. */
export default function piExtension(pi: any): void;
