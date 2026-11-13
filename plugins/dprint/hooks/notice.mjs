const CONFIG_NAMES = [
	"dprint.json",
	"dprint.jsonc",
	".dprint.json",
	".dprint.jsonc",
	".config/dprint.json",
	".config/dprint.jsonc"
];
const TOAST_MS = 15e3;
const PROBE_TIMEOUT_MS = 1e4;
const PROBE_RETRY_MS = 3e4;
const MIN_VERSION = "0.50.0";
const NOT_INSTALLED = "no dprint is installed (none on PATH, in $DPRINT_INSTALL/bin (default ~/.dprint/bin) or in the npx cache)";
let shownAt;
let probe = null;
let dprintRuns = false;
function withinMs(since, ms) {
	const age = Date.now() - since;
	return age >= 0 && age < ms;
}
function parentOf(dir) {
	const i = Math.max(dir.lastIndexOf("/"), dir.lastIndexOf("\\"));
	if (i > 0) return dir.slice(0, i);
	return i === 0 && dir.length > 1 ? dir.slice(0, 1) : "";
}
async function judge($, argv, cwd, name) {
	let r;
	try {
		r = await $.process.run(argv, {
			cwd,
			timeoutMs: PROBE_TIMEOUT_MS
		});
	} catch {
		return {
			kind: "start",
			text: `${name} could not start or took over ${PROBE_TIMEOUT_MS / 1e3} s to answer --version`
		};
	}
	if (r.exitCode !== 0) return {
		kind: "exit",
		text: `${name} --version exited ${r.exitCode}`
	};
	const m = /^dprint (\d+)\.(\d+)\.(\d+)(-\S+)?/.exec(r.stdout.trim());
	if (!m) return {
		kind: "output",
		text: `${name} --version printed no dprint version`
	};
	const min = MIN_VERSION.split(".").map(Number);
	let cmp = 0;
	for (let i = 0; i < 3 && cmp === 0; i++) cmp = Number(m[i + 1]) - min[i];
	if (cmp === 0 && m[4]) cmp = -1;
	if (cmp >= 0) return null;
	return {
		kind: "old",
		text: `${name} is dprint ${m[1]}.${m[2]}.${m[3]}${m[4] ?? ""}, the plugin needs >= ${MIN_VERSION}`
	};
}
function dprintProblem($) {
	if (probe && (probe.failedAt === undefined || withinMs(probe.failedAt, PROBE_RETRY_MS))) return probe.problem;
	const entry = { problem: (async () => {
		const [home, pathVar, install] = await Promise.all([
			$.env.get("HOME"),
			$.env.get("PATH"),
			$.env.get("DPRINT_INSTALL")
		]);
		const cwd = home && await $.fs.exists(home) ? home : "/";
		const candidates = (pathVar ?? "").split(":").filter((d) => d.startsWith("/")).map((d) => `${d.replace(/\/+$/, "")}/dprint`);
		const found = await Promise.all(candidates.map((p) => $.fs.exists(p)));
		let pick = candidates.find((_, i) => found[i]);
		const fallback = install ? `${install.replace(/\/+$/, "")}/bin/dprint` : home ? `${home}/.dprint/bin/dprint` : "";
		if (!pick && fallback && await $.fs.exists(fallback)) pick = fallback;
		if (pick) return (await judge($, [pick, "--version"], cwd, pick))?.text ?? null;
		const npx = await judge($, [
			"npx",
			"--no",
			"--prefer-offline",
			"--",
			"dprint",
			"--version"
		], cwd, "npx");
		return npx?.kind === "exit" ? NOT_INSTALLED : npx?.text ?? null;
	})() };
	const fail = () => {
		entry.failedAt = Date.now();
	};
	entry.problem.then((problem) => {
		if (problem === null) dprintRuns = true;
		else fail();
	}, fail);
	probe = entry;
	return entry.problem;
}
async function warnIfNoDprint($, dir) {
	const recentlyShown = () => shownAt !== undefined && withinMs(shownAt, TOAST_MS);
	if (!dir || dprintRuns || recentlyShown()) return;
	const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
	let found = false;
	for (let d = dir; d && !found; d = parentOf(d)) {
		const base = d.endsWith(sep) ? d : d + sep;
		const [git, ...configs] = await Promise.all([".git", ...CONFIG_NAMES].map((n) => $.fs.exists(base + n)));
		found = configs.some(Boolean);
		if (git) break;
	}
	if (!found) return;
	const problem = await dprintProblem($);
	if (problem === null) return;
	if (recentlyShown()) return;
	shownAt = Date.now();
	$.ui.toast(`dprint: ${dir} (or a parent up to the git root) has a dprint config but ${problem}; run /dprint:dprint init`, { timeoutMs: TOAST_MS });
}
async function resultingCwd($, e, r) {
	const ev = e;
	const key = ev?.tool === "ExitWorktree" ? "restoredCwd" : ev?.tool === "EnterWorktree" ? "worktreePath" : null;
	if (key !== null) {
		for (const x of [
			ev?.tool_response,
			r?.result,
			r
		]) {
			const dir = x?.[key];
			if (typeof dir === "string" && dir) return dir;
		}
	}
	return $.session.cwd();
}
async function onSessionCwd($, e, next) {
	const r = await next(e);
	void resultingCwd($, e, r).then((dir) => warnIfNoDprint($, dir)).catch(() => {});
	return r;
}
async function onCwdChanged($, e, next) {
	const r = await next(e);
	void warnIfNoDprint($, e?.new_cwd ?? "").catch(() => {});
	return r;
}
export const register = (on) => {
	on("session.start", onSessionCwd);
	on("classic.CwdChanged", onCwdChanged);
	on("tool.call", { tool: "EnterWorktree" }, onSessionCwd);
	on("tool.call", { tool: "ExitWorktree" }, onSessionCwd);
};
