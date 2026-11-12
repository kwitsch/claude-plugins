export const TIMEOUT_MS = 4e3;
export const MAX_CHOICE_OPTIONS = 255;
export const JEV_API_TIMEOUT_S = 5;
export const JEV_TOOL_PREFIX = "mcp__jev-api__";
export const JEV_BATCH = JEV_TOOL_PREFIX + "batch";
export const JEV_TOOLS = [JEV_BATCH];
export function missingJevTools(names) {
	return JEV_TOOLS.filter((t) => !names.includes(t));
}
export function noul(answers, id) {
	const a = answers[id];
	return a?.type === "noul" ? a.noul : undefined;
}
export function choice(answers, id) {
	const a = answers[id];
	return a?.type === "choice" ? a : undefined;
}
export function score(answers, id) {
	const a = answers[id];
	return a?.type === "score" ? a : undefined;
}
