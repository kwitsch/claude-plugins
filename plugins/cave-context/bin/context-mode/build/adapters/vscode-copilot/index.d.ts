/**
 * adapters/vscode-copilot — VS Code Copilot platform adapter.
 *
 * Extends CopilotBaseAdapter with VS Code-specific logic:
 *   - extractSessionId: VSCODE_PID fallback
 *   - getProjectDir: CLAUDE_PROJECT_DIR
 *   - getSessionDir: .github/ detection with ~/.vscode/ fallback
 *   - checkPluginRegistration: reads .vscode/mcp.json
 *   - getInstalledVersion: scans VS Code extensions dir
 *   - validateHooks: preview status + matcher warnings
 */
import { CopilotBaseAdapter } from "../copilot-base.js";
import type { CopilotHookInput, CopilotHookModule } from "../copilot-base.js";
import type { DiagnosticResult } from "../types.js";
export declare class VSCodeCopilotAdapter extends CopilotBaseAdapter {
    constructor();
    readonly name = "VS Code Copilot";
    protected readonly hookModule: CopilotHookModule;
    protected readonly hookSubdir = "vscode-copilot";
    protected extractSessionId(input: CopilotHookInput): string;
    protected getProjectDir(): string;
    getSessionDir(): string;
    /**
     * VS Code Copilot honors .github/copilot-instructions.md per project.
     * Always returned absolute, resolved against `projectDir` (or `cwd`).
     */
    getConfigDir(projectDir?: string): string;
    getInstructionFiles(): string[];
    validateHooks(pluginRoot: string): DiagnosticResult[];
    checkPluginRegistration(): DiagnosticResult;
    getInstalledVersion(): string;
}
