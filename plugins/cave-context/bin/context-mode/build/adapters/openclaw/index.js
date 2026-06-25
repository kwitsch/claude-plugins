/**
 * adapters/openclaw — OpenClaw platform adapter.
 *
 * Implements HookAdapter for OpenClaw's TypeScript plugin paradigm.
 *
 * OpenClaw hook specifics:
 *   - I/O: TS plugin functions via api.registerHook() and api.on()
 *   - Hook events: tool_call:before, tool_call:after, command:new
 *   - Lifecycle: before_prompt_build (routing instruction injection)
 *   - Context engine: api.registerContextEngine() with ownsCompaction
 *   - Arg modification: mutate event.params in tool_call:before
 *   - Blocking: return { block: true, blockReason } from tool_call:before
 *   - Session ID: event context (no specific env var)
 *   - Project dir: process.cwd()
 *   - Config: openclaw.json plugins.entries, ~/.openclaw/extensions/
 *   - Session dir: ~/.openclaw/context-mode/sessions/
 */
import { readFileSync, writeFileSync, copyFileSync, accessSync, constants, } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { BaseAdapter } from "../base.js";
// ─────────────────────────────────────────────────────────
// Hook constants (re-exported from hooks.ts)
// ─────────────────────────────────────────────────────────
import { HOOK_EVENTS as OPENCLAW_HOOK_EVENTS } from "./hooks.js";
// ─────────────────────────────────────────────────────────
// Adapter implementation
// ─────────────────────────────────────────────────────────
export class OpenClawAdapter extends BaseAdapter {
    constructor() {
        super([".openclaw"]);
    }
    name = "OpenClaw";
    paradigm = "ts-plugin";
    capabilities = {
        preToolUse: true,
        postToolUse: true,
        preCompact: true, // via registerContextEngine with ownsCompaction
        sessionStart: true, // via command:new hook
        canModifyArgs: true,
        canModifyOutput: false,
        canInjectSessionContext: true, // via before_prompt_build lifecycle hook
    };
    // ── Input parsing ──────────────────────────────────────
    parsePreToolUseInput(raw) {
        const input = raw;
        return {
            toolName: input.toolName ?? input.tool_name ?? "",
            toolInput: input.params ?? input.tool_input ?? {},
            sessionId: this.extractSessionId(input),
            projectDir: this.getProjectDir(input),
            raw,
        };
    }
    parsePostToolUseInput(raw) {
        const input = raw;
        return {
            toolName: input.toolName ?? input.tool_name ?? "",
            toolInput: input.params ?? input.tool_input ?? {},
            toolOutput: input.output ?? input.tool_output,
            isError: input.isError ?? input.is_error,
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
            // OpenClaw plugin paradigm: return { block, blockReason } to block
            return {
                block: true,
                blockReason: response.reason ?? "Blocked by context-mode hook",
            };
        }
        if (response.decision === "modify" && response.updatedInput) {
            // OpenClaw: mutate params in the event object
            return { params: response.updatedInput };
        }
        if (response.decision === "ask") {
            // OpenClaw: block for safety when user confirmation needed
            return {
                block: true,
                blockReason: response.reason ?? "Action requires user confirmation (security policy)",
            };
        }
        if (response.decision === "context" && response.additionalContext) {
            // OpenClaw supports context injection via before_prompt_build,
            // but not inline in tool_call:before. Passthrough.
            return undefined;
        }
        // "allow" — passthrough
        return undefined;
    }
    formatPostToolUseResponse(response) {
        const result = {};
        if (response.additionalContext) {
            result.additionalContext = response.additionalContext;
        }
        return Object.keys(result).length > 0 ? result : undefined;
    }
    formatPreCompactResponse(response) {
        // Context engine compact() returns { ok, compacted } — context is managed internally
        return response.context ?? "";
    }
    formatSessionStartResponse(response) {
        return response.context ?? "";
    }
    // ── Configuration ──────────────────────────────────────
    getSettingsPath() {
        // OpenClaw uses openclaw.json in the project root or ~/.openclaw/openclaw.json
        return resolve("openclaw.json");
    }
    /**
     * OpenClaw stores everything in the project root — no separate config
     * dir. Returned as the absolute project directory itself per the
     * HookAdapter.getConfigDir contract (always-absolute).
     */
    getConfigDir(projectDir) {
        return resolve(projectDir ?? process.cwd());
    }
    getInstructionFiles() {
        return ["AGENTS.md"];
    }
    /**
     * Absolute <projectRoot>/memory directory.
     *
     * OpenClaw's `getConfigDir(projectDir)` already returns the project root,
     * so the memory dir is naturally project-scoped per the OpenClaw
     * convention. The `projectDir` parameter is honored for explicit
     * resolution; without it, falls back to the implicit `process.cwd()`
     * inside `getConfigDir`. Either way, two projects never share a path
     * — no hash suffix needed (issue #663).
     */
    getMemoryDir(projectDir) {
        return join(this.getConfigDir(projectDir), "memory");
    }
    generateHookConfig(_pluginRoot) {
        // OpenClaw uses TS plugin paradigm — hooks are registered via
        // api.registerHook() in the plugin entry point, not via config files.
        // Return the hook name mapping for documentation purposes.
        return {
            [OPENCLAW_HOOK_EVENTS.TOOL_CALL_BEFORE]: [
                {
                    matcher: "",
                    hooks: [
                        {
                            type: "plugin",
                            command: "context-mode",
                        },
                    ],
                },
            ],
            [OPENCLAW_HOOK_EVENTS.TOOL_CALL_AFTER]: [
                {
                    matcher: "",
                    hooks: [
                        {
                            type: "plugin",
                            command: "context-mode",
                        },
                    ],
                },
            ],
            [OPENCLAW_HOOK_EVENTS.COMMAND_NEW]: [
                {
                    matcher: "",
                    hooks: [
                        {
                            type: "plugin",
                            command: "context-mode",
                        },
                    ],
                },
            ],
        };
    }
    readSettings() {
        // Try project-local paths first, then global config
        const paths = [
            resolve("openclaw.json"),
            resolve(".openclaw", "openclaw.json"),
            join(homedir(), ".openclaw", "openclaw.json"),
        ];
        for (const configPath of paths) {
            try {
                const raw = readFileSync(configPath, "utf-8");
                return JSON.parse(raw);
            }
            catch {
                continue;
            }
        }
        return null;
    }
    writeSettings(settings) {
        // Write to openclaw.json in current directory
        const configPath = resolve("openclaw.json");
        writeFileSync(configPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
    }
    // ── Diagnostics (doctor) ─────────────────────────────────
    validateHooks(_pluginRoot) {
        const results = [];
        const settings = this.readSettings();
        if (!settings) {
            results.push({
                check: "Plugin configuration",
                status: "fail",
                message: "Could not read openclaw.json",
                fix: "context-mode upgrade",
            });
            return results;
        }
        // Check for context-mode in plugins.entries
        const plugins = settings.plugins;
        const entries = plugins?.entries;
        if (entries) {
            const hasPlugin = Object.keys(entries).some((k) => k.includes("context-mode"));
            results.push({
                check: "Plugin registration",
                status: hasPlugin ? "pass" : "fail",
                message: hasPlugin
                    ? "context-mode found in plugins.entries"
                    : "context-mode not found in plugins.entries",
                fix: hasPlugin
                    ? undefined
                    : "context-mode upgrade",
            });
            // Check if enabled
            if (hasPlugin) {
                const entry = entries["context-mode"];
                const isEnabled = entry?.enabled !== false;
                results.push({
                    check: "Plugin enabled",
                    status: isEnabled ? "pass" : "warn",
                    message: isEnabled
                        ? "context-mode plugin is enabled"
                        : "context-mode plugin is disabled",
                });
            }
        }
        else {
            results.push({
                check: "Plugin registration",
                status: "fail",
                message: "No plugins.entries found in openclaw.json",
                fix: "context-mode upgrade",
            });
        }
        // Check context engine slot
        const slots = plugins?.slots;
        if (slots?.contextEngine === "context-mode") {
            results.push({
                check: "Context engine",
                status: "pass",
                message: "context-mode registered as context engine (owns compaction)",
            });
        }
        else {
            results.push({
                check: "Context engine",
                status: "warn",
                message: "context-mode not set as context engine — compaction will use default engine",
            });
        }
        return results;
    }
    checkPluginRegistration() {
        const settings = this.readSettings();
        if (!settings) {
            return {
                check: "Plugin registration",
                status: "warn",
                message: "Could not read openclaw.json",
            };
        }
        const plugins = settings.plugins;
        const entries = plugins?.entries;
        if (entries) {
            const hasPlugin = Object.keys(entries).some((k) => k.includes("context-mode"));
            if (hasPlugin) {
                return {
                    check: "Plugin registration",
                    status: "pass",
                    message: "context-mode found in plugins.entries",
                };
            }
        }
        return {
            check: "Plugin registration",
            status: "fail",
            message: "context-mode not found in openclaw.json plugins.entries",
            fix: "context-mode upgrade",
        };
    }
    getInstalledVersion() {
        // Check ~/.openclaw/extensions/context-mode/ for the plugin
        try {
            const pkgPath = resolve(homedir(), ".openclaw", "extensions", "context-mode", "package.json");
            const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
            if (typeof pkg.version === "string")
                return pkg.version;
        }
        catch {
            /* not found */
        }
        // Also check node_modules
        try {
            const pkgPath = resolve("node_modules", "context-mode", "package.json");
            const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
            if (typeof pkg.version === "string")
                return pkg.version;
        }
        catch {
            /* not found */
        }
        return "not installed";
    }
    // ── Upgrade ────────────────────────────────────────────
    configureAllHooks(_pluginRoot) {
        const settings = this.readSettings() ?? {};
        const changes = [];
        // Ensure plugins.entries exists
        if (!settings.plugins) {
            settings.plugins = {};
        }
        const plugins = settings.plugins;
        if (!plugins.entries) {
            plugins.entries = {};
        }
        const entries = plugins.entries;
        // Add context-mode to plugins.entries
        if (!entries["context-mode"]) {
            entries["context-mode"] = { enabled: true };
            changes.push("Added context-mode to plugins.entries");
        }
        else {
            const entry = entries["context-mode"];
            if (entry.enabled === false) {
                entry.enabled = true;
                changes.push("Enabled context-mode plugin");
            }
            else {
                changes.push("context-mode already configured in plugins.entries");
            }
        }
        // Optionally set context engine slot
        if (!plugins.slots) {
            plugins.slots = {};
        }
        const slots = plugins.slots;
        if (!slots.contextEngine) {
            slots.contextEngine = "context-mode";
            changes.push("Set context-mode as context engine (owns compaction)");
        }
        else if (slots.contextEngine !== "context-mode") {
            changes.push(`Context engine already set to "${slots.contextEngine}" — not overwriting`);
        }
        this.writeSettings(settings);
        return changes;
    }
    backupSettings() {
        const paths = [
            resolve("openclaw.json"),
            resolve(".openclaw", "openclaw.json"),
            join(homedir(), ".openclaw", "openclaw.json"),
        ];
        for (const configPath of paths) {
            try {
                accessSync(configPath, constants.R_OK);
                const backupPath = configPath + ".bak";
                copyFileSync(configPath, backupPath);
                return backupPath;
            }
            catch {
                continue;
            }
        }
        return null;
    }
    setHookPermissions(_pluginRoot) {
        // OpenClaw uses TS plugin paradigm — no shell scripts to chmod
        return [];
    }
    updatePluginRegistry(_pluginRoot, _version) {
        // OpenClaw manages plugins through npm/openclaw.json — no separate registry
    }
    // ── Internal helpers ───────────────────────────────────
    /**
     * Resolve the project directory for an OpenClaw hook input.
     * Priority: input.cwd > OPENCLAW_PROJECT_DIR env > process.cwd().
     * Mirrors the cursor / opencode pattern so downstream hooks always
     * receive a defined projectDir even under worktrees or when the
     * platform omits cwd from the wire payload.
     */
    getProjectDir(input) {
        return input.cwd ?? process.env.OPENCLAW_PROJECT_DIR ?? process.cwd();
    }
    /**
     * Extract session ID from OpenClaw hook input.
     */
    extractSessionId(input) {
        if (input.sessionId)
            return input.sessionId;
        return `pid-${process.ppid}`;
    }
}
