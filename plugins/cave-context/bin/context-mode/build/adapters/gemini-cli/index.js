/**
 * adapters/gemini-cli — Gemini CLI platform adapter.
 *
 * Implements HookAdapter for Gemini CLI's JSON stdin/stdout hook paradigm.
 *
 * Gemini CLI hook specifics:
 *   - I/O: JSON on stdin, JSON on stdout (same paradigm as Claude Code)
 *   - Hook names: BeforeTool, AfterTool, PreCompress, SessionStart
 *   - Arg modification: `hookSpecificOutput.tool_input` (merged with original)
 *   - Blocking: `decision: "deny"` in response (NOT permissionDecision)
 *   - Output modification: `decision: "deny"` + reason replaces output,
 *     `hookSpecificOutput.additionalContext` appends
 *   - PreCompress: advisory only (async, cannot block)
 *   - No `decision: "ask"` support
 *   - Hooks don't fire for subagents yet
 *   - Config: ~/.gemini/settings.json (user), .gemini/settings.json (project)
 *   - Session ID: session_id field
 *   - Project dir env: GEMINI_PROJECT_DIR (also CLAUDE_PROJECT_DIR alias)
 *   - Session dir: ~/.gemini/context-mode/sessions/
 */
import { readFileSync, writeFileSync, mkdirSync, accessSync, chmodSync, existsSync, constants, } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { BaseAdapter } from "../base.js";
// ─────────────────────────────────────────────────────────
// Hook constants (re-exported from hooks.ts)
// ─────────────────────────────────────────────────────────
import { HOOK_TYPES as GEMINI_HOOK_NAMES, HOOK_SCRIPTS as GEMINI_HOOK_SCRIPTS, buildHookCommand as buildGeminiHookCommand, EXTERNAL_MCP_MATCHER_PATTERN, } from "./hooks.js";
// ─────────────────────────────────────────────────────────
// Adapter implementation
// ─────────────────────────────────────────────────────────
export class GeminiCLIAdapter extends BaseAdapter {
    constructor() {
        super([".gemini"]);
    }
    name = "Gemini CLI";
    paradigm = "json-stdio";
    capabilities = {
        preToolUse: true,
        postToolUse: true,
        preCompact: true,
        sessionStart: true,
        canModifyArgs: true,
        canModifyOutput: true,
        canInjectSessionContext: true,
    };
    // ── Input parsing ──────────────────────────────────────
    parsePreToolUseInput(raw) {
        const input = raw;
        return {
            toolName: input.tool_name ?? "",
            toolInput: input.tool_input ?? {},
            sessionId: this.extractSessionId(input),
            projectDir: this.getProjectDir(input),
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
            projectDir: this.getProjectDir(input),
            raw,
        };
    }
    parsePreCompactInput(raw) {
        const input = raw;
        return {
            sessionId: this.extractSessionId(input),
            projectDir: this.getProjectDir(input),
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
            projectDir: this.getProjectDir(input),
            raw,
        };
    }
    // ── Response formatting ────────────────────────────────
    formatPreToolUseResponse(response) {
        if (response.decision === "deny") {
            return {
                decision: "deny",
                reason: response.reason ?? "Blocked by context-mode hook",
            };
        }
        if (response.decision === "modify" && response.updatedInput) {
            return {
                hookSpecificOutput: {
                    tool_input: response.updatedInput,
                },
            };
        }
        if (response.decision === "context" && response.additionalContext) {
            // Gemini CLI: inject additionalContext via hookSpecificOutput
            return {
                hookSpecificOutput: {
                    additionalContext: response.additionalContext,
                },
            };
        }
        if (response.decision === "ask") {
            // Gemini CLI: no native "ask" — deny to be safe
            return {
                decision: "deny",
                reason: response.reason ?? "Action requires user confirmation (security policy)",
            };
        }
        // "allow" — return undefined for passthrough
        return undefined;
    }
    formatPostToolUseResponse(response) {
        if (response.updatedOutput) {
            // Gemini CLI: decision "deny" + reason replaces output
            return {
                decision: "deny",
                reason: response.updatedOutput,
            };
        }
        if (response.additionalContext) {
            return {
                hookSpecificOutput: {
                    additionalContext: response.additionalContext,
                },
            };
        }
        return undefined;
    }
    formatPreCompactResponse(response) {
        // PreCompress is advisory only (async), but we can still return context
        return response.context ?? "";
    }
    formatSessionStartResponse(response) {
        return response.context ?? "";
    }
    // ── Configuration ──────────────────────────────────────
    getSettingsPath() {
        return resolve(homedir(), ".gemini", "settings.json");
    }
    getInstructionFiles() {
        return ["GEMINI.md"];
    }
    generateHookConfig(pluginRoot) {
        return {
            [GEMINI_HOOK_NAMES.BEFORE_AGENT]: [
                {
                    matcher: "",
                    hooks: [
                        {
                            type: "command",
                            command: buildGeminiHookCommand(GEMINI_HOOK_NAMES.BEFORE_AGENT, pluginRoot),
                        },
                    ],
                },
            ],
            [GEMINI_HOOK_NAMES.BEFORE_TOOL]: [
                {
                    // Gemini native tools + context-mode own MCP (both canonical and Claude
                    // shim prefixes) + external MCP catch-all (#529).
                    matcher: `run_shell_command|read_file|read_many_files|grep_search|search_file_content|web_fetch|activate_skill|mcp__plugin_context-mode|mcp__context-mode|${EXTERNAL_MCP_MATCHER_PATTERN}`,
                    hooks: [
                        {
                            type: "command",
                            command: buildGeminiHookCommand(GEMINI_HOOK_NAMES.BEFORE_TOOL, pluginRoot),
                        },
                    ],
                },
            ],
            [GEMINI_HOOK_NAMES.AFTER_TOOL]: [
                {
                    matcher: "",
                    hooks: [
                        {
                            type: "command",
                            command: buildGeminiHookCommand(GEMINI_HOOK_NAMES.AFTER_TOOL, pluginRoot),
                        },
                    ],
                },
            ],
            [GEMINI_HOOK_NAMES.PRE_COMPRESS]: [
                {
                    matcher: "",
                    hooks: [
                        {
                            type: "command",
                            command: buildGeminiHookCommand(GEMINI_HOOK_NAMES.PRE_COMPRESS, pluginRoot),
                        },
                    ],
                },
            ],
            [GEMINI_HOOK_NAMES.SESSION_START]: [
                {
                    matcher: "",
                    hooks: [
                        {
                            type: "command",
                            command: buildGeminiHookCommand(GEMINI_HOOK_NAMES.SESSION_START, pluginRoot),
                        },
                    ],
                },
            ],
        };
    }
    readSettings() {
        try {
            const raw = readFileSync(this.getSettingsPath(), "utf-8");
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    writeSettings(settings) {
        const dir = resolve(homedir(), ".gemini");
        mkdirSync(dir, { recursive: true });
        writeFileSync(this.getSettingsPath(), JSON.stringify(settings, null, 2) + "\n", "utf-8");
    }
    // ── Diagnostics (doctor) ─────────────────────────────────
    validateHooks(pluginRoot) {
        const results = [];
        const settings = this.readSettings();
        if (!settings) {
            results.push({
                check: "BeforeTool hook",
                status: "fail",
                message: "Could not read ~/.gemini/settings.json",
                fix: "context-mode upgrade",
            });
            return results;
        }
        const hooks = settings.hooks;
        // Check BeforeTool
        const beforeTool = hooks?.[GEMINI_HOOK_NAMES.BEFORE_TOOL];
        if (beforeTool && beforeTool.length > 0) {
            const hasHook = beforeTool.some((entry) => entry.hooks?.some((h) => h.command?.includes("context-mode")));
            results.push({
                check: "BeforeTool hook",
                status: hasHook ? "pass" : "fail",
                message: hasHook
                    ? "BeforeTool hook configured"
                    : "BeforeTool exists but does not point to context-mode",
                fix: hasHook ? undefined : "context-mode upgrade",
            });
        }
        else {
            results.push({
                check: "BeforeTool hook",
                status: "fail",
                message: "No BeforeTool hooks found",
                fix: "context-mode upgrade",
            });
        }
        // Check SessionStart
        const sessionStart = hooks?.[GEMINI_HOOK_NAMES.SESSION_START];
        if (sessionStart && sessionStart.length > 0) {
            const hasHook = sessionStart.some((entry) => entry.hooks?.some((h) => h.command?.includes("context-mode")));
            results.push({
                check: "SessionStart hook",
                status: hasHook ? "pass" : "fail",
                message: hasHook
                    ? "SessionStart hook configured"
                    : "SessionStart exists but does not point to context-mode",
                fix: hasHook ? undefined : "context-mode upgrade",
            });
        }
        else {
            results.push({
                check: "SessionStart hook",
                status: "fail",
                message: "No SessionStart hooks found",
                fix: "context-mode upgrade",
            });
        }
        return results;
    }
    /**
     * Adapter-defined health checks (Algo-D1) — mirrors claude-code's override
     * at src/adapters/claude-code/index.ts:275.
     *
     * Issue #712 motivation: gemini-cli's hook scripts ship under
     * `<pluginRoot>/hooks/gemini-cli/<scriptName>` (see HOOK_MAP in
     * src/cli.ts and `setHookPermissions` in this file). The legacy doctor
     * path (`getHookScriptPaths` -> `extractHookScriptPath`) round-trips
     * through `buildHookCommand` -> command-string parsing, so a missing
     * platform subdir in the emit was invisible to the doctor until a user
     * installed globally and observed FAIL lines. This override drops the
     * round-trip: HOOK_SCRIPTS is the single source of truth and we probe
     * `existsSync(join(pluginRoot, "hooks", "gemini-cli", scriptName))`
     * directly, so a future regression in the command emit cannot make the
     * doctor lie about hook health.
     *
     * Adding a new hook event in HOOK_SCRIPTS auto-extends doctor coverage
     * here — no parallel hardcoded list to maintain.
     */
    getHealthChecks(pluginRoot) {
        return Object.entries(GEMINI_HOOK_SCRIPTS).map(([hookType, scriptName]) => {
            const absolutePath = join(pluginRoot, "hooks", "gemini-cli", scriptName);
            return {
                name: `Hook script: ${hookType} (${scriptName})`,
                check: () => {
                    if (existsSync(absolutePath)) {
                        return { status: "OK", detail: absolutePath };
                    }
                    return {
                        status: "FAIL",
                        detail: `not found at ${absolutePath}`,
                    };
                },
            };
        });
    }
    checkPluginRegistration() {
        const settings = this.readSettings();
        if (!settings) {
            return {
                check: "Plugin registration",
                status: "warn",
                message: "Could not read ~/.gemini/settings.json",
            };
        }
        // Check in extensions or settings for context-mode
        const extensions = settings.extensions;
        if (extensions) {
            const hasPlugin = Array.isArray(extensions)
                ? extensions.some((e) => typeof e === "string" && e.includes("context-mode"))
                : Object.keys(extensions).some((k) => k.includes("context-mode"));
            if (hasPlugin) {
                return {
                    check: "Plugin registration",
                    status: "pass",
                    message: "context-mode found in extensions",
                };
            }
        }
        return {
            check: "Plugin registration",
            status: "warn",
            message: "context-mode not found in extensions (might be using standalone MCP mode)",
        };
    }
    getInstalledVersion() {
        // Check ~/.gemini/ extension cache for context-mode
        try {
            const cachePath = resolve(homedir(), ".gemini", "extensions", "context-mode", "package.json");
            const pkg = JSON.parse(readFileSync(cachePath, "utf-8"));
            if (typeof pkg.version === "string")
                return pkg.version;
        }
        catch {
            /* not found */
        }
        return "not installed";
    }
    // ── Upgrade ────────────────────────────────────────────
    configureAllHooks(pluginRoot) {
        const settings = this.readSettings() ?? {};
        const hooks = (settings.hooks ?? {});
        const changes = [];
        const hookConfigs = [
            { name: GEMINI_HOOK_NAMES.BEFORE_AGENT },
            { name: GEMINI_HOOK_NAMES.BEFORE_TOOL },
            { name: GEMINI_HOOK_NAMES.SESSION_START },
        ];
        for (const config of hookConfigs) {
            const command = buildGeminiHookCommand(config.name, pluginRoot);
            const entry = {
                matcher: "",
                hooks: [{ type: "command", command }],
            };
            const existing = hooks[config.name];
            if (existing && Array.isArray(existing)) {
                const idx = existing.findIndex((e) => {
                    const entryHooks = e.hooks;
                    return entryHooks?.some((h) => h.command?.includes("context-mode"));
                });
                if (idx >= 0) {
                    existing[idx] = entry;
                    changes.push(`Updated existing ${config.name} hook entry`);
                }
                else {
                    existing.push(entry);
                    changes.push(`Added ${config.name} hook entry`);
                }
                hooks[config.name] = existing;
            }
            else {
                hooks[config.name] = [entry];
                changes.push(`Created ${config.name} hooks section`);
            }
        }
        settings.hooks = hooks;
        this.writeSettings(settings);
        return changes;
    }
    setHookPermissions(pluginRoot) {
        const set = [];
        const hooksDir = join(pluginRoot, "hooks", "gemini-cli");
        for (const scriptName of Object.values(GEMINI_HOOK_SCRIPTS)) {
            const scriptPath = resolve(hooksDir, scriptName);
            try {
                accessSync(scriptPath, constants.R_OK);
                chmodSync(scriptPath, 0o755);
                set.push(scriptPath);
            }
            catch {
                /* skip missing scripts */
            }
        }
        return set;
    }
    updatePluginRegistry(pluginRoot, version) {
        // Gemini CLI doesn't have a formal plugin registry like Claude Code.
        // Update the extension cache package.json if it exists.
        try {
            const pkgPath = resolve(homedir(), ".gemini", "extensions", "context-mode", "package.json");
            const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
            pkg.version = version;
            pkg.installPath = pluginRoot;
            pkg.lastUpdated = new Date().toISOString();
            writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
        }
        catch {
            /* best effort */
        }
    }
    // ── Internal helpers ───────────────────────────────────
    /**
     * Resolve the project directory for a Gemini CLI hook input.
     * Priority: input.cwd > GEMINI_PROJECT_DIR > CLAUDE_PROJECT_DIR > process.cwd().
     * Mirrors the cursor / opencode pattern so downstream hooks always
     * receive a defined projectDir even when the platform omits cwd
     * from the wire payload (e.g. under worktrees).
     */
    getProjectDir(input) {
        return (input.cwd
            ?? process.env.GEMINI_PROJECT_DIR
            ?? process.env.CLAUDE_PROJECT_DIR
            ?? process.cwd());
    }
    /**
     * Extract session ID from Gemini CLI hook input.
     * Priority: session_id field > env fallback > ppid fallback.
     */
    extractSessionId(input) {
        if (input.session_id)
            return input.session_id;
        return `pid-${process.ppid}`;
    }
}
