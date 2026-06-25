export type PermissionDecision = "allow" | "deny" | "ask";
export interface SecurityPolicy {
    allow: string[];
    deny: string[];
    ask: string[];
}
/**
 * Extract the glob from a Bash permission pattern.
 * "Bash(sudo *)" returns "sudo *", "Read(.env)" returns null.
 */
export declare function parseBashPattern(pattern: string): string | null;
/**
 * Parse any tool permission pattern like "ToolName(glob)".
 * Returns { tool, glob } or null if not a valid pattern.
 */
export declare function parseToolPattern(pattern: string): {
    tool: string;
    glob: string;
} | null;
/**
 * Convert a Bash permission glob to a regex.
 *
 * Two formats:
 * - Colon: "tree:*" becomes /^tree(\s.*)?$/ (command with optional args)
 * - Space: "sudo *" becomes /^sudo .*$/  (literal glob match)
 */
export declare function globToRegex(glob: string, caseInsensitive?: boolean): RegExp;
/**
 * Convert a file path glob to a regex.
 *
 * Unlike `globToRegex` (which handles command patterns with colon and
 * space semantics), this handles file path globs where:
 * - `**` matches any number of path segments (including zero)
 * - `*` matches anything except path separators
 * - Paths are matched with forward slashes (callers normalize first)
 */
export declare function fileGlobToRegex(glob: string, caseInsensitive?: boolean): RegExp;
/**
 * Check if a command matches any Bash pattern in the list.
 * Returns the matching pattern string, or null.
 */
export declare function matchesAnyPattern(command: string, patterns: string[], caseInsensitive?: boolean): string | null;
/**
 * Split a shell command on chain operators (&&, ||, ;, |) while
 * respecting single/double quotes and backticks.
 *
 * "echo hello && sudo rm -rf /" → ["echo hello", "sudo rm -rf /"]
 *
 * This prevents bypassing deny patterns by prepending innocent commands.
 */
export declare function splitChainedCommands(command: string): string[];
/**
 * Read Bash permission policies from up to 3 settings files.
 *
 * Returns policies in precedence order (most local first):
 *   1. .claude/settings.local.json  (project-local)
 *   2. .claude/settings.json        (project-shared)
 *   3. ~/.claude/settings.json      (global)
 *
 * Missing or invalid files are silently skipped.
 */
export declare function readBashPolicies(projectDir?: string, globalSettingsPath?: string): SecurityPolicy[];
/**
 * Read deny patterns for a specific tool from settings files.
 *
 * Reads the same 3-tier settings as `readBashPolicies`, but extracts
 * only deny globs for the given tool. Used for Read and Grep enforcement
 * — checks if file paths should be blocked by deny patterns.
 *
 * Returns an array of arrays (one per settings file, in precedence order).
 * Each inner array contains the extracted glob strings.
 */
export declare function readToolDenyPatterns(toolName: string, projectDir?: string, globalSettingsPath?: string): string[][];
interface CommandDecision {
    decision: PermissionDecision;
    matchedPattern?: string;
}
/**
 * Evaluate a command against policies in precedence order.
 *
 * Splits chained commands (&&, ||, ;, |) and checks each segment
 * against deny patterns — prevents bypassing deny by prepending
 * innocent commands like "echo ok && sudo rm -rf /".
 *
 * Within each policy: deny > ask > allow (most restrictive wins).
 * First definitive match across policies wins.
 * Default (no match in any policy): "ask".
 */
export declare function evaluateCommand(command: string, policies: SecurityPolicy[], caseInsensitive?: boolean): CommandDecision;
/**
 * Server-side variant: only enforce deny patterns.
 *
 * The server has no UI for "ask" prompts, so allow/ask patterns are
 * irrelevant. Returns "deny" if any deny pattern matches, otherwise "allow".
 *
 * Also splits chained commands to prevent bypass.
 */
export declare function evaluateCommandDenyOnly(command: string, policies: SecurityPolicy[], caseInsensitive?: boolean): {
    decision: "deny" | "allow";
    matchedPattern?: string;
};
/**
 * Check if a file path should be denied based on deny globs.
 *
 * Normalizes backslashes to forward slashes before matching so that
 * Windows paths work with Unix-style glob patterns.
 *
 * When `projectRoot` is supplied, the path is also matched in its
 * fully-resolved absolute form **and** — when the file exists — in
 * its canonical form (`fs.realpathSync`). This prevents two classes
 * of bypass:
 *
 *   1. `..` traversal: a relative path like `../../.ssh/id_rsa` no
 *      longer evades absolute-path deny rules.
 *   2. Symlink escape: a project-local path whose realpath points
 *      outside the project (e.g. `safe.log -> ~/.ssh/id_rsa`) no
 *      longer evades absolute-path deny rules.
 *
 * realpath is best-effort: if the file does not exist yet (ENOENT)
 * or the syscall fails for any reason, the lexical resolved form is
 * still checked. This keeps the function usable for paths that will
 * be created during execution.
 */
export declare function evaluateFilePath(filePath: string, denyGlobs: string[][], caseInsensitive?: boolean, projectRoot?: string): {
    denied: boolean;
    matchedPattern?: string;
};
/**
 * Scan non-shell code for shell-escape calls and extract the embedded
 * command strings.
 *
 * Returns an array of command strings found in the code. For unknown
 * languages or code without shell-escape calls, returns an empty array.
 */
export declare function extractShellCommands(code: string, language: string): string[];
export {};
