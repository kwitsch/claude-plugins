import type { EngineInterface, Register } from "claude-code";
import { keyPath, probeArgv, rewriteCommand, rewriteNote, sessionWarning } from "./sign.mjs";

// tool_use_ids whose command this module rewrote; tool.check auto-allows exactly those (the old hook's permissionDecision allow).
const rewritten = new Set<string>();

// Whether `path` is a regular file (`[ -f ]`: links followed); any error means no.
async function isFile($: EngineInterface, path: string): Promise<boolean> {
  return $.fs.stat(path).then(
    (s) => s.kind === "file",
    () => false,
  );
}

// The key path when ~/.claude/sign.key is a regular file, else null.
async function presentKey($: EngineInterface): Promise<string | null> {
  const keyFile = keyPath(await $.env.get("HOME"));
  return (await isFile($, keyFile)) ? keyFile : null;
}

// The signed form of a Bash command, or null to leave it untouched. Fails open: any error is null.
async function signedCommand($: EngineInterface, command: string): Promise<{ command: string; keyFile: string } | null> {
  try {
    if (command === "") return null;
    const keyFile = await presentKey($);
    if (keyFile === null) return null;
    const signed = rewriteCommand(command, keyFile);
    if (signed === command) return null;
    // Safety net: a rewrite that breaks shell syntax is dropped.
    const check = await $.process.run(["bash", "-n"], { stdin: signed, timeoutMs: 10_000 });
    return check.exitCode === 0 ? { command: signed, keyFile } : null;
  } catch {
    return null;
  }
}

// The SessionStart warning, or null. ssh-keygen that cannot run counts as "cannot tell" (silent).
async function startWarning($: EngineInterface): Promise<string | null> {
  const keyFile = keyPath(await $.env.get("HOME"));
  if (!(await isFile($, keyFile))) return sessionWarning(false, null);
  const probe = await $.process.run(probeArgv(keyFile), { stdin: "", timeoutMs: 10_000 }).catch(() => null);
  return sessionWarning(true, probe === null ? null : probe.stderr);
}

export const register: Register = (on) => {
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    if (e.tool !== "Bash" || typeof e.command !== "string") return next(e);
    const plan = await signedCommand($, e.command);
    if (plan === null) return next(e);
    const id = e.tool_use_id;
    if (id !== undefined) rewritten.add(id);
    try {
      const r = await next({ ...e, command: plan.command });
      return "deny" in r && r.deny !== undefined ? r : { ...r, context: [...(r.context ?? []), rewriteNote(plan.keyFile)] };
    } finally {
      if (id !== undefined) rewritten.delete(id);
    }
  });

  // A rewritten commit runs without the Bash permission prompt, as before; a deny from the rules still stands.
  on("tool.check", { tool: "Bash" }, async (_$, e, next) => {
    const r = await next(e);
    // Only the mode's default ask: an ask from a settings rule, a settings hook or an option's own check still prompts.
    const modeAsk = r.decision === "ask" && r.rule === undefined && r.hook === undefined && r.setting === undefined;
    return e.tool_use_id !== undefined && rewritten.has(e.tool_use_id) && modeAsk ? { ...r, decision: "allow" as const, reason: "git-sign-key rewrote this git commit for file-based SSH signing" } : r;
  });

  on("session.start", async ($, e, next) => {
    const r = await next(e);
    // A reload, enable or worker respawn mid-session fires session.start again: the warning is already in the transcript.
    if ((await $.session.turns().catch(() => 0)) > 0) return r;
    const text = await startWarning($).catch(() => null);
    if (text !== null) await $.session.append({ message: { type: "user", content: [{ type: "text", text }] } });
    return r;
  });
};
