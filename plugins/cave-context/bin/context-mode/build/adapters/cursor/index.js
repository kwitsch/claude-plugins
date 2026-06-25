/**
 * adapters/cursor — Cursor platform adapter.
 *
 * Native Cursor hooks use lower-camel hook names and flat command entries in
 * `.cursor/hooks.json` / `~/.cursor/hooks.json`.
 */
import { readFileSync, writeFileSync, mkdirSync, accessSync, chmodSync, constants, existsSync, readdirSync, } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { BaseAdapter } from "../base.js";
import { resolveClaudeConfigDir } from "../../util/claude-config.js";
import { HOOK_TYPES as CURSOR_HOOK_NAMES, HOOK_SCRIPTS as CURSOR_HOOK_SCRIPTS, PRE_TOOL_USE_MATCHER_PATTERN, REQUIRED_HOOKS, OPTIONAL_HOOKS, isContextModeHook, buildHookCommand, } from "./hooks.js";
const CURSOR_ENTERPRISE_HOOKS_PATH = "/Library/Application Support/Cursor/hooks.json";
export class CursorAdapter extends BaseAdapter {
    constructor() {
        super([".cursor"]);
    }
    name = "Cursor";
    paradigm = "json-stdio";
    capabilities = {
        preToolUse: true,
        postToolUse: true,
        preCompact: false,
        // Cursor v1 ships native sessionStart and the matching hook script
        // (hooks/cursor/sessionstart.mjs) is wired through the dispatcher
        // (src/cli.ts HOOK_MAP). Capability flag must reflect script presence.
        sessionStart: true,
        canModifyArgs: true,
        canModifyOutput: false,
        canInjectSessionContext: true,
    };
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
            toolOutput: input.tool_output ?? input.error_message,
            isError: Boolean(input.error_message),
            sessionId: this.extractSessionId(input),
            projectDir: this.getProjectDir(input),
            raw,
        };
    }
    parseSessionStartInput(raw) {
        const input = raw;
        const rawSource = input.source ?? input.trigger ?? "startup";
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
    formatPreToolUseResponse(response) {
        if (response.decision === "deny") {
            return {
                permission: "deny",
                user_message: response.reason ?? "Blocked by context-mode hook",
            };
        }
        if (response.decision === "modify" && response.updatedInput) {
            return { updated_input: response.updatedInput };
        }
        if (response.decision === "context" && response.additionalContext) {
            return { agent_message: response.additionalContext };
        }
        if (response.decision === "ask") {
            return {
                permission: "ask",
                user_message: response.reason ?? "Action requires user confirmation (security policy)",
            };
        }
        // Cursor rejects empty stdout as "no valid response", so adapter callers
        // need the same explicit no-op payload the hook scripts emit at runtime.
        return { agent_message: "" };
    }
    formatPostToolUseResponse(response) {
        // Cursor rejects empty stdout as "no valid response", so emit a no-op
        // additional_context payload when there is nothing to inject.
        return { additional_context: response.additionalContext ?? "" };
    }
    formatSessionStartResponse(response) {
        // SessionStart follows the same rule: always emit valid JSON, even when
        // the payload is effectively a no-op.
        return { additional_context: response.context ?? "" };
    }
    parseStopInput(raw) {
        const input = raw;
        return {
            sessionId: input.conversation_id ?? `pid-${process.ppid}`,
            status: input.status ?? "completed",
            loopCount: input.loop_count ?? 0,
            generationId: input.generation_id,
            transcriptPath: input.transcript_path ?? undefined,
        };
    }
    formatStopResponse(response) {
        if (response.followupMessage) {
            return { followup_message: response.followupMessage };
        }
        return {};
    }
    parseAfterAgentResponseInput(raw) {
        const input = raw;
        return { text: input.text ?? "" };
    }
    getSettingsPath() {
        return resolve(".cursor", "hooks.json");
    }
    /**
     * Cursor stores conventions per project under .cursor/. Always returned
     * as an absolute path resolved against `projectDir` (or `process.cwd()`
     * when omitted) per the HookAdapter.getConfigDir contract.
     */
    getConfigDir(projectDir) {
        return resolve(projectDir ?? process.cwd(), ".cursor");
    }
    getInstructionFiles() {
        return ["context-mode.mdc"];
    }
    generateHookConfig(_pluginRoot) {
        const hooks = {
            [CURSOR_HOOK_NAMES.PRE_TOOL_USE]: [
                {
                    type: "command",
                    command: buildHookCommand(CURSOR_HOOK_NAMES.PRE_TOOL_USE),
                    matcher: PRE_TOOL_USE_MATCHER_PATTERN,
                    loop_limit: null,
                    failClosed: false,
                },
            ],
            [CURSOR_HOOK_NAMES.POST_TOOL_USE]: [
                {
                    type: "command",
                    command: buildHookCommand(CURSOR_HOOK_NAMES.POST_TOOL_USE),
                    loop_limit: null,
                    failClosed: false,
                },
            ],
            [CURSOR_HOOK_NAMES.SESSION_START]: [
                {
                    type: "command",
                    command: buildHookCommand(CURSOR_HOOK_NAMES.SESSION_START),
                    loop_limit: null,
                    failClosed: false,
                },
            ],
            [CURSOR_HOOK_NAMES.STOP]: [
                {
                    type: "command",
                    command: buildHookCommand(CURSOR_HOOK_NAMES.STOP),
                    loop_limit: null,
                    failClosed: false,
                },
            ],
            [CURSOR_HOOK_NAMES.AFTER_AGENT_RESPONSE]: [
                {
                    type: "command",
                    command: buildHookCommand(CURSOR_HOOK_NAMES.AFTER_AGENT_RESPONSE),
                    loop_limit: null,
                    failClosed: false,
                },
            ],
        };
        return hooks;
    }
    readSettings() {
        for (const configPath of this.getCandidateHookConfigPaths()) {
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
        const configPath = this.getSettingsPath();
        mkdirSync(resolve(".cursor"), { recursive: true });
        writeFileSync(configPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
    }
    validateHooks(_pluginRoot) {
        const results = [];
        const loaded = this.loadNativeHookConfig();
        if (!loaded) {
            results.push({
                check: "Native hook config",
                status: "fail",
                message: "No readable native Cursor hook config found in .cursor/hooks.json or ~/.cursor/hooks.json",
                fix: "context-mode upgrade",
            });
        }
        else {
            const hooks = loaded.config.hooks ?? {};
            results.push({
                check: "Native hook config",
                status: "pass",
                message: `Loaded ${loaded.path}`,
            });
            for (const hookType of REQUIRED_HOOKS) {
                const entries = hooks[hookType];
                const hasHook = Array.isArray(entries)
                    && entries.some((entry) => isContextModeHook(entry, hookType));
                results.push({
                    check: hookType,
                    status: hasHook ? "pass" : "fail",
                    message: hasHook
                        ? `${hookType} hook configured`
                        : `${hookType} hook not configured in ${loaded.path}`,
                    fix: hasHook ? undefined : "context-mode upgrade",
                });
            }
            for (const hookType of OPTIONAL_HOOKS) {
                const entries = hooks[hookType];
                const hasHook = Array.isArray(entries)
                    && entries.some((entry) => isContextModeHook(entry, hookType));
                results.push({
                    check: hookType,
                    status: hasHook ? "pass" : "warn",
                    message: hasHook
                        ? `${hookType} hook configured`
                        : `${hookType} hook missing — session event capture will be reduced`,
                });
            }
        }
        if (existsSync(CURSOR_ENTERPRISE_HOOKS_PATH)) {
            results.push({
                check: "Enterprise hook config",
                status: "warn",
                message: "Enterprise Cursor hook config detected at /Library/Application Support/Cursor/hooks.json (read-only informational layer)",
            });
        }
        if (this.hasClaudeCompatibilityHooks()) {
            results.push({
                check: "Claude compatibility",
                status: "warn",
                message: "Claude-compatible hooks detected; native Cursor hooks are the supported configuration",
            });
        }
        const pluginInstalls = this.detectPluginInstalls();
        if (pluginInstalls.length > 0) {
            const nativeHasContextMode = loaded
                ? Object.entries(loaded.config.hooks ?? {}).some(([type, entries]) => Array.isArray(entries) && entries.some((entry) => isContextModeHook(entry, type)))
                : false;
            if (nativeHasContextMode && loaded) {
                results.push({
                    check: "Plugin/native hook duplication",
                    status: "warn",
                    message: `context-mode plugin detected at ${pluginInstalls[0]} alongside native hooks in ${loaded.path} — ` +
                        `each event will fire twice. Remove one configuration to avoid duplicate routing.`,
                    fix: "Remove the native .cursor/hooks.json entries OR uninstall the plugin",
                });
            }
            else {
                results.push({
                    check: "Plugin install",
                    status: "pass",
                    message: `context-mode plugin installed at ${pluginInstalls[0]}`,
                });
            }
        }
        return results;
    }
    /**
     * Detects context-mode plugin installations under Cursor's plugin directories.
     * Returns absolute paths to any `.cursor-plugin/plugin.json` files whose
     * `name` matches `context-mode`.
     */
    detectPluginInstalls() {
        const roots = [
            join(homedir(), ".cursor", "plugins", "local"),
            join(homedir(), ".cursor", "plugins", "cache"),
        ];
        const found = [];
        for (const root of roots) {
            try {
                accessSync(root, constants.F_OK);
            }
            catch {
                continue;
            }
            // Plugins live one directory deep: <root>/<name>/.cursor-plugin/plugin.json
            let entries = [];
            try {
                entries = readdirSync(root);
            }
            catch {
                continue;
            }
            for (const name of entries) {
                const manifestPath = join(root, name, ".cursor-plugin", "plugin.json");
                try {
                    const raw = readFileSync(manifestPath, "utf-8");
                    const parsed = JSON.parse(raw);
                    if (parsed?.name === "context-mode") {
                        found.push(manifestPath);
                    }
                }
                catch {
                    continue;
                }
            }
        }
        return found;
    }
    checkPluginRegistration() {
        const mcpPaths = [resolve(".cursor", "mcp.json"), join(homedir(), ".cursor", "mcp.json")];
        for (const configPath of mcpPaths) {
            try {
                const raw = readFileSync(configPath, "utf-8");
                const config = JSON.parse(raw);
                const servers = (config.mcpServers ?? config.servers);
                if (!servers)
                    continue;
                const hasContextMode = Object.entries(servers).some(([name, value]) => {
                    if (name.includes("context-mode"))
                        return true;
                    if (!value || typeof value !== "object")
                        return false;
                    const server = value;
                    return server.command === "context-mode";
                });
                if (hasContextMode) {
                    return {
                        check: "MCP registration",
                        status: "pass",
                        message: `context-mode found in ${configPath}`,
                    };
                }
            }
            catch {
                continue;
            }
        }
        // #489 round-3 — pure plugin install (Marketplace) bundles MCP registration
        // inside the plugin package. No native mcp.json exists, but the plugin
        // manifest under ~/.cursor/plugins/{local,cache}/<name>/.cursor-plugin/plugin.json
        // is enough to consider context-mode registered. Without this, doctor
        // self-contradicts: `Plugin install: pass` alongside `MCP registration: warn`.
        const pluginInstalls = this.detectPluginInstalls();
        if (pluginInstalls.length > 0) {
            return {
                check: "MCP registration",
                status: "pass",
                message: `context-mode registered via plugin manifest at ${pluginInstalls[0]}`,
            };
        }
        return {
            check: "MCP registration",
            status: "warn",
            message: "Could not find context-mode in .cursor/mcp.json or ~/.cursor/mcp.json",
        };
    }
    getInstalledVersion() {
        try {
            const output = execSync("cursor --version", {
                encoding: "utf-8",
                stdio: ["ignore", "pipe", "ignore"],
            }).trim();
            return output.split(/\r?\n/)[0] || "unknown";
        }
        catch {
            return "not installed";
        }
    }
    configureAllHooks(_pluginRoot) {
        const settings = this.readSettings() ?? { version: 1, hooks: {} };
        const hooks = (settings.hooks ?? {});
        const changes = [];
        this.upsertHookEntry(hooks, CURSOR_HOOK_NAMES.PRE_TOOL_USE, {
            type: "command",
            command: buildHookCommand(CURSOR_HOOK_NAMES.PRE_TOOL_USE),
            matcher: PRE_TOOL_USE_MATCHER_PATTERN,
            loop_limit: null,
            failClosed: false,
        }, changes);
        this.upsertHookEntry(hooks, CURSOR_HOOK_NAMES.POST_TOOL_USE, {
            type: "command",
            command: buildHookCommand(CURSOR_HOOK_NAMES.POST_TOOL_USE),
            loop_limit: null,
            failClosed: false,
        }, changes);
        this.upsertHookEntry(hooks, CURSOR_HOOK_NAMES.SESSION_START, {
            type: "command",
            command: buildHookCommand(CURSOR_HOOK_NAMES.SESSION_START),
            loop_limit: null,
            failClosed: false,
        }, changes);
        this.upsertHookEntry(hooks, CURSOR_HOOK_NAMES.STOP, {
            type: "command",
            command: buildHookCommand(CURSOR_HOOK_NAMES.STOP),
            loop_limit: null,
            failClosed: false,
        }, changes);
        this.upsertHookEntry(hooks, CURSOR_HOOK_NAMES.AFTER_AGENT_RESPONSE, {
            type: "command",
            command: buildHookCommand(CURSOR_HOOK_NAMES.AFTER_AGENT_RESPONSE),
            loop_limit: null,
            failClosed: false,
        }, changes);
        settings.version = 1;
        settings.hooks = hooks;
        this.writeSettings(settings);
        changes.push(`Wrote native Cursor hooks to ${this.getSettingsPath()}`);
        return changes;
    }
    setHookPermissions(pluginRoot) {
        const set = [];
        const hooksDir = join(pluginRoot, "hooks", "cursor");
        for (const scriptName of Object.values(CURSOR_HOOK_SCRIPTS)) {
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
        // Cursor manages extensions and native hooks internally.
    }
    getCandidateHookConfigPaths() {
        const paths = [this.getSettingsPath(), join(homedir(), ".cursor", "hooks.json")];
        if (process.platform === "darwin") {
            paths.push(CURSOR_ENTERPRISE_HOOKS_PATH);
        }
        return paths;
    }
    getProjectDir(input) {
        return input.cwd
            || input.workspace_roots?.[0]
            || process.env.CURSOR_CWD
            || process.cwd();
    }
    extractSessionId(input) {
        if (input.conversation_id)
            return input.conversation_id;
        if (input.session_id)
            return input.session_id;
        if (process.env.CURSOR_SESSION_ID)
            return process.env.CURSOR_SESSION_ID;
        if (process.env.CURSOR_TRACE_ID)
            return process.env.CURSOR_TRACE_ID;
        return `pid-${process.ppid}`;
    }
    loadNativeHookConfig() {
        for (const configPath of this.getCandidateHookConfigPaths()) {
            try {
                const raw = readFileSync(configPath, "utf-8");
                const config = JSON.parse(raw);
                if (config && typeof config === "object") {
                    return { path: configPath, config };
                }
            }
            catch {
                continue;
            }
        }
        return null;
    }
    hasClaudeCompatibilityHooks() {
        // Issue #460 round-3: probe the resolved CC config dir (honors
        // $CLAUDE_CONFIG_DIR) instead of the literal ~/.claude so users
        // who relocated their CC config still trigger the compat path.
        const compatPaths = [
            resolve(".claude", "settings.json"),
            resolve(".claude", "settings.local.json"),
            join(resolveClaudeConfigDir(), "settings.json"),
        ];
        return compatPaths.some((configPath) => existsSync(configPath));
    }
    upsertHookEntry(hooks, hookType, entry, changes) {
        const existingRaw = hooks[hookType];
        const existing = Array.isArray(existingRaw) ? [...existingRaw] : [];
        const idx = existing.findIndex((candidate) => isContextModeHook(candidate, hookType));
        if (idx >= 0) {
            existing[idx] = entry;
            changes.push(`Updated existing ${hookType} hook entry`);
        }
        else {
            existing.push(entry);
            changes.push(`Added ${hookType} hook entry`);
        }
        hooks[hookType] = existing;
    }
}
