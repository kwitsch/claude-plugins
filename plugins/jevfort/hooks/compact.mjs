import { clip } from "./context.mjs";
export const MAX_ITEMS = 30;
export const RELEVANCE = [
	"Irrelevant now: superseded, exploratory, or about finished work",
	"Background: useful context but details can be summarized",
	"Relevant: needed to continue the current work",
	"Essential: exact details (paths, errors, decisions, values) must be kept"
];
export function compactItems(messages) {
	const items = [];
	for (const m of messages) {
		if (m.role !== "assistant") continue;
		for (const u of m.toolUses) {
			const target = typeof u.input.file_path === "string" ? u.input.file_path : typeof u.input.command === "string" ? clip(u.input.command, 80) : clip(JSON.stringify(u.input), 80);
			items.push({
				id: u.tool_use_id,
				label: `${u.tool} ${target}`,
				result: clip(u.text ?? "", 500)
			});
		}
	}
	return items.slice(-MAX_ITEMS);
}
export function compactInstructions(items, scores) {
	const keep = items.filter((_, i) => (scores[i] ?? 0) >= 2.2).map((i) => i.label);
	const drop = items.filter((_, i) => scores[i] !== undefined && scores[i] < .8).map((i) => i.label);
	if (!keep.length && !drop.length) return undefined;
	const lines = ["Relevance ranking from Jev:"];
	if (keep.length) lines.push(`Keep exact details (paths, errors, decisions, values) from: ${keep.join("; ")}.`);
	if (drop.length) lines.push(`These are no longer relevant and can be reduced to a word or dropped: ${drop.join("; ")}.`);
	return lines.join("\n");
}
export const COMPACT_MODEL = "claude-haiku-5-5";
export const COMPACT_MAX_TOKENS = 16e3;
const COMPACT_MAX_CHARS = 24e5;
const COMPACT_TAIL = 6;
export const COMPACT_SYSTEM = `You compact a conversation between a user and Claude Code, an AI coding agent, so the work can continue
in a fresh context that holds only your summary. Whoever reads it next knows nothing else about the conversation.

Write a detailed summary with these sections:
1. Primary request and intent: everything the user asked for, in detail, including changes of mind.
2. Key technical concepts: technologies, frameworks, constraints and decisions.
3. Files and code: every file read, created or edited, why it matters, and the important snippets or signatures.
4. Errors and fixes: what went wrong, how it was fixed, and any feedback the user gave about it.
5. Problem solving: what was solved and what is still being worked out.
6. All user messages: every message the user wrote that is not a tool result, briefly and in order.
7. Pending tasks: what the user asked for that is not done.
8. Current work: exactly what was being done right before this summary, with file names and code. The last few
messages come nearly uncut: carry the code and errors from them over in full, since the next step builds on them.
9. Next step: the next step, only if it follows directly from the user's latest request, quoting that request.

Be precise: keep names, paths, numbers, commands and error messages exact. Leave out pleasantries.
Reply with the summary only.`;
export function compactTranscript(messages, toolChars = 2e3, tailChars = 2e4) {
	const tailFrom = messages.length - COMPACT_TAIL;
	const carried = new Set(messages.flatMap((m) => (m.toolResults ?? []).map((r) => r.tool_use_id)));
	return messages.map((m, i) => {
		const tail = i >= tailFrom;
		const resultChars = tail ? tailChars : toolChars;
		const lines = [`${m.role === "user" ? "USER" : "CLAUDE"}: ${m.text}`.trimEnd()];
		for (const t of m.toolUses) {
			lines.push(`  [${t.tool} ${clip(JSON.stringify(t.input), tail ? tailChars : 400)}]`);
			if (t.text && !carried.has(t.tool_use_id)) lines.push(`  → ${clip(t.text, resultChars)}`);
		}
		for (const r of m.toolResults ?? []) if (r.text) lines.push(`  → ${clip(r.text, resultChars)}`);
		return lines.join("\n");
	}).join("\n\n");
}
export function haikuTranscript(messages) {
	let t = compactTranscript(messages);
	if (t.length > COMPACT_MAX_CHARS) t = compactTranscript(messages, 300, 4e3);
	return t.length > COMPACT_MAX_CHARS ? undefined : t;
}
