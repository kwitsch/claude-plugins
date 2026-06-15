// handlers.mjs — aggregated hook handlers (caveman reimpl + context-mode delegation).
import { reminderText } from "./caveman.mjs";
import { delegateHook } from "./delegate.mjs";
import { detectInflightSubagents } from "./subagent-watch.mjs";

export function mergeContext(a, b) {
  const parts = [a, b].filter((s) => s && String(s).trim());
  return parts.length ? parts.join("\n\n") : null;
}

function emit(event, additionalContext, extra = {}) {
  const out = { ...extra };
  if (additionalContext) {
    out.hookSpecificOutput = { hookEventName: event, additionalContext, ...(extra.hookSpecificOutput || {}) };
  } else if (extra.hookSpecificOutput) {
    out.hookSpecificOutput = { hookEventName: event, ...extra.hookSpecificOutput };
  }
  return out;
}

// Pull additionalContext + hard fields out of a delegated context-mode result.
function fromDelegate(res) {
  if (!res || typeof res !== "object") return { ac: null, hard: {} };
  const ac = res.hookSpecificOutput?.additionalContext ?? null;
  const hard = {};
  if (res.hookSpecificOutput?.permissionDecision) hard.hookSpecificOutput = { permissionDecision: res.hookSpecificOutput.permissionDecision, permissionDecisionReason: res.hookSpecificOutput.permissionDecisionReason };
  if (res.updatedInput) hard.updatedInput = res.updatedInput;
  if (res.decision) hard.decision = res.decision;
  if (res.reason) hard.reason = res.reason; // legacy decision:'block' pairs with a sibling reason
  return { ac, hard };
}

export async function handleUserPromptSubmit(input) {
  // Caveman mode is always-on full: emit the per-turn reminder unconditionally,
  // every prompt. No level detection, no runtime state — the prompt is no longer
  // parsed for /caveman level changes.
  const cavemanAc = reminderText();
  const { ac: ctxAc, hard } = fromDelegate(await delegateHook("UserPromptSubmit", input));
  return emit("UserPromptSubmit", mergeContext(cavemanAc, ctxAc), hard);
}

export async function handlePreToolUse(input) {
  const { ac, hard } = fromDelegate(await delegateHook("PreToolUse", input));
  return emit("PreToolUse", ac, hard); // caveman has no PreToolUse
}

export async function handlePostToolUse(input) {
  const { ac, hard } = fromDelegate(await delegateHook("PostToolUse", input));
  return emit("PostToolUse", ac, hard);
}

export async function handlePreCompact(input) {
  const { ac, hard } = fromDelegate(await delegateHook("PreCompact", input));
  return emit("PreCompact", ac, hard);
}

export async function handleStop(input) {
  try {
    if (input?.stop_hook_active === true) return {};          // loop guard: blocked once already
    const transcript = input?.transcript_path;
    if (!transcript) return {};                                // fail-open: cannot locate subagents dir
    const inflight = detectInflightSubagents(transcript, Date.now());
    if (!inflight.length) return {};                           // nothing running → allow
    const ids = inflight.join(", ");
    const reason =
      `${inflight.length} async subagent(s) still running (${ids}). Do not end the turn on a bare wait — ` +
      `either process any already-completed results now, or arm a bounded background completion-watchdog: ` +
      "a Bash run_in_background poll like `until tail -1 <subagent>.jsonl | grep -q '\"stop_reason\":\"end_turn\"'; do sleep 5; done` " +
      `with a deadline, whose exit deterministically re-invokes you. Do NOT use the Monitor tool for this ` +
      `single all-done completion.`;
    return emit("Stop", reason, { decision: "block", reason });
  } catch {
    return {};                                                 // fail-open on any error
  }
}

export const HANDLERS = {
  hook_userpromptsubmit: handleUserPromptSubmit,
  hook_pretooluse: handlePreToolUse,
  hook_posttooluse: handlePostToolUse,
  hook_precompact: handlePreCompact,
  hook_stop: handleStop,
};
