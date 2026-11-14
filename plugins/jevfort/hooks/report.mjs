import { head } from "./context.mjs";
const THRESHOLDS = [
	.6,
	.7,
	.8,
	.85,
	.9,
	.95
];
const STEP_ROWS = 15;
const pct = (n, of) => of ? `${Math.round(n / of * 100)}%` : "—";
const num = (v) => typeof v === "number" ? v : undefined;
const str = (v) => typeof v === "string" ? v : undefined;
const p2 = (v) => v === undefined ? "—" : v.toFixed(2);
export const escapePipes = (s) => s.replace(/(\\*)\|/g, "$1$1\\|");
const cell = (s, max = 48) => {
	const one = escapePipes(s.replace(/\s+/g, " ")).trim();
	return one.length > max ? `${head(one, max - 1)}…` : one;
};
const bar = (n, of, width = 10) => {
	const filled = of ? Math.round(n / of * width) : 0;
	return "█".repeat(filled) + "░".repeat(width - filled);
};
const pad = (n) => String(n).padStart(2, "0");
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function when(at, latest) {
	const d = new Date(at);
	const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
	return day(d) === day(new Date(latest)) ? time : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}
export function verdict(e, threshold) {
	const bestP = num(e.data?.bestP) ?? 0;
	const wouldTake = str(e.data?.best) !== undefined && bestP >= threshold;
	if (wouldTake) return e.data?.agree === true ? "match" : "differ";
	return e.data?.claudeUsedCandidate === true ? "missed" : "both-claude";
}
const MARK = {
	match: "✓ same",
	"both-claude": "✓ Claude",
	differ: "✗ differ",
	missed: "⚠ missed"
};
function claudeDid(e) {
	const summary = str(e.data?.claudeSummary);
	if (summary) return summary;
	const tools = e.data?.claude ?? [];
	if (!tools.length) return "replied";
	const counts = new Map();
	for (const t of tools) counts.set(t, (counts.get(t) ?? 0) + 1);
	return [...counts].map(([t, n]) => n > 1 ? `${t} ×${n}` : t).join(", ");
}
export function buildReport(log, threshold) {
	if (!log.length) return "**Jev pilot report:** the log is empty. Use Claude for a while and run `/jev report` again.";
	const of = (kind) => log.filter((e) => e.kind === kind);
	const out = [];
	const first = new Date(log[0].at);
	const since = `${day(first)} ${pad(first.getHours())}:${pad(first.getMinutes())}`;
	const takes = of("take");
	const taken = takes.filter((e) => e.applied);
	const compares = of("compare");
	const verdicts = compares.map((e) => verdict(e, threshold));
	const agreed = verdicts.filter((v) => v === "match" || v === "both-claude").length;
	const errored = of("outcome").filter((e) => e.data?.isError === true);
	const routed = new Set(of("route").map((e) => `${e.turnId}:${e.ms}`));
	const timed = log.filter((e) => !(e.kind === "take" && routed.has(`${e.turnId}:${e.ms}`))).map((e) => e.ms).filter((m) => typeof m === "number");
	const avgMs = timed.length ? Math.round(timed.reduce((a, b) => a + b, 0) / timed.length) : undefined;
	out.push("## Jev pilot report");
	out.push(`_${log.length} log entries since ${since} · take threshold **${threshold}**_`);
	out.push("");
	out.push("| | |");
	out.push("|---|---|");
	out.push(`| Steps Jev took itself | **${taken.length}** (≈ ${taken.length} Claude requests saved${errored.length ? `, ${errored.length} failed` : ""}) |`);
	const bypassed = of("bypass").filter((e) => e.applied);
	out.push(`| Turns answered without Claude | **${bypassed.length}** (Jev's action + ${bypassed.length ? "Haiku" : "a small model"} summary) |`);
	out.push(`| Agreement with Claude | **${agreed} / ${compares.length}** (${pct(agreed, compares.length)}) |`);
	out.push(`| Jev latency | ${avgMs === undefined ? "—" : `${avgMs} ms average`} over ${timed.length} calls · ${of("error").length} errors |`);
	if (compares.length) {
		out.push("", `### Jev vs Claude, step by step${compares.length > STEP_ROWS ? ` (last ${STEP_ROWS})` : ""}`);
		const latest = log[log.length - 1].at;
		out.push("| Time | Request | Jev would | p | Claude did | |");
		out.push("|---|---|---|---|---|---|");
		compares.slice(-STEP_ROWS).forEach((e) => {
			const v = verdict(e, threshold);
			const best = str(e.data?.best);
			const jev = v === "match" || v === "differ" ? best : `leave to Claude${best ? ` _(best: ${best})_` : ""}`;
			const p = num(e.data?.bestP);
			out.push(`| ${when(e.at, latest)} | ${cell(str(e.data?.request) ?? "—", 40)} | ${cell(jev, 56)} | ${p2(p)} | ${cell(claudeDid(e), 40)} | ${MARK[v]} |`);
		});
		out.push("", "_✓ same: Jev would make the same call · ✓ Claude: both leave it to Claude · ✗ differ: Jev would act differently · ⚠ missed: Claude used an action Jev had listed_");
	}
	const scored = compares.filter((e) => num(e.data?.bestP) !== undefined);
	if (scored.length) {
		out.push("", "### Take threshold");
		out.push("| Threshold | Would take | Same call as Claude | |");
		out.push("|---|---|---|---|");
		for (const t of THRESHOLDS) {
			const hit = scored.filter((e) => num(e.data?.bestP) >= t);
			const ok = hit.filter((e) => e.data?.agree === true).length;
			const current = Math.abs(t - threshold) < 1e-9;
			out.push(`| ${current ? `**${t.toFixed(2)} ← current**` : t.toFixed(2)} | ${hit.length} | ${pct(ok, hit.length)} | \`${bar(ok, hit.length)}\` |`);
		}
	}
	const routes = of("route");
	const scores = routes.map((e) => num(e.data?.score)).filter((s) => s !== undefined);
	const effortScores = routes.map((e) => num(e.data?.effortScore)).filter((s) => s !== undefined);
	const avgOf = (xs) => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2);
	const lowered = routes.filter((e) => e.data?.lowered === true);
	const raised = routes.filter((e) => e.data?.raised === true);
	const dones = of("done");
	const continued = dones.filter((e) => e.data?.continued === true);
	out.push("", "### Routing and done check");
	out.push("| Decision | Checked | Result |");
	out.push("|---|---|---|");
	out.push(`| Effort routing | ${routes.length} turns | ${scores.length || !effortScores.length ? `avg difficulty ${scores.length ? avgOf(scores) : "—"} (0 trivial … 3 hard)` : `avg effort score ${avgOf(effortScores)} (0 mechanical … 4 hardest)`} · ${lowered.length} lowered, ${raised.length} raised, ${new Set([...lowered, ...raised].filter((e) => e.applied)).size} applied |`);
	out.push(`| Done check | ${dones.length} stops | ${continued.length} unfinished, ${continued.filter((e) => e.applied).length} sent back |`);
	const classified = of("classify");
	if (classified.length) {
		const kinds = new Map();
		for (const e of classified) kinds.set(str(e.data?.kind) ?? "?", (kinds.get(str(e.data?.kind) ?? "?") ?? 0) + 1);
		const hinted = classified.filter((e) => (num(e.data?.hints) ?? 0) > 0);
		out.push(`| Prompt classifier | ${classified.length} prompts | ${[...kinds].map(([k, n]) => `${n} ${k}`).join(" · ")} · ${hinted.length} hinted, ${hinted.filter((e) => e.applied).length} applied |`);
	}
	const agents = of("agent");
	if (agents.length) {
		const switched = agents.filter((e) => e.data?.switched === true);
		out.push(`| Subagent type | ${agents.length} spawns | ${agents.filter((e) => e.data?.agree === true).length} agreed with Claude · ${switched.length} switched, ${switched.filter((e) => e.applied).length} applied |`);
	}
	const compacts = of("compact");
	if (compacts.length) {
		const sum = (k) => compacts.reduce((a, e) => a + (num(e.data?.[k]) ?? 0), 0);
		out.push(`| Compaction | ${compacts.length} runs | ${sum("items")} results scored · ${sum("keep")} kept in detail · ${sum("drop")} marked droppable |`);
	}
	const aborted = of("turn").filter((e) => e.data?.reason === "aborted").length;
	if (aborted) out.push("", `_${aborted} interrupted turn(s)._`);
	return out.join("\n");
}
