/**
 * adapters/jetbrains-copilot — JetBrains Copilot platform adapter.
 *
 * Extends CopilotBaseAdapter with JetBrains-specific logic:
 *   - extractSessionId: JETBRAINS_CLIENT_ID / IDEA_HOME fallbacks
 *   - getProjectDir: IDEA_INITIAL_DIRECTORY
 *   - checkPluginRegistration: WARN (IDE Settings UI, not CLI-inspectable)
 *   - getInstalledVersion: checks hook config existence
 *   - validateHooks: JetBrains-specific warnings
 */
import { CopilotBaseAdapter } from "../copilot-base.js";
import type { CopilotHookInput, CopilotHookModule } from "../copilot-base.js";
import type { DiagnosticResult } from "../types.js";
export declare class JetBrainsCopilotAdapter extends CopilotBaseAdapter {
    constructor();
    readonly name = "JetBrains Copilot";
    protected readonly hookModule: CopilotHookModule;
    protected readonly hookSubdir = "jetbrains-copilot";
    protected extractSessionId(input: CopilotHookInput): string;
    protected getProjectDir(): string;
    /**
     * JetBrains Copilot honors .github/copilot-instructions.md per project.
     * Always returned absolute, resolved against the supplied `projectDir`,
     * the JetBrains-specific project env vars, or `process.cwd()`.
     */
    getConfigDir(projectDir?: string): string;
    getInstructionFiles(): string[];
    validateHooks(pluginRoot: string): DiagnosticResult[];
    checkPluginRegistration(): DiagnosticResult;
    getInstalledVersion(): string;
}
