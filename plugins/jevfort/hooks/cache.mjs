export const CACHE_TTL = {
	"5m": 5 * 6e4,
	"1h": 60 * 6e4
};
const CACHE_YELLOW_MIN = 20;
const CACHE_RED_MIN = 5;
export function cacheTtlOf(usage) {
	const c = usage?.cache_creation;
	if ((c?.ephemeral_1h_input_tokens ?? 0) > 0) return "1h";
	if ((c?.ephemeral_5m_input_tokens ?? 0) > 0) return "5m";
	return undefined;
}
function mostlyCached(usage) {
	const u = usage ?? {};
	const read = u.cache_read_input_tokens ?? 0;
	const all = read + (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
	return all > 0 && read / all > .5;
}
export function nextTtl(usage, known, sinceLast) {
	const ttl = cacheTtlOf(usage) ?? (sinceLast !== undefined && sinceLast > CACHE_TTL["5m"] && mostlyCached(usage) ? "1h" : undefined);
	return ttl && !(ttl === "5m" && known === "1h" && mostlyCached(usage)) ? ttl : known;
}
export function minutesLeft(expires, now) {
	if (expires <= 0) return null;
	const left = expires - now;
	return left <= 0 ? 0 : Math.ceil(left / 6e4);
}
export function cacheLabel(minutes) {
	return minutes <= 0 ? "cache cold" : minutes === 1 ? "cache <1m" : `cache ${minutes - 1}m`;
}
export function cacheColor(minutes) {
	if (minutes <= 0) return "cyan";
	const shown = minutes - 1;
	return shown > CACHE_YELLOW_MIN ? undefined : shown <= CACHE_RED_MIN ? "red" : "yellow";
}
