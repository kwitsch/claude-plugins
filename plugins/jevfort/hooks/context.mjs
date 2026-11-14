export const head = (text, n) => text.slice(0, n).replace(/[\uD800-\uDBFF]$/, "");
export const clip = (text, max) => {
	if (text.length <= max) return text;
	const kept = head(text, max);
	return `${kept}… [${text.length - kept.length} more chars]`;
};
const TRANSCRIPT_ONLY = /^\s*<(bash-input|bash-stdout|bash-stderr|local-command-stdout|local-command-caveat|command-name|command-message|command-args|system-reminder|task-notification)>/;
function isTranscriptOnly(text) {
	const m = TRANSCRIPT_ONLY.exec(text);
	if (!m) return false;
	const close = `</${m[1]}>`;
	const end = text.lastIndexOf(close);
	if (end < 0) return true;
	const rest = text.slice(end + close.length).trim();
	return rest === "" || isTranscriptOnly(rest);
}
const COMMAND_ROW = /^\s*<command-message>[\s\S]*?<\/command-message>\s*<command-name>([^<]*)<\/command-name>\s*(?:<command-args>([\s\S]*)<\/command-args>\s*)?$/;
const COMPACT_SUMMARY = "This session is being continued from a previous conversation that ran out of context.";
const INTERRUPT = /^\[Request interrupted by user( for tool use)?\]$/;
function typedCommand(text) {
	const m = COMMAND_ROW.exec(text);
	const name = m?.[1]?.trim();
	if (!name) return undefined;
	const args = m?.[2]?.trim();
	return args ? `${name} ${args}` : name;
}
export function splitTurn(messages) {
	let summary;
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== "user" || m.toolResults?.length) continue;
		const text = m.text.trim();
		if (text === "" || INTERRUPT.test(text) || /^<bash-input>/.test(text) && isTranscriptOnly(text)) return undefined;
		if (text.startsWith(COMPACT_SUMMARY)) {
			summary ??= i;
			continue;
		}
		const typed = typedCommand(m.text);
		if (typed) return {
			request: typed,
			command: true,
			steps: messages.slice(i + 1)
		};
		if (!isTranscriptOnly(m.text)) return {
			request: m.text,
			steps: messages.slice(i + 1)
		};
	}
	return summary === undefined ? undefined : {
		request: messages[summary].text,
		steps: messages.slice(summary + 1)
	};
}
export function toolCalls(steps) {
	return steps.flatMap((m) => m.role === "assistant" ? m.toolUses : []);
}
export function summarize(steps, limit = 8) {
	const out = [];
	for (let i = steps.length - 1; i >= 0 && out.length < limit; i--) {
		const m = steps[i];
		if (m.role !== "assistant") continue;
		const row = [];
		if (m.text.trim()) row.push({ assistant: clip(m.text, 400) });
		for (const use of m.toolUses) {
			row.push({
				tool: use.tool,
				input: clip(JSON.stringify(use.input), 300),
				...use.text !== undefined ? { result: clip(use.text, 400) } : {},
				...use.isError ? { isError: true } : {}
			});
		}
		out.unshift(...row);
	}
	return out.slice(-limit);
}
