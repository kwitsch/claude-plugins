export const LOG_KEY = "log";
export const MAX_ENTRIES = 1e3;
const RECENT_MAX = 50;
const recent = [];
export function remember(entry) {
	recent.push(entry);
	if (recent.length > RECENT_MAX) recent.shift();
}
export function recentDecisions() {
	return recent.slice();
}
export function statsKey(d) {
	return d.applied ? d.kind : `${d.kind}:pass`;
}
