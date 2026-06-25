/**
 * OpenCode / KiloCode TypeScript plugin entry point for context-mode.
 *
 * Provides five hooks (v1.0.107 — Mickey OC-1..OC-4 follow-up):
 *   - tool.execute.before  — Routing enforcement (deny/modify/passthrough)
 *   - tool.execute.after   — Session event capture + first-fire AGENTS.md scan (OC-4)
 *   - experimental.session.compacting — Compaction snapshot + budget-capped auto-injection (OC-3)
 *   - experimental.chat.system.transform — ROUTING_BLOCK + resume snapshot injection (OC-1)
 *   - chat.message         — User-prompt capture w/ CCv2 inline filter (OC-2)
 *
 * KiloCode loads this via: import("context-mode") → expects default export
 * with shape { server: (input) => Promise<Hooks> } (PluginModule).
 *
 * OpenCode loads this via: import("context-mode/plugin") → also supports
 * the named export ContextModePlugin for backward compat.
 *
 * Constraints:
 *   - No SessionStart hook (OpenCode doesn't support it — #14808, #5409)
 *   - context injection now via chat.system.transform surrogate (OC-1)
 *   - No routing file auto-write (avoid dirtying project trees)
 *   - Session cleanup happens at plugin init (no SessionStart)
 */
/** KiloCode/OpenCode plugin input — both platforms pass at least `directory`. */
interface PluginContext {
    directory: string;
    [key: string]: unknown;
}
/** OpenCode tool.execute.before — first parameter */
interface BeforeHookInput {
    tool: string;
    sessionID: string;
    callID: string;
}
/** OpenCode tool.execute.before — second parameter */
interface BeforeHookOutput {
    args: any;
}
/** OpenCode tool.execute.after — first parameter */
interface AfterHookInput {
    tool: string;
    sessionID: string;
    callID: string;
    args: any;
}
/** OpenCode tool.execute.after — second parameter */
interface AfterHookOutput {
    title: string;
    output: string;
    metadata: any;
}
/** OpenCode experimental.session.compacting — first parameter */
interface CompactingHookInput {
    sessionID: string;
}
/** OpenCode experimental.session.compacting — second parameter */
interface CompactingHookOutput {
    context: string[];
    prompt?: string;
}
/**
 * OpenCode experimental.chat.system.transform — first parameter.
 * Verified against sst/opencode/dev/packages/plugin/src/index.ts:
 *   input: { sessionID?: string; model: Model }
 * `sessionID` is optional in the SDK type but is in practice always set
 * (the transform runs *for* a session). We treat it as required and
 * skip injection when absent rather than fall back to a fabricated ID.
 *
 * NOTE: We deliberately do NOT use `experimental.chat.messages.transform`.
 * Its SDK input shape is `{}` (no sessionID) and its output is
 * `{ messages: { info: Message; parts: Part[] }[] }` — the prior code
 * (`output.messages.unshift({ role, content })`) wrote a value of the
 * wrong shape and was silently dropped (Mickey / PR #376 root cause).
 */
interface SystemTransformHookInput {
    sessionID?: string;
    model: unknown;
}
/** OpenCode experimental.chat.system.transform — second parameter */
interface SystemTransformHookOutput {
    system: string[];
}
/**
 * OpenCode chat.message hook — verified against
 * refs/platforms/opencode/packages/plugin/src/index.ts:233.
 *   input:  { sessionID; agent?; model?; messageID?; variant? }
 *   output: { message: UserMessage; parts: Part[] }
 * We read text from `parts[*].text` (the orchestrator reference at
 * refs/plugin-examples/opencode/opencode-orchestrator/src/plugin-handlers/
 * chat-message-handler.ts:41-65 uses the same pattern).
 */
interface ChatMessageHookInput {
    sessionID: string;
    agent?: string;
    messageID?: string;
}
interface ChatMessagePart {
    type: string;
    text?: string;
}
interface ChatMessageHookOutput {
    message: unknown;
    parts: ChatMessagePart[];
}
/**
 * Plugin factory. Called once when KiloCode/OpenCode loads the plugin.
 * Returns an object mapping hook event names to async handler functions.
 *
 * KiloCode expects: export default { server: (input) => Promise<Hooks> }
 * OpenCode expects: export const ContextModePlugin = (ctx) => Promise<Hooks>
 */
declare function createContextModePlugin(ctx: PluginContext): Promise<{
    "tool.execute.before": (input: BeforeHookInput, output: BeforeHookOutput) => Promise<void>;
    "tool.execute.after": (input: AfterHookInput, output: AfterHookOutput) => Promise<void>;
    "chat.message": (input: ChatMessageHookInput, output: ChatMessageHookOutput) => Promise<void>;
    "experimental.session.compacting": (input: CompactingHookInput, output: CompactingHookOutput) => Promise<string>;
    "experimental.chat.system.transform": (input: SystemTransformHookInput, output: SystemTransformHookOutput) => Promise<void>;
}>;
declare const _default: {
    server: typeof createContextModePlugin;
};
export default _default;
export { createContextModePlugin as ContextModePlugin };
