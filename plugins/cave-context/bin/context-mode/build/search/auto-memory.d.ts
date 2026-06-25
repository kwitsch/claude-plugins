/**
 * Auto-memory search — searches CLAUDE.md / AGENTS.md / GEMINI.md / etc.
 * and the platform's persistent memory directory for decisions,
 * preferences, and context from prior sessions.
 *
 * Returns results in a format compatible with the unified search pipeline.
 */
export interface AutoMemoryResult {
    title: string;
    content: string;
    source: string;
    origin: "auto-memory";
    timestamp?: string;
}
/**
 * Minimal adapter contract used by searchAutoMemory.
 * Avoids depending on the full HookAdapter type to keep this module standalone.
 */
export interface AutoMemoryAdapter {
    getConfigDir(): string;
    getInstructionFiles(): string[];
    /**
     * `projectDir` is optional for backwards compatibility with legacy
     * callers — when supplied, adapters MUST return a project-scoped path
     * (see HookAdapter.getMemoryDir contract, issue #663).
     */
    getMemoryDir(projectDir?: string): string;
}
/**
 * Search auto-memory files for content matching any of the given queries.
 *
 * When `adapter` is provided, the per-platform conventions are used:
 *   1. Project-level: <projectDir>/<each instructionFile>
 *   2. User-level: <configDir>/<each instructionFile>
 *   3. Memory dir: <memoryDir>/*.md
 *
 * Without an adapter (legacy callers), defaults to Claude conventions
 * (CLAUDE.md + ~/.claude/memory) for backwards compatibility.
 *
 * @param queries  Array of search terms
 * @param limit    Max results to return
 * @param projectDir  Project directory path
 * @param configDir   Explicit config dir override (legacy callers)
 * @param adapter     Platform adapter — supplies instruction files + memory dir
 * @returns Matching auto-memory results
 */
export declare function searchAutoMemory(queries: string[], limit?: number, projectDir?: string, configDir?: string, adapter?: AutoMemoryAdapter): AutoMemoryResult[];
