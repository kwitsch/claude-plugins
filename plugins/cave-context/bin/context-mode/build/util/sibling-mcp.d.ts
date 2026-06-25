/**
 * sibling-mcp — discover & terminate previous-version MCP servers.
 *
 * Issue #559: `/ctx-upgrade` historically left the running MCP server
 * alive after copying new files in-place + updating npm global. The next
 * Claude Code launch spawned a fresh process from the new version, but
 * the old one kept its open stdio + DB handles. Across enough upgrades
 * users observed 5+ context-mode `start.mjs` processes pinned to RAM.
 *
 * This module provides two pure helpers:
 *
 *   1. `discoverSiblingMcpPids({ ownPid, ownPpid, platform, runCommand })`
 *      — enumerates node processes whose argv mentions the plugin
 *      `start.mjs` path under `~/.claude/plugins/{cache,marketplaces}/`.
 *      Excludes the caller's own pid + parent pid (Claude Code or the
 *      shell that spawned `/ctx-upgrade`). Cross-platform: POSIX uses
 *      `pgrep -f`, Windows uses PowerShell + Get-CimInstance.
 *
 *   2. `killSiblingMcpServers({ pids, ... })` — sends SIGTERM, polls
 *      liveness, escalates to SIGKILL after `timeoutMs` (default 1500
 *      ms) on stragglers. Returns a kill report so callers can surface
 *      a concise summary without leaking PIDs to user-facing logs.
 *
 * Both helpers accept dependency-injected `runCommand`, `isAlive`, and
 * `sendSignal` parameters so tests can exercise the full behavior tree
 * cross-platform without spawning real processes.
 */
/** Inject `child_process.execFileSync` for tests. Must return stdout as utf-8. */
export type RunCommand = (cmd: string, args: readonly string[]) => string;
/** Inject `process.kill(pid, 0)` for tests. */
export type IsAlive = (pid: number) => boolean;
/** Inject `process.kill(pid, signal)` for tests. */
export type SendSignal = (pid: number, signal: NodeJS.Signals) => void;
export interface DiscoverOptions {
    ownPid: number;
    ownPpid: number;
    /** `process.platform` injection. Defaults to live process.platform. */
    platform?: NodeJS.Platform;
    /** Test injection point — defaults to `child_process.execFileSync`. */
    runCommand?: RunCommand;
}
export interface KillOptions {
    pids: readonly number[];
    /** Time to wait for SIGTERM to take effect before escalating. */
    timeoutMs?: number;
    /** Poll interval while waiting for SIGTERM. */
    pollIntervalMs?: number;
    isAlive?: IsAlive;
    sendSignal?: SendSignal;
}
export interface KillReport {
    /** PIDs that died after SIGTERM within `timeoutMs`. */
    terminatedBySigterm: number;
    /** PIDs that required SIGKILL escalation. */
    terminatedBySigkill: number;
    /** Sum of the two — used by the cli summary line. */
    totalKilled: number;
}
/**
 * Enumerate node MCP-server processes spawned from this plugin's
 * start.mjs. Always returns an empty array on tool absence — never
 * throws — so an upgrade is never blocked by a missing pgrep/PowerShell.
 */
export declare function discoverSiblingMcpPids(opts: DiscoverOptions): number[];
/**
 * Send SIGTERM to each PID, then poll for liveness. PIDs still alive
 * after `timeoutMs` receive SIGKILL. Returns a per-signal report.
 *
 * Algorithm:
 *   1. Fire SIGTERM at every pid (swallow ESRCH — already dead).
 *   2. Poll every `pollIntervalMs` until either all pids are dead
 *      OR `timeoutMs` elapses.
 *   3. For survivors: SIGKILL (swallow ESRCH).
 *   4. Count via "died-while-we-watched": only PIDs that were observed
 *      alive at any point and then died are reported. PIDs that were
 *      already dead before SIGTERM (ESRCH on first send) are not
 *      counted — they were not ours to kill.
 */
export declare function killSiblingMcpServers(opts: KillOptions): Promise<KillReport>;
