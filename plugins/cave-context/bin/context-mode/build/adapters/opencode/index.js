/**
 * adapters/opencode — OpenCode platform adapter.
 *
 * Implements HookAdapter for OpenCode's TypeScript plugin paradigm.
 *
 * OpenCode hook specifics:
 *   - I/O: TS plugin functions (not JSON stdin/stdout)
 *   - Hook names: tool.execute.before, tool.execute.after, experimental.session.compacting
 *   - Arg modification: output.args mutation
 *   - Blocking: throw Error in tool.execute.before
 *   - Output modification: output.output mutation (TUI bug for bash #13575)
 *   - SessionStart: broken (#14808, no hook #5409)
 *   - Session ID: input.sessionID (camelCase!)
 *   - Project dir: ctx.directory in plugin init (no env var)
 *   - Config: opencode.json plugin array, .opencode/plugins/*.ts
 *   - Session dir: ~/.config/opencode/context-mode/sessions/
 */
/** Strip JSONC comments (// and /* *​/) and trailing commas for JSON.parse. */
function stripJsonComments(str) {
    return str
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/,(\s*[}\]])/g, "$1");
}
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, accessSync, constants, } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { BaseAdapter, resolveContextModeDataRoot } from "../base.js";
// ─────────────────────────────────────────────────────────
// Hook constants (re-exported from hooks.ts)
// ─────────────────────────────────────────────────────────
import { HOOK_TYPES as OPENCODE_HOOK_NAMES } from "./hooks.js";
export class OpenCodeAdapter extends BaseAdapter {
    get name() {
        return this.platform === "kilo" ? "KiloCode" : "OpenCode";
    }
    paradigm = "ts-plugin";
    settingsPath;
    capabilities = {
        preToolUse: true,
        postToolUse: true,
        preCompact: true, // experimental
        sessionStart: true,
        canModifyArgs: true,
        canModifyOutput: true, // with TUI bug caveat for bash (#13575)
        canInjectSessionContext: true,
    };
    platform;
    constructor(platform = "opencode") {
        // sessionDirSegments unused — opencode overrides getSessionDir()
        // with XDG_CONFIG_HOME / APPDATA logic
        super([".config", platform]);
        this.platform = platform;
    }
    // ── Input parsing ──────────────────────────────────────
    parsePreToolUseInput(raw) {
        const input = raw;
        return {
            toolName: input.tool ?? "",
            toolInput: input.args ?? {},
            sessionId: this.extractSessionId(input),
            projectDir: process.env.OPENCODE_PROJECT_DIR || process.cwd(),
            raw,
        };
    }
    parsePostToolUseInput(raw) {
        const input = raw;
        return {
            toolName: input.tool ?? "",
            toolInput: input.args ?? {},
            toolOutput: input.output,
            isError: undefined, // OpenCode doesn't provide isError
            sessionId: this.extractSessionId(input),
            projectDir: process.env.OPENCODE_PROJECT_DIR || process.cwd(),
            raw,
        };
    }
    parsePreCompactInput(raw) {
        const input = raw;
        return {
            sessionId: this.extractSessionId(input),
            projectDir: process.env.OPENCODE_PROJECT_DIR || process.cwd(),
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
            projectDir: process.env.OPENCODE_PROJECT_DIR || process.cwd(),
            raw,
        };
    }
    // ── Response formatting ────────────────────────────────
    formatPreToolUseResponse(response) {
        if (response.decision === "deny") {
            // OpenCode TS plugin paradigm: throw Error to block
            throw new Error(response.reason ?? "Blocked by context-mode hook");
        }
        if (response.decision === "modify" && response.updatedInput) {
            // OpenCode: output.args mutation
            return { args: response.updatedInput };
        }
        if (response.decision === "ask") {
            // OpenCode: no native "ask" mechanism — throw to be safe
            throw new Error(response.reason ?? "Action requires user confirmation (security policy)");
        }
        // "context" — OpenCode's tool.execute.before cannot inject additionalContext
        // in PreToolUse (platform limitation). The guidance is delivered via
        // CLAUDE.md/AGENTS.md routing instructions instead. Passthrough.
        // "allow" — passthrough
        return undefined;
    }
    formatPostToolUseResponse(response) {
        const result = {};
        if (response.updatedOutput) {
            // OpenCode: output.output mutation (TUI bug for bash #13575)
            result.output = response.updatedOutput;
        }
        if (response.additionalContext) {
            result.additionalContext = response.additionalContext;
        }
        return Object.keys(result).length > 0 ? result : undefined;
    }
    formatPreCompactResponse(response) {
        // experimental.session.compacting — return context string
        return response.context ?? "";
    }
    formatSessionStartResponse(response) {
        return response.context ?? "";
    }
    // ── Configuration ──────────────────────────────────────
    getSettingsPath() {
        // OpenCode uses opencode.json in the project root or .opencode/opencode.json
        return this.settingsPath ?? resolve(`${this.platform}.json`);
    }
    paths() {
        if (this.platform === "kilo") {
            // Kilo runtime accepts `.kilo/`, `.kilocode/`, and `.opencode/` as
            // project config dirs (refs/platforms/kilo/packages/opencode/src/
            // kilocode/config/config.ts:50,408). Mirror that here so context-mode
            // discovers config regardless of which suffix the user adopted.
            return [
                resolve("kilo.json"),
                resolve("kilo.jsonc"),
                resolve(".kilo", "kilo.json"),
                resolve(".kilo", "kilo.jsonc"),
                resolve(".kilocode", "kilo.json"),
                resolve(".kilocode", "kilo.jsonc"),
                join(homedir(), ".config", "kilo", "kilo.json"),
                join(homedir(), ".config", "kilo", "kilo.jsonc"),
            ];
        }
        return [
            resolve("opencode.json"),
            resolve("opencode.jsonc"),
            resolve(".opencode", "opencode.json"),
            resolve(".opencode", "opencode.jsonc"),
            join(homedir(), ".config", "opencode", "opencode.json"),
            join(homedir(), ".config", "opencode", "opencode.jsonc"),
        ];
    }
    getSessionDir() {
        // Issue #649: honor CONTEXT_MODE_DATA_DIR universal storage override
        // ahead of OpenCode/Kilo's XDG-rooted default. opencode.json + plugin
        // discovery stay under getConfigDir() so OpenCode itself sees its own
        // config in the expected location.
        const override = resolveContextModeDataRoot();
        const dir = override
            ? join(override, "context-mode", "sessions")
            : join(this.getConfigDir(), "context-mode", "sessions");
        mkdirSync(dir, { recursive: true });
        return dir;
    }
    /**
     * OpenCode/KiloCode honor XDG_CONFIG_HOME on POSIX and APPDATA on Windows.
     * Falls back to ~/.config/<platform> (or %APPDATA%\<platform>).
     * Always absolute. `_projectDir` is accepted for interface symmetry but
     * unused — config is home/XDG-rooted, never project-scoped.
     */
    getConfigDir(_projectDir) {
        let root;
        if (process.platform === "win32") {
            root = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
        }
        else {
            root = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
        }
        return join(root, this.platform);
    }
    getInstructionFiles() {
        return ["AGENTS.md"];
    }
    generateHookConfig(_pluginRoot) {
        // OpenCode uses TS plugin paradigm — hooks are registered via plugin array
        // in opencode.json, not via command-based hook entries.
        // Return the hook name mapping for documentation purposes.
        return {
            [OPENCODE_HOOK_NAMES.BEFORE]: [
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
            [OPENCODE_HOOK_NAMES.AFTER]: [
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
            [OPENCODE_HOOK_NAMES.COMPACTING]: [
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
        this.settingsPath = undefined;
        const configPaths = this.paths();
        const globalPaths = new Set(configPaths.filter(p => p.includes(homedir())));
        let firstValidSettings = null;
        let firstValidPath;
        for (const configPath of configPaths) {
            try {
                const raw = readFileSync(configPath, "utf-8");
                const text = configPath.endsWith(".jsonc") ? stripJsonComments(raw) : raw;
                const settings = JSON.parse(text);
                if (!firstValidSettings) {
                    firstValidSettings = settings;
                    firstValidPath = configPath;
                }
                const isGlobalConfig = globalPaths.has(configPath);
                if (this.hasContextModePlugin(settings) || isGlobalConfig) {
                    this.settingsPath = configPath;
                    return settings;
                }
            }
            catch {
                continue;
            }
        }
        if (firstValidSettings) {
            this.settingsPath = firstValidPath;
            return firstValidSettings;
        }
        return null;
    }
    writeSettings(settings) {
        // Write to opencode.json(c)/kilo.json(c) in current directory
        writeFileSync(this.getSettingsPath(), JSON.stringify(settings, null, 2) + "\n", "utf-8");
    }
    // ── Diagnostics (doctor) ─────────────────────────────────
    validateHooks(_pluginRoot) {
        const results = [];
        const settings = this.readSettings();
        if (!settings) {
            results.push({
                check: "Plugin configuration",
                status: "fail",
                message: `Could not read ${this.platform}.json or ${this.platform}.jsonc`,
                fix: "context-mode upgrade",
            });
            return results;
        }
        // Check for "context-mode" in plugin array
        const hasPlugin = this.hasContextModePlugin(settings);
        if (Array.isArray(settings.plugin)) {
            results.push({
                check: "Plugin registration",
                status: hasPlugin ? "pass" : "fail",
                message: hasPlugin
                    ? "context-mode found in plugin array"
                    : "context-mode not found in plugin array",
                fix: hasPlugin
                    ? undefined
                    : "context-mode upgrade",
            });
        }
        else {
            results.push({
                check: "Plugin registration",
                status: "fail",
                message: `No plugin array found in ${this.platform}.json or ${this.platform}.jsonc`,
                fix: "context-mode upgrade",
            });
        }
        if (this.hasLegacyContextModeMcp(settings)) {
            results.push({
                check: "Legacy MCP registration",
                status: "warn",
                message: "mcp.context-mode is redundant: ctx_* tools are now provided by the plugin",
                fix: "context-mode upgrade (removes only mcp.context-mode; preserves other MCP servers)",
            });
        }
        // Note: SessionStart handled via experimental.chat.system.transform surrogate
        results.push({
            check: "SessionStart hook",
            status: "pass",
            message: `SessionStart via experimental.chat.system.transform surrogate (native hook pending #14808, #5409)`,
        });
        return results;
    }
    checkPluginRegistration() {
        const settings = this.readSettings();
        if (!settings) {
            return {
                check: "Plugin registration",
                status: "warn",
                message: `Could not read ${this.platform}.json or ${this.platform}.jsonc`,
            };
        }
        if (this.hasContextModePlugin(settings)) {
            return {
                check: "Plugin registration",
                status: "pass",
                message: "context-mode found in plugin array",
            };
        }
        return {
            check: "Plugin registration",
            status: "fail",
            message: `context-mode not found in ${this.platform}.json plugin array`,
            fix: "context-mode upgrade",
        };
    }
    getInstalledVersion() {
        // Check ~/.cache/opencode/node_modules/ for context-mode
        try {
            const pkgPath = resolve(homedir(), ".cache", this.platform, "node_modules", "context-mode", "package.json");
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
        // Add "context-mode" to the plugin array
        const plugins = (settings.plugin ?? []);
        if (!plugins.some((p) => p.includes("context-mode"))) {
            plugins.push("context-mode");
            changes.push("Added context-mode to plugin array");
        }
        else {
            changes.push("context-mode already in plugin array");
        }
        settings.plugin = plugins;
        const mcp = settings.mcp;
        if (mcp && typeof mcp === "object" && !Array.isArray(mcp)) {
            const servers = mcp;
            if (Object.prototype.hasOwnProperty.call(servers, "context-mode")) {
                delete servers["context-mode"];
                changes.push("Removed legacy context-mode MCP block (plugin-native tools)");
            }
            if (Object.keys(servers).length === 0)
                delete settings.mcp;
        }
        this.writeSettings(settings);
        return changes;
    }
    backupSettings() {
        const check = this.checkPluginRegistration();
        if (!this.settingsPath)
            return null;
        if (check.status === "pass") {
            return this.settingsPath;
        }
        else {
            try {
                accessSync(this.settingsPath, constants.R_OK);
                const backupPath = this.settingsPath + ".bak";
                copyFileSync(this.settingsPath, backupPath);
                return backupPath;
            }
            catch {
                return null;
            }
        }
    }
    setHookPermissions(_pluginRoot) {
        // OpenCode uses TS plugin paradigm — no shell scripts to chmod
        return [];
    }
    updatePluginRegistry(_pluginRoot, _version) {
        // OpenCode manages plugins through npm/opencode.json — no separate registry
    }
    // ── Internal helpers ───────────────────────────────────
    /**
     * Check whether a settings object has the context-mode plugin registered.
     */
    hasContextModePlugin(settings) {
        const plugins = settings.plugin;
        return Array.isArray(plugins) && plugins.some((p) => typeof p === "string" && p.includes("context-mode"));
    }
    hasLegacyContextModeMcp(settings) {
        const mcp = settings.mcp;
        return !!(mcp &&
            typeof mcp === "object" &&
            !Array.isArray(mcp) &&
            Object.prototype.hasOwnProperty.call(mcp, "context-mode"));
    }
    /**
     * Extract session ID from OpenCode hook input.
     * OpenCode uses camelCase sessionID.
     */
    extractSessionId(input) {
        if (input.sessionID)
            return input.sessionID;
        return `pid-${process.ppid}`;
    }
}
