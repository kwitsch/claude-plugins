// handlers.mjs — aggregated hook handlers (caveman reimpl + context-mode delegation).
import { stateDir, readLevel, writeLevel, clearLevel, detectLevelChange, reminderText } from "./caveman.mjs";
import { delegateHook } from "./delegate.mjs";

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
  return { ac, hard };
}

export async function handleUserPromptSubmit(input) {
  const dir = stateDir();
  const change = detectLevelChange(input.prompt || "");
  if (change === "off") clearLevel(dir);
  else if (change) writeLevel(dir, change);

  const level = readLevel(dir);
  const cavemanAc = level ? reminderText(level) : null;
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

export const HANDLERS = {
  hook_userpromptsubmit: handleUserPromptSubmit,
  hook_pretooluse: handlePreToolUse,
  hook_posttooluse: handlePostToolUse,
  hook_precompact: handlePreCompact,
};
