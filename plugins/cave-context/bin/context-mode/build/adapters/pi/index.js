/**
 * adapters/pi — Pi coding agent platform adapter.
 *
 * Implements HookAdapter for Pi's MCP-only paradigm at the adapter layer.
 *
 * Pi hook specifics:
 *   - NO JSON-stdio hooks. Pi exposes a JS-callback runtime API
 *     (`pi.on("session_start", fn)`, `pi.on("tool_call", fn)`, …) which is
 *     wired DIRECTLY by `src/adapters/pi/extension.ts`. The HookAdapter
 *     contract here intentionally reports `mcp-only` and all-false
 *     capabilities so harness paths that walk the JSON-stdio matrix do not
 *     try to register stdio hooks for Pi.
 *   - Config root: ~/.pi/
 *   - Settings: ~/.pi/settings.json (kept lightweight — Pi does not
 *     prescribe a canonical settings file, but several internal tools
 *     write one; using settings.json keeps parity with Claude Code).
 *   - Session dir: ~/.pi/context-mode/sessions/  (parallel to ~/.claude/,
 *     ~/.omp/) — this is the data-isolation contract from issue #473.
 *   - Instruction file: AGENTS.md (per configs/pi/AGENTS.md).
 *
 * Why a dedicated adapter is mandatory:
 *   Before this adapter existed, `getAdapter("pi")` fell through to the
 *   `default` arm of the switch in `src/adapters/detect.ts` and returned a
 *   ClaudeCodeAdapter. Pi sessions therefore wrote DBs and event logs into
 *   `~/.claude/context-mode/sessions/`, contaminating Claude Code state and
 *   silently leaking Pi user data into the wrong storage root (issue #473
 *   follow-up). The OMP adapter fixed the same class of bug for OMP; this
 *   adapter closes the gap for Pi.
 */
import { readFileSync, writeFileSync, mkdirSync, } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { BaseAdapter } from "../base.js";
// ─────────────────────────────────────────────────────────
// Adapter implementation
// ─────────────────────────────────────────────────────────
export class PiAdapter extends BaseAdapter {
    constructor() {
        super([".pi"]);
    }
    name = "Pi";
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
    // Pi does not feed the adapter via JSON-stdio. These methods exist to
    // satisfy the HookAdapter contract and throw if the harness mistakenly
    // routes a JSON-stdio event through the adapter.
    parsePreToolUseInput(_raw) {
        throw new Error("Pi does not support JSON-stdio hooks (wired via extension.ts)");
    }
    parsePostToolUseInput(_raw) {
        throw new Error("Pi does not support JSON-stdio hooks (wired via extension.ts)");
    }
    parsePreCompactInput(_raw) {
        throw new Error("Pi does not support JSON-stdio hooks (wired via extension.ts)");
    }
    parseSessionStartInput(_raw) {
        throw new Error("Pi does not support JSON-stdio hooks (wired via extension.ts)");
    }
    // ── Response formatting ────────────────────────────────
    // No JSON-stdio path — return undefined to satisfy the contract.
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
        return resolve(homedir(), ".pi", "settings.json");
    }
    getInstructionFiles() {
        return ["AGENTS.md"];
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
                status: "pass",
                message: "Pi hooks are wired via the context-mode Pi extension " +
                    "(~/.pi/extensions/context-mode/), not via JSON-stdio.",
            },
        ];
    }
    checkPluginRegistration() {
        // Pi registers extensions by directory presence; the version-sync
        // script writes ~/.pi/extensions/context-mode/package.json. We treat
        // that file as the registration signal.
        const pkgPath = resolve(homedir(), ".pi", "extensions", "context-mode", "package.json");
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
            if (pkg?.name === "context-mode") {
                return {
                    check: "Pi extension registration",
                    status: "pass",
                    message: `context-mode extension installed at ${pkgPath}`,
                };
            }
            return {
                check: "Pi extension registration",
                status: "warn",
                message: `Unexpected package at ${pkgPath}`,
            };
        }
        catch {
            return {
                check: "Pi extension registration",
                status: "fail",
                message: `context-mode not found at ${pkgPath}`,
                fix: "Run: context-mode upgrade",
            };
        }
    }
    getInstalledVersion() {
        try {
            const pkgPath = resolve(homedir(), ".pi", "extensions", "context-mode", "package.json");
            const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
            return pkg.version ?? "unknown";
        }
        catch {
            return "not installed";
        }
    }
    // ── Upgrade ────────────────────────────────────────────
    // Pi does NOT use settings.json hook entries. The extension is the
    // integration point — there is nothing for the harness to register
    // beyond copying the extension into ~/.pi/extensions/context-mode/.
    configureAllHooks(_pluginRoot) {
        return [];
    }
    setHookPermissions(_pluginRoot) {
        return [];
    }
    updatePluginRegistry(_pluginRoot, _version) {
        // Pi extension version is managed by scripts/version-sync.mjs writing
        // to ~/.pi/extensions/context-mode/package.json. No-op here.
    }
    getRoutingInstructions() {
        return "# context-mode\n\nUse context-mode MCP tools (ctx_execute, ctx_execute_file, ctx_batch_execute, ctx_fetch_and_index, ctx_search) instead of inline shell/HTTP calls for data-heavy operations.";
    }
}
