/**
 * adapters/antigravity — Google Antigravity platform adapter.
 *
 * Implements HookAdapter for Antigravity's MCP-only paradigm.
 *
 * Antigravity hook specifics:
 *   - NO hook support (MCP-only, same as Codex CLI)
 *   - Config: ~/.gemini/antigravity/mcp_config.json (JSON format)
 *   - MCP: full support via mcpServers in mcp_config.json
 *   - All capabilities are false — MCP is the only integration path
 *   - Session dir: ~/.gemini/context-mode/sessions/
 *   - Routing file: GEMINI.md (shared with Gemini CLI filename, different content)
 *
 * Sources:
 *   - Config path: https://github.com/google-gemini/gemini-cli/issues/16058
 *   - MCP support: https://antigravity.google/docs/mcp
 *   - Tool list: System prompt leak (21 verified tools)
 */
import { readFileSync, writeFileSync, mkdirSync, } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { BaseAdapter } from "../base.js";
// ─────────────────────────────────────────────────────────
// Adapter implementation
// ─────────────────────────────────────────────────────────
export class AntigravityAdapter extends BaseAdapter {
    constructor() {
        super([".gemini"]);
    }
    name = "Antigravity";
    paradigm = "mcp-only";
    capabilities = {
        preToolUse: false,
        postToolUse: false,
        preCompact: false,
        sessionStart: false,
        canModifyArgs: false,
        canModifyOutput: false,
        canInjectSessionContext: false,
    };
    // ── Input parsing ──────────────────────────────────────
    // Antigravity does not support hooks. These methods exist to satisfy the
    // interface contract but will throw if called.
    parsePreToolUseInput(_raw) {
        throw new Error("Antigravity does not support hooks");
    }
    parsePostToolUseInput(_raw) {
        throw new Error("Antigravity does not support hooks");
    }
    parsePreCompactInput(_raw) {
        throw new Error("Antigravity does not support hooks");
    }
    parseSessionStartInput(_raw) {
        throw new Error("Antigravity does not support hooks");
    }
    // ── Response formatting ────────────────────────────────
    // Antigravity does not support hooks. Return undefined for all responses.
    formatPreToolUseResponse(_response) {
        return undefined;
    }
    formatPostToolUseResponse(_response) {
        return undefined;
    }
    formatPreCompactResponse(_response) {
        return undefined;
    }
    formatSessionStartResponse(_response) {
        return undefined;
    }
    // ── Configuration ──────────────────────────────────────
    getSettingsPath() {
        return resolve(homedir(), ".gemini", "antigravity", "mcp_config.json");
    }
    /**
     * Antigravity nests under ~/.gemini/antigravity/. Always absolute.
     * `_projectDir` accepted for interface symmetry but unused — home-rooted.
     */
    getConfigDir(_projectDir) {
        return resolve(homedir(), ".gemini", "antigravity");
    }
    getInstructionFiles() {
        return ["GEMINI.md"];
    }
    generateHookConfig(_pluginRoot) {
        return {};
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
        const settingsPath = this.getSettingsPath();
        mkdirSync(dirname(settingsPath), { recursive: true });
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
    }
    // ── Diagnostics (doctor) ─────────────────────────────────
    validateHooks(_pluginRoot) {
        return [
            {
                check: "Hook support",
                status: "warn",
                message: "Antigravity does not support hooks. " +
                    "Only MCP integration is available.",
            },
        ];
    }
    checkPluginRegistration() {
        try {
            const raw = readFileSync(this.getSettingsPath(), "utf-8");
            const config = JSON.parse(raw);
            const mcpServers = config?.mcpServers ?? {};
            if ("context-mode" in mcpServers) {
                return {
                    check: "MCP registration",
                    status: "pass",
                    message: "context-mode found in mcpServers config",
                };
            }
            return {
                check: "MCP registration",
                status: "fail",
                message: "context-mode not found in mcpServers",
                fix: "Add context-mode to mcpServers in ~/.gemini/antigravity/mcp_config.json",
            };
        }
        catch {
            return {
                check: "MCP registration",
                status: "warn",
                message: "Could not read ~/.gemini/antigravity/mcp_config.json",
            };
        }
    }
    getInstalledVersion() {
        try {
            const pkgPath = resolve(homedir(), ".gemini", "extensions", "context-mode", "package.json");
            const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
            return pkg.version ?? "unknown";
        }
        catch {
            return "not installed";
        }
    }
    // ── Upgrade ────────────────────────────────────────────
    configureAllHooks(_pluginRoot) {
        return [];
    }
    setHookPermissions(_pluginRoot) {
        return [];
    }
    updatePluginRegistry(_pluginRoot, _version) {
        // Antigravity plugin registry is managed via mcp_config.json
    }
    getRoutingInstructions() {
        const instructionsPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "configs", "antigravity", "GEMINI.md");
        try {
            return readFileSync(instructionsPath, "utf-8");
        }
        catch {
            return "# context-mode\n\nUse context-mode MCP tools (execute, execute_file, batch_execute, fetch_and_index, search) instead of run_command/view_file for data-heavy operations.";
        }
    }
}
