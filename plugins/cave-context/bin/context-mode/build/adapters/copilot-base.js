/**
 * CopilotBaseAdapter — shared implementation for VS Code Copilot and JetBrains Copilot.
 *
 * Both platforms share the SAME Copilot agent runtime:
 *   - hookSpecificOutput wrapper with hookEventName
 *   - Same hook events (PreToolUse, PostToolUse, PreCompact, SessionStart)
 *   - Same .github/hooks/ config location
 *   - Same configureHooks logic
 *   - Same generateHookConfig format
 *   - Same parse/format methods
 *
 * Platform-specific differences handled by subclasses:
 *   - extractSessionId() — different env var fallbacks
 *   - getProjectDir() — different env vars for project root
 *   - getSessionDir() — different default session directories
 *   - checkPluginRegistration() — VS Code reads .vscode/mcp.json, JetBrains uses IDE UI
 *   - getInstalledVersion() — VS Code checks extensions dir, JetBrains checks hook config
 *   - validateHooks() — different warning messages
 */
import { readFileSync, writeFileSync, mkdirSync, accessSync, chmodSync, constants, } from "node:fs";
import { resolve, join } from "node:path";
import { BaseAdapter } from "./base.js";
// ─────────────────────────────────────────────────────────
// Abstract base adapter for Copilot platforms
// ─────────────────────────────────────────────────────────
export class CopilotBaseAdapter extends BaseAdapter {
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
    // ── Input parsing (shared) ─────────────────────────────
    parsePreToolUseInput(raw) {
        const input = raw;
        return {
            toolName: input.tool_name ?? "",
            toolInput: input.tool_input ?? {},
            sessionId: this.extractSessionId(input),
            projectDir: this.getProjectDir(),
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
            projectDir: this.getProjectDir(),
            raw,
        };
    }
    parsePreCompactInput(raw) {
        const input = raw;
        return {
            sessionId: this.extractSessionId(input),
            projectDir: this.getProjectDir(),
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
            projectDir: this.getProjectDir(),
            raw,
        };
    }
    // ── Response formatting (shared) ───────────────────────
    formatPreToolUseResponse(response) {
        if (response.decision === "deny") {
            return {
                permissionDecision: "deny",
                reason: response.reason ?? "Blocked by context-mode hook",
            };
        }
        if (response.decision === "modify" && response.updatedInput) {
            return {
                hookSpecificOutput: {
                    hookEventName: this.hookModule.HOOK_TYPES.PRE_TOOL_USE,
                    updatedInput: response.updatedInput,
                },
            };
        }
        if (response.decision === "context" && response.additionalContext) {
            return {
                hookSpecificOutput: {
                    hookEventName: this.hookModule.HOOK_TYPES.PRE_TOOL_USE,
                    additionalContext: response.additionalContext,
                },
            };
        }
        if (response.decision === "ask") {
            return {
                permissionDecision: "deny",
                reason: response.reason ?? "Action requires user confirmation (security policy)",
            };
        }
        // "allow" — return undefined for passthrough
        return undefined;
    }
    formatPostToolUseResponse(response) {
        if (response.updatedOutput) {
            return {
                hookSpecificOutput: {
                    hookEventName: this.hookModule.HOOK_TYPES.POST_TOOL_USE,
                    decision: "block",
                    reason: response.updatedOutput,
                },
            };
        }
        if (response.additionalContext) {
            return {
                hookSpecificOutput: {
                    hookEventName: this.hookModule.HOOK_TYPES.POST_TOOL_USE,
                    additionalContext: response.additionalContext,
                },
            };
        }
        return undefined;
    }
    formatPreCompactResponse(response) {
        return response.context ?? "";
    }
    formatSessionStartResponse(response) {
        return response.context ?? "";
    }
    // ── Configuration (shared) ─────────────────────────────
    /**
     * Resolve the absolute path to the Copilot-style hook settings file.
     *
     * Issue #539 fix: previously this returned `resolve(".github", ...)`
     * — a CWD-relative path. `doctor` (validateHooks) and `upgrade`
     * (configureAllHooks) could legitimately run from different working
     * directories (CLI invoked from a subdir, MCP server cwd=projectDir),
     * so each saw a DIFFERENT settings path and the diagnose/repair loop
     * never converged on the same file.
     *
     * Now anchors on `projectDir` when supplied (matching the sibling
     * `getConfigDir(projectDir?: string)` signature in
     * vscode-copilot/index.ts:93). Falls back to `process.cwd()` to keep
     * existing callers source-compatible — the slice-5 follow-up will
     * thread projectDir through `cli.ts doctor`/`upgrade`.
     */
    getSettingsPath(projectDir) {
        return resolve(projectDir ?? process.cwd(), ".github", "hooks", "context-mode.json");
    }
    generateHookConfig(pluginRoot) {
        const { HOOK_TYPES, buildHookCommand } = this.hookModule;
        return {
            [HOOK_TYPES.PRE_TOOL_USE]: [
                {
                    matcher: "",
                    hooks: [
                        {
                            type: "command",
                            command: buildHookCommand(HOOK_TYPES.PRE_TOOL_USE, pluginRoot),
                        },
                    ],
                },
            ],
            [HOOK_TYPES.POST_TOOL_USE]: [
                {
                    matcher: "",
                    hooks: [
                        {
                            type: "command",
                            command: buildHookCommand(HOOK_TYPES.POST_TOOL_USE, pluginRoot),
                        },
                    ],
                },
            ],
            [HOOK_TYPES.PRE_COMPACT]: [
                {
                    matcher: "",
                    hooks: [
                        {
                            type: "command",
                            command: buildHookCommand(HOOK_TYPES.PRE_COMPACT, pluginRoot),
                        },
                    ],
                },
            ],
            [HOOK_TYPES.SESSION_START]: [
                {
                    matcher: "",
                    hooks: [
                        {
                            type: "command",
                            command: buildHookCommand(HOOK_TYPES.SESSION_START, pluginRoot),
                        },
                    ],
                },
            ],
        };
    }
    readSettings() {
        // Primary: .github/hooks/context-mode.json
        try {
            const raw = readFileSync(this.getSettingsPath(), "utf-8");
            return JSON.parse(raw);
        }
        catch {
            /* fall through */
        }
        // Fallback: .claude/settings.json
        try {
            const raw = readFileSync(resolve(".claude", "settings.json"), "utf-8");
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    writeSettings(settings) {
        const configPath = this.getSettingsPath();
        mkdirSync(resolve(".github", "hooks"), { recursive: true });
        writeFileSync(configPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
    }
    // ── Upgrade (shared) ──────────────────────────────────
    configureAllHooks(pluginRoot) {
        const changes = [];
        const settings = this.readSettings() ?? {};
        const hooks = settings.hooks ?? {};
        const { HOOK_TYPES, HOOK_SCRIPTS, buildHookCommand } = this.hookModule;
        const hookTypes = [
            HOOK_TYPES.PRE_TOOL_USE,
            HOOK_TYPES.POST_TOOL_USE,
            HOOK_TYPES.PRE_COMPACT,
            HOOK_TYPES.SESSION_START,
        ];
        for (const hookType of hookTypes) {
            const script = HOOK_SCRIPTS[hookType];
            if (!script)
                continue;
            hooks[hookType] = [
                {
                    matcher: "",
                    hooks: [
                        {
                            type: "command",
                            command: buildHookCommand(hookType, pluginRoot),
                        },
                    ],
                },
            ];
            changes.push(`Configured ${hookType} hook`);
        }
        settings.hooks = hooks;
        this.writeSettings(settings);
        changes.push(`Wrote hook config to ${this.getSettingsPath()}`);
        return changes;
    }
    setHookPermissions(pluginRoot) {
        const set = [];
        const hooksDir = join(pluginRoot, "hooks", this.hookSubdir);
        for (const scriptName of Object.values(this.hookModule.HOOK_SCRIPTS)) {
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
    updatePluginRegistry(_pluginRoot, _version) {
        // Copilot platforms manage plugins through their own marketplaces.
        // No manual registry update needed.
    }
}
