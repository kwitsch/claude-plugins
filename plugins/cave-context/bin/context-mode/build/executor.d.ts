import { type RuntimeMap, type Language } from "./runtime.js";
export type { ExecResult } from "./types.js";
import type { ExecResult } from "./types.js";
/** Pure helper — exported for unit testing. Returns "script" or "script.<ext>". */
export declare function buildScriptFilename(language: Language, platform: NodeJS.Platform, shellPath?: string | null): string;
/**
 * Pure helper — exported for unit testing. Adds `windowsHide: true` on Windows
 * to prevent the spawned shell from creating a visible console window that
 * intercepts stdout (issue #384).
 */
export declare function buildSpawnOptions(platform: NodeJS.Platform): {
    windowsHide: boolean;
};
/** Pure helper — exported for unit testing. Restores parent PATH after shell startup. */
export declare function buildShellScriptContent(code: string, inheritedPath: string | undefined, platform: NodeJS.Platform): string;
interface ExecuteOptions {
    language: Language;
    code: string;
    timeout?: number;
    /** Keep process running after timeout instead of killing it. */
    background?: boolean;
    /**
     * Issue #45 — per-call cwd override for the shell language. When set,
     * the shell script runs in this directory instead of `#projectRoot`.
     * Non-shell languages keep their tmpDir sandbox cwd regardless (the
     * script file lives there). Used by Codex MCP handlers to pin shell
     * commands to a resolved project root when the spawning host inherited
     * a non-project cwd (e.g. $HOME).
     */
    cwd?: string;
}
interface ExecuteFileOptions extends ExecuteOptions {
    path: string;
}
export declare class PolyglotExecutor {
    #private;
    constructor(opts?: {
        hardCapBytes?: number;
        projectRoot?: string | (() => string);
        runtimes?: RuntimeMap;
    });
    get runtimes(): RuntimeMap;
    /** Kill all backgrounded processes to prevent zombie/port-conflict issues. */
    cleanupBackgrounded(): void;
    execute(opts: ExecuteOptions): Promise<ExecResult>;
    executeFile(opts: ExecuteFileOptions): Promise<ExecResult>;
}
