export const PAUSE_MS = 3e4;
export const MAX_PAUSE_MS = 6e5;
export const MEASURE_GRACE_MS = 250;
export const MAX_ERROR = 1e3;
export const TIMEOUT_MS = 4e3;
export const MAX_CHOICE_OPTIONS = 255;
export const JEV_API_TIMEOUT_S = 4;
export const COMPACT_TIMEOUT_MS = 9e3;
export const COMPACT_API_TIMEOUT_S = 9;
export const HAIKU_TIMEOUT_MS = 15e3;
export const HAIKU_API_TIMEOUT_S = 14;
export const JEV_TOOL_PREFIX = "mcp__jev-api__";
export const JEV_BATCH = JEV_TOOL_PREFIX + "batch";
export const JEV_TOOLS = [JEV_BATCH];
export function missingJevTools(names) {
	return JEV_TOOLS.filter((t) => !names.includes(t));
}
const finite = (v) => typeof v === "number" && Number.isFinite(v);
export function isAnswer(a, type) {
	if (typeof a !== "object" || a === null || a.type !== type) return false;
	const r = a;
	if (type === "noul") return finite(r["noul"]);
	const p = r["probabilities"];
	if (!finite(r["confidence"]) || typeof p !== "object" || p === null || !Object.values(p).every(finite)) return false;
	return type === "choice" ? typeof r["choice"] === "string" : finite(r["score"]);
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
