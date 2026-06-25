/**
 * adapters/kimi — Kimi Code CLI platform adapter.
 *
 * Implements HookAdapter for Kimi Code CLI's JSON stdin/stdout paradigm.
 *
 * Kimi Code CLI hook specifics:
 *   - 7 hook events: PreToolUse, PostToolUse, PreCompact, SessionStart,
 *     SessionEnd, UserPromptSubmit, Stop
 *   - Same wire protocol as Codex CLI (JSON stdin → stdout)
 *   - Config: $KIMI_CODE_HOME or ~/.kimi-code (config.toml + mcp.json)
 *   - Hooks are inline `[[hooks]]` array tables in config.toml
 *   - Session dir: $KIMI_CODE_HOME/context-mode/sessions/
 *
 * PreToolUse is deny-only — ask / modify / additionalContext are silently
 * dropped by the host runner (verified upstream at runner.ts:36-39,162-178).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, accessSync, copyFileSync, constants, mkdirSync, } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BaseAdapter, resolveContextModeDataRoot } from "../base.js";
import { hashProjectDirCanonical } from "../../session/db.js";
import { resolveKimiConfigDir } from "./paths.js";
// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────
// PreToolUse matcher: canonical tool names + context-mode bare MCP tool
// names + external MCP catch-all literal. Same charset-clean restriction
// as Codex (Rust regex, no look-around).
const PRE_TOOL_USE_MATCHER_PATTERN = "Bash|Shell|Read|Edit|Write|WebFetch|Agent|ctx_execute|ctx_execute_file|ctx_batch_execute|ctx_fetch_and_index|ctx_search|ctx_index|mcp__";
const KIMI_HOOK_COMMANDS = {
    PreToolUse: "context-mode hook kimi pretooluse",
    PostToolUse: "context-mode hook kimi posttooluse",
    SessionStart: "context-mode hook kimi sessionstart",
    SessionEnd: "context-mode hook kimi sessionend",
    PreCompact: "context-mode hook kimi precompact",
    UserPromptSubmit: "context-mode hook kimi userpromptsubmit",
    Stop: "context-mode hook kimi stop",
};
const LEGACY_HOOK_PATH_SUFFIXES = {
    PreToolUse: ["hooks/pretooluse.mjs", "hooks/kimi/pretooluse.mjs"],
    PostToolUse: ["hooks/posttooluse.mjs", "hooks/kimi/posttooluse.mjs"],
    SessionStart: ["hooks/sessionstart.mjs", "hooks/kimi/sessionstart.mjs"],
    SessionEnd: ["hooks/sessionend.mjs", "hooks/kimi/sessionend.mjs"],
    PreCompact: ["hooks/precompact.mjs", "hooks/kimi/precompact.mjs"],
    UserPromptSubmit: ["hooks/userpromptsubmit.mjs", "hooks/kimi/userpromptsubmit.mjs"],
    Stop: ["hooks/stop.mjs", "hooks/kimi/stop.mjs"],
};
export function probeKimiCliVersion(runCommand = execFileSync) {
    try {
        const output = process.platform === "win32"
            ? runCommand("cmd.exe", ["/d", "/s", "/c", "kimi --version"], {
                encoding: "utf-8",
                stdio: ["ignore", "pipe", "ignore"],
                timeout: 5000,
            })
            : runCommand("kimi", ["--version"], {
                encoding: "utf-8",
                stdio: ["ignore", "pipe", "ignore"],
                timeout: 1500,
            });
        const version = String(output).trim();
        return version.length > 0 ? version : "available (version output empty)";
    }
    catch {
        return null;
    }
}
// ─────────────────────────────────────────────────────────
// TOML [[hooks]] helpers
// ─────────────────────────────────────────────────────────
function parseKimiHooks(toml) {
    const hooks = [];
    const lines = toml.split(/\r?\n/);
    let current = null;
    for (const line of lines) {
        if (/^\s*\[\[hooks\]\]\s*(?:#.*)?$/.test(line)) {
            if (current && current.event && current.command) {
                hooks.push(current);
            }
            current = {};
            continue;
        }
        if (!current)
            continue;
        const kv = line.match(/^\s*(\w+)\s*=\s*(?:"([^"]*)"|(\d+))\s*(?:#.*)?$/);
        if (kv) {
            const key = kv[1];
            const strVal = kv[2];
            const numVal = kv[3];
            if (strVal !== undefined) {
                current[key] = strVal;
            }
            else if (numVal !== undefined) {
                current[key] = Number(numVal);
            }
        }
    }
    if (current && current.event && current.command) {
        hooks.push(current);
    }
    return hooks;
}
function formatKimiHook(hook) {
    const lines = ["[[hooks]]"];
    lines.push(`event = "${hook.event}"`);
    if (hook.matcher)
        lines.push(`matcher = "${hook.matcher}"`);
    lines.push(`command = "${hook.command}"`);
    if (hook.timeout !== undefined)
        lines.push(`timeout = ${hook.timeout}`);
    return lines.join("\n");
}
function isManagedKimiHook(hook) {
    return hook.command.includes("context-mode hook kimi");
}
function buildKimiHookFromRegistration(eventName, entry) {
    const command = (entry.hooks?.[0]?.command ?? "").trim();
    if (!command)
        return null;
    return {
        event: eventName,
        matcher: entry.matcher || undefined,
        command,
        timeout: 30,
    };
}
// ─────────────────────────────────────────────────────────
// Adapter implementation
// ─────────────────────────────────────────────────────────
export class KimiAdapter extends BaseAdapter {
    constructor() {
        super([".kimi-code"]);
    }
    name = "Kimi Code CLI";
    paradigm = "json-stdio";
    capabilities = {
        preToolUse: true,
        postToolUse: true,
        preCompact: true,
        sessionStart: true,
        canModifyArgs: false,
        canModifyOutput: false,
        canInjectSessionContext: false,
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
            toolOutput: input.tool_response,
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
        // Kimi Code emits ONLY 'startup' | 'resume' for SessionStart.source:
        //   refs/platforms/kimi-code/.../session/index.ts:153,181,495
        const rawSource = input.source ?? "startup";
        const source = rawSource === "resume" ? "resume" : "startup";
        return {
            sessionId: this.extractSessionId(input),
            source,
            projectDir: this.getProjectDir(input),
            raw,
        };
    }
    // ── Response formatting ────────────────────────────────
    // Kimi Code uses hookSpecificOutput wrapper for all hook responses.
    // Like Codex, Kimi only supports permissionDecision === "deny" in
    // PreToolUse — ask / modify / additionalContext are silently dropped.
    formatPreToolUseResponse(response) {
        if (response.decision === "deny") {
            return {
                hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "deny",
                    permissionDecisionReason: response.reason ?? "Blocked by context-mode hook",
                },
            };
        }
        // "allow" and everything else — return empty object for passthrough
        return {};
    }
    formatPostToolUseResponse(response) {
        if (response.additionalContext) {
            return {
                hookSpecificOutput: {
                    hookEventName: "PostToolUse",
                    additionalContext: response.additionalContext,
                },
            };
        }
        return {};
    }
    formatPreCompactResponse(_response) {
        return {};
    }
    formatSessionStartResponse(response) {
        if (response.context) {
            return {
                hookSpecificOutput: {
                    hookEventName: "SessionStart",
                    additionalContext: response.context,
                },
            };
        }
        return {};
    }
    // ── Configuration ──────────────────────────────────────
    getConfigDir(_projectDir) {
        return resolveKimiConfigDir();
    }
    getSettingsPath() {
        return join(this.getConfigDir(), "config.toml");
    }
    getMcpPath() {
        return join(this.getConfigDir(), "mcp.json");
    }
    getSessionDir() {
        const override = resolveContextModeDataRoot();
        const dir = override
            ? join(override, "context-mode", "sessions")
            : join(this.getConfigDir(), "context-mode", "sessions");
        mkdirSync(dir, { recursive: true });
        return dir;
    }
    getInstructionFiles() {
        return ["AGENTS.md", "AGENTS.override.md"];
    }
    getMemoryDir(projectDir) {
        const override = resolveContextModeDataRoot();
        const base = override
            ? join(override, "context-mode", "memory")
            : join(this.getConfigDir(), "memory");
        if (!projectDir)
            return base;
        return join(base, hashProjectDirCanonical(projectDir));
    }
    generateHookConfig(_pluginRoot) {
        return {
            PreToolUse: [
                {
                    matcher: PRE_TOOL_USE_MATCHER_PATTERN,
                    hooks: [{ type: "command", command: KIMI_HOOK_COMMANDS.PreToolUse }],
                },
            ],
            PostToolUse: [
                { matcher: "", hooks: [{ type: "command", command: KIMI_HOOK_COMMANDS.PostToolUse }] },
            ],
            SessionStart: [
                { matcher: "", hooks: [{ type: "command", command: KIMI_HOOK_COMMANDS.SessionStart }] },
            ],
            SessionEnd: [
                { matcher: "", hooks: [{ type: "command", command: KIMI_HOOK_COMMANDS.SessionEnd }] },
            ],
            PreCompact: [
                { matcher: "", hooks: [{ type: "command", command: KIMI_HOOK_COMMANDS.PreCompact }] },
            ],
            UserPromptSubmit: [
                { matcher: "", hooks: [{ type: "command", command: KIMI_HOOK_COMMANDS.UserPromptSubmit }] },
            ],
            Stop: [
                { matcher: "", hooks: [{ type: "command", command: KIMI_HOOK_COMMANDS.Stop }] },
            ],
        };
    }
    readSettings() {
        try {
            const raw = readFileSync(this.getSettingsPath(), "utf-8");
            return { _raw_toml: raw };
        }
        catch {
            return null;
        }
    }
    writeSettings(_settings) {
        // Kimi Code uses TOML format. Writing TOML requires a dedicated
        // serializer. This is a no-op; TOML config should be edited
        // manually or via the context-mode upgrade flow.
    }
    // ── Diagnostics (doctor) ─────────────────────────────────
    validateHooks(_pluginRoot) {
        const results = [];
        const kimiCliVersion = probeKimiCliVersion();
        results.push({
            check: "Kimi Code CLI binary",
            status: kimiCliVersion ? "pass" : "warn",
            message: kimiCliVersion
                ? `kimi --version resolved to ${kimiCliVersion}`
                : "Could not run kimi --version; hooks need the Kimi Code CLI available on PATH",
            ...(kimiCliVersion ? {} : { fix: "Install Kimi Code CLI or make kimi available on PATH" }),
        });
        // Validate config.toml hooks
        let rawToml = "";
        try {
            rawToml = readFileSync(this.getSettingsPath(), "utf-8");
        }
        catch {
            results.push({
                check: "Hooks config",
                status: "fail",
                message: `No readable ${this.getSettingsPath()} found`,
                fix: "Run context-mode upgrade to generate the initial config.toml",
            });
            return results;
        }
        const existingHooks = parseKimiHooks(rawToml);
        const expected = this.generateHookConfig("");
        for (const [hookName, entries] of Object.entries(expected)) {
            const expectedEntry = entries[0];
            const ok = existingHooks.some((h) => h.event === hookName
                && this.isExpectedHookEntry(hookName, h, expectedEntry));
            const missingStatus = hookName === "PreCompact" ? "warn" : "fail";
            results.push({
                check: `${hookName} hook`,
                status: (ok ? "pass" : missingStatus),
                message: ok
                    ? `${hookName} hook configured in ${this.getSettingsPath()}`
                    : hookName === "PreCompact"
                        ? `${hookName} hook missing or not pointing to context-mode; compaction snapshots require a Kimi build that emits PreCompact`
                        : `${hookName} hook missing or not pointing to context-mode`,
                fix: ok ? undefined : `Update ${this.getSettingsPath()} to include the managed ${hookName} [[hooks]] entry`,
            });
        }
        // Surface duplicate context-mode entries per hook event
        for (const hookName of Object.keys(expected)) {
            const managedCount = existingHooks.filter((h) => h.event === hookName && isManagedKimiHook(h)).length;
            if (managedCount > 1) {
                results.push({
                    check: `${hookName} duplicates`,
                    status: "warn",
                    message: `${managedCount} context-mode entries found for ${hookName} in ${this.getSettingsPath()}; Kimi will fire all of them`,
                    fix: "context-mode upgrade (collapses duplicate context-mode entries; preserves unrelated hooks)",
                });
            }
        }
        return results;
    }
    checkPluginRegistration() {
        // Check for context-mode in ~/.kimi-code/mcp.json
        try {
            const raw = readFileSync(this.getMcpPath(), "utf-8");
            const parsed = JSON.parse(raw);
            const hasContextMode = raw.includes("context-mode");
            const hasServers = parsed.mcpServers !== undefined || parsed.mcp_servers !== undefined;
            if (hasContextMode && hasServers) {
                return {
                    check: "MCP registration",
                    status: "pass",
                    message: "context-mode found in mcp.json",
                };
            }
            if (hasServers) {
                return {
                    check: "MCP registration",
                    status: "fail",
                    message: "mcpServers section exists but context-mode not found",
                    fix: `Add context-mode to mcpServers in ${this.getMcpPath()}`,
                };
            }
            return {
                check: "MCP registration",
                status: "fail",
                message: "No mcpServers section in mcp.json",
                fix: `Add mcpServers.context-mode to ${this.getMcpPath()}`,
            };
        }
        catch {
            return {
                check: "MCP registration",
                status: "warn",
                message: `Could not read ${this.getMcpPath()}`,
            };
        }
    }
    getInstalledVersion() {
        // Kimi Code uses standalone MCP registration; there is no platform-owned
        // plugin version to compare against the context-mode npm package.
        return "standalone";
    }
    // ── Upgrade ────────────────────────────────────────────
    configureAllHooks(_pluginRoot) {
        const changes = [];
        const desiredHooks = this.generateHookConfig("");
        let rawToml = "";
        try {
            rawToml = readFileSync(this.getSettingsPath(), "utf-8");
        }
        catch {
            // File doesn't exist — start fresh
            rawToml = "";
        }
        const existingHooks = parseKimiHooks(rawToml);
        const nonManagedHooks = existingHooks.filter((h) => !isManagedKimiHook(h));
        const managedHooks = [];
        for (const [hookName, entries] of Object.entries(desiredHooks)) {
            const hook = buildKimiHookFromRegistration(hookName, entries[0]);
            if (hook)
                managedHooks.push(hook);
        }
        // Determine if anything changed
        const hadManaged = existingHooks.some(isManagedKimiHook);
        const newToml = this.rebuildToml(rawToml, nonManagedHooks, managedHooks);
        if (newToml !== rawToml) {
            mkdirSync(dirname(this.getSettingsPath()), { recursive: true });
            writeFileSync(this.getSettingsPath(), newToml, "utf-8");
            if (!hadManaged) {
                changes.push(`Wrote managed Kimi hooks to ${this.getSettingsPath()}`);
            }
            else {
                changes.push(`Updated managed Kimi hooks in ${this.getSettingsPath()}`);
            }
        }
        return changes;
    }
    backupSettings() {
        let firstBackupPath = null;
        for (const settingsPath of [this.getSettingsPath(), this.getMcpPath()]) {
            try {
                accessSync(settingsPath, constants.R_OK);
                const backupPath = this.backupFile(settingsPath);
                firstBackupPath ??= backupPath;
            }
            catch {
                continue;
            }
        }
        return firstBackupPath;
    }
    setHookPermissions(_pluginRoot) {
        // Hook permissions are set during plugin install
        return [];
    }
    updatePluginRegistry(_pluginRoot, _version) {
        // Kimi Code has no plugin registry
    }
    getRoutingInstructions() {
        const instructionsPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "configs", "kimi", "AGENTS.md");
        try {
            return readFileSync(instructionsPath, "utf-8");
        }
        catch {
            return "# context-mode\n\nUse context-mode MCP tools (execute, execute_file, batch_execute, fetch_and_index, search) instead of bash/cat/curl for data-heavy operations.";
        }
    }
    // ── Internal helpers ───────────────────────────────────
    getProjectDir(input) {
        return input.cwd ?? process.env.KIMI_PROJECT_DIR ?? process.cwd();
    }
    extractSessionId(input) {
        if (input.session_id)
            return input.session_id;
        return `pid-${process.ppid}`;
    }
    backupFile(filePath, suffix = "") {
        const backupPath = suffix
            ? `${filePath}${suffix}-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`
            : `${filePath}.bak`;
        copyFileSync(filePath, backupPath);
        return backupPath;
    }
    isExpectedHookEntry(hookName, hook, expectedEntry) {
        if (hookName === "PreToolUse" && hook.matcher !== expectedEntry.matcher) {
            return false;
        }
        return this.entryContainsManagedCommand(hookName, hook);
    }
    entryContainsManagedCommand(hookName, hook) {
        const normalizedCommand = (hook.command ?? "").replace(/\\/g, "/");
        const expectedCliCommand = (KIMI_HOOK_COMMANDS[hookName] ?? "").replace(/\\/g, "/");
        const legacySuffixes = LEGACY_HOOK_PATH_SUFFIXES[hookName] ?? [];
        return normalizedCommand.includes(expectedCliCommand)
            || legacySuffixes.some((suffix) => normalizedCommand.includes(suffix));
    }
    /**
     * Rebuild config.toml by removing old managed hooks and appending new ones.
     * Preserves everything outside [[hooks]] blocks and all non-managed hooks.
     */
    rebuildToml(rawToml, nonManagedHooks, managedHooks) {
        // Strip all existing [[hooks]] blocks from raw TOML
        const lines = rawToml.split(/\r?\n/);
        const outputLines = [];
        let inHookBlock = false;
        for (const line of lines) {
            if (/^\s*\[\[hooks\]\]\s*(?:#.*)?$/.test(line)) {
                inHookBlock = true;
                continue;
            }
            if (inHookBlock) {
                if (/^\s*\[/.test(line)) {
                    inHookBlock = false;
                    outputLines.push(line);
                }
                // Skip lines belonging to the hook block
                continue;
            }
            outputLines.push(line);
        }
        // Trim trailing blank lines (but keep at most one)
        while (outputLines.length > 0 && outputLines[outputLines.length - 1] === "") {
            outputLines.pop();
        }
        if (outputLines.length > 0)
            outputLines.push("");
        // Append non-managed hooks first, then managed ones
        const allHooks = [...nonManagedHooks, ...managedHooks];
        if (allHooks.length > 0) {
            for (const hook of allHooks) {
                outputLines.push(formatKimiHook(hook));
                outputLines.push("");
            }
        }
        return outputLines.join("\n");
    }
}
