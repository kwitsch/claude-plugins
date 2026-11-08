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
