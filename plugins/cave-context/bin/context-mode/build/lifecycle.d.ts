/**
 * lifecycle — Process lifecycle guard for MCP server.
 *
 * Detects parent process death (ppid polling) and OS signals to prevent
 * orphaned MCP server processes consuming 100% CPU (issue #103).
 *
 * Stdin close is NOT used as a *standalone* shutdown signal — the MCP stdio
 * transport owns stdin and transient pipe events cause spurious -32000
 * errors (#236). We do, however, treat stdin EOF as a hint to re-run the
 * parent-liveness probe immediately (instead of waiting up to 30 s for the
 * next poll tick), which closes the multi-day CPU-spin window seen in
 * #311/#388 without reintroducing the false-positive shutdowns of #236.
 *
 * Cross-platform: macOS, Linux, Windows.
 */
export interface LifecycleGuardOptions {
    /** Interval in ms to check parent liveness. Default: 30_000 */
    checkIntervalMs?: number;
    /** Called when parent death or OS signal is detected. */
    onShutdown: () => void;
    /** Injectable parent-alive check (for testing). Default: ppid-based check. */
    isParentAlive?: () => boolean;
}
/** Injectable dependencies for {@link makeDefaultIsParentAlive}. */
export interface IsParentAliveDeps {
    /** Read the current ppid. Default: `() => process.ppid`. */
    getPpid?: () => number;
    /** Read the grandparent ppid. Default: ps-based POSIX probe, NaN on Windows. */
    readGrandparentPpid?: () => number;
}
/**
 * Build a parent-liveness check that handles the npm-exec wrapper case (#311).
 *
 * A plain ppid comparison misses Claude Code sessions launched via
 * `start.mjs → npm exec → context-mode server`: when Claude Code dies,
 * `start.mjs` reparents to init but `npm exec` stays alive, so the server's
 * direct ppid never changes. We additionally check whether the grandparent
 * process has been reparented to init (PID 1). When the original grandparent
 * was already 1 (daemonized startup) the check is skipped, and on Windows
 * where there's no cheap `ps` equivalent we also skip — so this change is
 * strictly additive to the previous behavior.
 *
 * Exported for unit-testing with injected readers. Production code uses
 * {@link defaultIsParentAlive} (captured once at module load).
 */
export declare function makeDefaultIsParentAlive(deps?: IsParentAliveDeps): () => boolean;
/**
 * Resolve the parent-liveness poll interval based on context (#534).
 *
 * When this process is the MCP bridge child spawned by the Pi adapter
 * (`bootstrapMCPTools` in `src/adapters/pi/mcp-bridge.ts` sets
 * `CONTEXT_MODE_BRIDGE_DEPTH=1` in the child env), we tighten the poll to
 * 1 s. The Pi parent can disappear in under 50 ms (`pi --help` prints
 * usage and returns), so the default 30 s window leaves a long-lived
 * CPU-spinning orphan. For top-level MCP servers (depth 0 / absent) we
 * keep the original 30 s cadence — the existing #311/#388 ppid + stdin
 * recovery paths already cover Claude Code style hosts.
 *
 * Exported for unit-testing.
 */
export declare function lifecycleGuardIntervalForEnv(env?: NodeJS.ProcessEnv): number;
/**
 * Start the lifecycle guard. Returns a cleanup function.
 * Skipped automatically when stdin is a TTY (e.g. OpenCode ts-plugin).
 */
export declare function startLifecycleGuard(opts: LifecycleGuardOptions): () => void;
