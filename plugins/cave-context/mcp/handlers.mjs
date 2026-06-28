// handlers.mjs — aggregated hook handlers: caveman per-turn reminder + context-mode delegation.
// Backs hook_userpromptsubmit, hook_pretooluse, hook_posttooluse, hook_precompact, and compress.
// Never writes stdout (would corrupt the server's JSON-RPC stream); all diagnostics → stderr.
import { reminderText } from "./caveman.mjs";
import { delegateHook } from "./delegate.mjs";
import { compressText } from "./compress.mjs";
import { trackCapture } from "./capture-tracker.mjs";

const WEBFETCH_DENY_REASON =
  "cave-context routing: use ctx_fetch_and_index instead of WebFetch — full network access, results indexed for ctx_search, raw page bytes never enter context.";

/**
 * @param {string|null} a
 * @param {string|null} b
 * @returns {string|null}
 */
export function mergeContext(a, b) {
  const parts = [a, b].filter((s) => s && String(s).trim());
  return parts.length ? parts.join("\n\n") : null;
}

/**
 * @param {string} event
 * @param {string|null} additionalContext
 * @param {Partial<HookResult>} [extra]
 * @returns {HookResult}
 */
function emit(event, additionalContext, extra = {}) {
  const out = { ...extra };
  if (additionalContext) {
    out.hookSpecificOutput = { hookEventName: event, additionalContext, ...(/** @type {any} */ (extra.hookSpecificOutput) || {}) };
  } else if (extra.hookSpecificOutput) {
    out.hookSpecificOutput = { hookEventName: event, ...(/** @type {any} */ (extra.hookSpecificOutput)) };
  }
  return out;
}

/**
 * @param {HookResult|null} res
 * @returns {{ ac: string|null, hard: Partial<HookResult> }}
 */
export function fromDelegate(res) {
  if (!res || typeof res !== "object") return { ac: null, hard: {} };
  const ac = res.hookSpecificOutput?.additionalContext ?? null;
  const hard = /** @type {Partial<HookResult>} */ ({});
  if (res.hookSpecificOutput?.permissionDecision) hard.hookSpecificOutput = /** @type {any} */ ({ permissionDecision: res.hookSpecificOutput.permissionDecision, permissionDecisionReason: res.hookSpecificOutput.permissionDecisionReason });
  if (res.updatedInput) hard.updatedInput = res.updatedInput;
  if (res.decision) hard.decision = res.decision;
  if (res.reason) hard.reason = res.reason; // legacy decision:'block' pairs with a sibling reason
  return { ac, hard };
}

/**
 * @param {HookCommonInput} input
 * @returns {Promise<HookResult>}
 */
export async function handleUserPromptSubmit(input) {
  // Caveman mode is always-on full: emit the per-turn reminder unconditionally,
  // every prompt. No level detection, no runtime state — the prompt is no longer
  // parsed for /caveman level changes. The reminder is the ONLY thing that must be
  // delivered this turn, so it is built synchronously.
  const cavemanAc = reminderText();
  // context-mode's UserPromptSubmit work is capture-only — it saves the prompt + user events
  // to the session DB and returns null (nothing the harness consumes). Don't await it: register
  // it with the capture-tracker and return immediately to cut hook execution time. PreCompact
  // drains in-flight captures before snapshotting, so a still-in-flight prompt can't be missed.
  // (If a future re-vendor makes UserPromptSubmit return additionalContext, restore the awaited
  // fromDelegate(...)/mergeContext path here.)
  trackCapture(delegateHook("UserPromptSubmit", input));
  return emit("UserPromptSubmit", cavemanAc, {});
}

/**
 * @param {ToolHookInput} input
 * @returns {Promise<HookResult>}
 */
export async function handlePreToolUse(input) {
  // Hard-redirect WebFetch → ctx_fetch_and_index. Scoped to the main agent
  // (`!input.agent_id`): subagent WebFetch falls through to the context-mode delegate,
  // which independently governs WebFetch — end-to-end "sparing" of subagents is not
  // guaranteed; this guard only scopes cave-context's own deny to the main agent, where
  // the ctx_fetch_and_index hint is actionable.
  // Soft deny: if the server is down this hook never fires (fails open) and WebFetch
  // proceeds — consistent, since ctx_fetch_and_index would be unavailable then too.
  if (input?.tool_name === "WebFetch" && !input?.agent_id) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: WEBFETCH_DENY_REASON,
      },
    };
  }
  const { ac, hard } = fromDelegate(await delegateHook("PreToolUse", input));
  return emit("PreToolUse", ac, hard); // caveman has no PreToolUse
}

/**
 * @param {ToolHookInput} input
 * @returns {Promise<HookResult>}
 */
export async function handlePostToolUse(input) {
  trackCapture(delegateHook("PostToolUse", input));
  return {};
}

/**
 * @param {HookCommonInput} input
 * @returns {Promise<HookResult>}
 */
export async function handlePreCompact(input) {
  const { ac, hard } = fromDelegate(await delegateHook("PreCompact", input));
  return emit("PreCompact", ac, hard);
}

/**
 * @param {{ text?: string }} [input]
 * @returns {Promise<CompressResult>}
 */
export async function handleCompress(input = {}) {
  return compressText(input?.text ?? "");
}

export const HANDLERS = {
  hook_userpromptsubmit: handleUserPromptSubmit,
  hook_pretooluse: handlePreToolUse,
  hook_posttooluse: handlePostToolUse,
  hook_precompact: handlePreCompact,
  compress: handleCompress,
};
