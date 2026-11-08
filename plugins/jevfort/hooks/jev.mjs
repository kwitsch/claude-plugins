export const DEFAULT_JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const MODEL = "jev-latest";
export const TIMEOUT_MS = 4e3;
export function jevUrl(raw) {
	const value = raw?.trim();
	if (!value) return {
		ok: true,
		url: DEFAULT_JEV_URL
	};
	if (!/^https?:\/\/[^/?#\s]+(?:[/?#]\S*)?$/i.test(value)) return {
		ok: false,
		error: "JEV_URL must be an http(s) URL"
	};
	return {
		ok: true,
		url: value
	};
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
