// delegate.mjs — route a Claude Code hook event to context-mode's vendored work.
// Returns the same shape as the old CLI spawn (null, or the JSON the context-mode hook
// would have printed); fail-open to null on any error.
//
// Routing:
//   posttooluse / userpromptsubmit / pretooluse / precompact → in-process (inproc-hooks.mjs)
//   sessionstart                                             → spawn the vendored
//                                                              hooks/sessionstart.mjs
//                                                              (sessionstart-spawn.mjs, D1)
/**
 * @param {string} event
 * @param {HookCommonInput} input
 * @param {number} [timeoutMs]
 * @returns {Promise<HookResult|null>}
 */
export async function delegateHook(event, input, timeoutMs = 8000) {
  if (process.env.CAVE_CONTEXT_NO_UPSTREAM === "1") return null;
  const ev = String(event).toLowerCase();
  try {
    if (ev === "sessionstart") {
      const { runSessionStart } = await import("./sessionstart-spawn.mjs");
      return await runSessionStart(input, timeoutMs);
    }
    const m = await import("./inproc-hooks.mjs");
    if (ev === "posttooluse") return await m.postToolUse(input);
    if (ev === "userpromptsubmit") return await m.userPromptSubmit(input);
    if (ev === "pretooluse") return await m.preToolUse(input);
    if (ev === "precompact") return await m.preCompact(input);
    return null;
  } catch (e) {
    if (process.env.MCP_HOOK_DEBUG) {
      process.stderr.write(`[cave-context] delegateHook ${ev} failed: ${e?.message ?? e}\n`);
    }
    return null; // fail-open
  }
}
