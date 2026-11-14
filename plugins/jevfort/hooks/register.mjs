import { GENERAL, SWITCH_AT } from "./agents.mjs";
import { CACHE_TTL, cacheColor, cacheLabel, minutesLeft, nextTtl } from "./cache.mjs";
import { absolute, AUTH_TOOL, bash, BUILTIN_COMMANDS, clipScript, coversStep, dedupeSkills, isSafeScript, isSafeToOffer, MAX_READS, MAX_STATS, mentionedPaths, quotedTerms, relevant, SAFE_MAKE, sameCall, SKILL_BLOCKLIST_KEY } from "./candidates.mjs";
import { COMPACT_MAX_TOKENS, COMPACT_MODEL, COMPACT_SYSTEM, compactInstructions, compactItems, haikuTranscript, RELEVANCE } from "./compact.mjs";
import { clip, head, splitTurn, summarize, toolCalls } from "./context.mjs";
import { choice, COMPACT_API_TIMEOUT_S, COMPACT_TIMEOUT_MS, HAIKU_API_TIMEOUT_S, HAIKU_TIMEOUT_MS, isAnswer, JEV_API_TIMEOUT_S, JEV_BATCH, JEV_TOOL_PREFIX, JEV_TOOLS, MAX_CHOICE_OPTIONS, MAX_ERROR, MAX_PAUSE_MS, MEASURE_GRACE_MS, missingJevTools, noul, PAUSE_MS, score, TIMEOUT_MS } from "./jev.mjs";
import { forgetRecent, LOG_KEY, MAX_ENTRIES, recentDecisions, remember, statsKey } from "./log.mjs";
import { bestAction, bounds, difficultyQuestion, doneQuestion, EFFORT_ORDER, effortQuestion, ESTIMATE_SPEC, ESTIMATE_TOOL, estimateEffort, EVERY_TURN_MODELS, inBandRange, inScratchpad, isEffort, lowerModel, mechanicalQuestion, modelFamily, nextActionQuestion, parseEstimateInput, pickCandidate, route, shouldContinue, singleActionQuestion, taskEndQuestion } from "./policy.mjs";
import { hints, NONE, promptQuestions } from "./prompt.mjs";
import { buildReport, escapePipes } from "./report.mjs";
import { SUMMARY_MODEL, SYSTEM } from "./summarize.mjs";
const newScan = () => ({
	steps: 0,
	calls: new Set(),
	paths: new Set()
});
const newCache = () => ({
	statted: new Map(),
	scan: newScan()
});
const CACHE_TICK_MS = 15e3;
const MAX_TAKES_PER_TURN = 3;
const WRITE_TOOLS = new Set([
	"Edit",
	"Write",
	"NotebookEdit"
]);
function settled(base) {
	return base.decision === "deny" || base.decision === "allow" || base.decision === "ask" && base.rule !== undefined;
}
const SINGLE_ACTION = .8;
const REFUSED = /^(The user doesn't want to proceed with this tool use|Permission for this tool use was denied|Permission to use .*has been denied|Hook '[^']*' blocked)/s;
const PLUGIN_NAME = "jevfort";
const DONE_PROMPT = "Jev: the user's request doesn't look finished yet. Continue with what remains. If it is actually complete, say so in one line.";
const FINISHED = new Set([
	"completed",
	"failed",
	"killed",
	"idle"
]);
const asText = (v) => String(v);
const jevPause = {
	until: 0,
	ms: 0,
	at: 0,
	error: ""
};
const API_TIMEOUT = /\btimeout after \d+ms\b/;
function pauseAfterTimeout(startedAt, budgetMs, error) {
	if (startedAt < jevPause.until) return;
	jevPause.ms = jevPause.ms ? Math.min(jevPause.ms * 2, MAX_PAUSE_MS) : PAUSE_MS;
	jevPause.until = startedAt + budgetMs + jevPause.ms;
	jevPause.at = startedAt;
	jevPause.error = error;
}
async function askJev($, state, questions, slow = false) {
	const startedAt = await $.clock.now().catch(() => Date.now());
	if (startedAt < jevPause.at) Object.assign(jevPause, {
		until: 0,
		ms: 0,
		at: 0,
		error: ""
	});
	const done = async (r) => ({
		...r.ok ? r : {
			ok: false,
			error: clip(r.error, MAX_ERROR)
		},
		ms: await $.clock.now().catch(() => Date.now()) - startedAt
	});
	if (startedAt < jevPause.until) return {
		ok: false,
		error: `paused for ${Math.ceil((jevPause.until - startedAt) / 1e3)} s after a timeout (${jevPause.error})`
	};
	const haiku = await (haikuPath ??= Promise.all([
		$.env.get("TYPESAFE_API_KEY"),
		$.env.get("TYPESAFE_BASE_URL"),
		$.env.get("JEV_URL")
	]).then((vals) => !vals.some((v) => v?.trim()), () => true));
	const budgetMs = haiku ? HAIKU_TIMEOUT_MS : slow ? COMPACT_TIMEOUT_MS : TIMEOUT_MS;
	const apiTimeoutS = haiku ? HAIKU_API_TIMEOUT_S : slow ? COMPACT_API_TIMEOUT_S : JEV_API_TIMEOUT_S;
	const entries = Object.entries(questions);
	const call = (async () => {
		const r = await $.tool.call({
			tool: JEV_BATCH,
			state: JSON.stringify(state),
			questions: entries.map(([, q]) => q),
			timeout: apiTimeoutS
		});
		if (r.deny !== undefined) throw new Error(asText(r.deny));
		if (r.isError === true || typeof r.result !== "string") throw new Error(`batch: ${r.result === undefined ? "no result" : typeof r.result === "string" ? r.result : JSON.stringify(r.result)}`);
		let list;
		try {
			list = JSON.parse(r.result);
		} catch {
			throw new Error("batch: result is not JSON");
		}
		if (!Array.isArray(list) || list.length !== entries.length) throw new Error(`batch: expected ${entries.length} answers`);
		return Object.fromEntries(entries.map(([id, q], i) => {
			const answer = list[i];
			if (!isAnswer(answer, q.type)) throw new Error(`batch: no valid ${q.type} answer for questions[${i}]`);
			return [id, answer];
		}));
	})();
	call.catch(() => undefined);
	const timer = deadline($, budgetMs);
	try {
		const answers = await Promise.race([call, timer.elapsed]);
		if (!answers) {
			pauseAfterTimeout(startedAt, budgetMs, `timeout after ${budgetMs}ms`);
			return done({
				ok: false,
				error: `timeout after ${budgetMs}ms`
			});
		}
		jevPause.ms = 0;
		jevPause.until = 0;
		return done({
			ok: true,
			answers
		});
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		const timedOut = API_TIMEOUT.exec(error);
		if (timedOut) pauseAfterTimeout(startedAt, budgetMs, timedOut[0]);
		return done({
			ok: false,
			error
		});
	} finally {
		timer.cancel();
	}
}
function deadline($, ms) {
	let timer;
	const elapsed = new Promise((resolve) => {
		timer = $.clock.after(ms, () => resolve(undefined));
	});
	return {
		elapsed,
		cancel: () => timer?.cancel()
	};
}
let jevTools;
let toolListing;
let skillList;
let haikuPath;
function dropTurnReads() {
	jevTools = undefined;
	toolListing = undefined;
	skillList = undefined;
	haikuPath = undefined;
}
let jevState;
let estimateRegistered = false;
let bandStale = false;
let cacheExpires = 0;
let cacheTtl = "1h";
let lastResponseAt;
let shownMinutes = null;
let turnRunning = false;
let coldCompacted = false;
let compactQueued = false;
let lostCompact;
let cacheTimer;
function showMinutes($, minutes) {
	if (minutes === shownMinutes) return;
	shownMinutes = minutes;
	try {
		$.ui.invalidate("ui.render");
	} catch {}
}
function resetCache($) {
	cacheExpires = 0;
	cacheTtl = "1h";
	lastResponseAt = undefined;
	coldCompacted = false;
	compactQueued = false;
	shownMinutes = null;
	try {
		$.ui.invalidate("ui.render");
	} catch {}
}
async function cacheTick($, autoCompactPercent) {
	if (cacheExpires <= 0 && shownMinutes === null) return;
	const expires = cacheExpires;
	const now = await $.clock.now();
	if (cacheExpires !== expires) return;
	const minutes = minutesLeft(expires, now);
	showMinutes($, minutes);
	if (turnRunning || autoCompactPercent <= 0 || minutes !== 0 || coldCompacted) return;
	const percent = (await $.session.usage()).context.percent ?? 0;
	if (!Number.isFinite(percent) || percent < autoCompactPercent || coldCompacted || turnRunning || cacheExpires !== expires) return;
	coldCompacted = true;
	await $.command.run({
		command: "compact",
		args: ""
	}).catch((err) => $.ui.status(`jev: auto-compact failed: ${String(err)}`.slice(0, 80)));
}
async function* cacheWatch($, original, request, run) {
	const result = yield* run;
	if (original.agentId === undefined && result.usage && request.model === original.model) {
		try {
			const now = await $.clock.now();
			cacheTtl = nextTtl(result.usage, cacheTtl, lastResponseAt === undefined ? undefined : now - lastResponseAt);
			lastResponseAt = now;
			cacheExpires = now + CACHE_TTL[cacheTtl];
			coldCompacted = false;
			showMinutes($, minutesLeft(cacheExpires, now));
		} catch {}
	}
	return result;
}
async function withJevRanking($, e) {
	if ((await jevMissing($)).length) return e;
	if (e.trigger !== "manual" && e.trigger !== "auto") return e;
	const items = compactItems(e.messages);
	if (items.length < 3) return e;
	const request = turnOf([...e.messages])?.request ?? "";
	const questions = {};
	items.forEach((it, i) => {
		questions[`item_${i}`] = {
			type: "score",
			instructions: `How relevant is this earlier tool call and its result to continuing the work on \`request\`? Call: ${it.label}. Result: ${it.result || "(no output)"}`,
			criteria: RELEVANCE
		};
	});
	const r = await askJev($, {
		request: clip(request, 2e3),
		item_count: items.length
	}, questions, true);
	if (!r.ok) return e;
	const scores = items.map((_, i) => score(r.answers, `item_${i}`)?.score);
	const added = compactInstructions(items, scores);
	const keep = scores.filter((s) => (s ?? 0) >= 2.2).length;
	const drop = scores.filter((s) => s !== undefined && s < .8).length;
	await record($, {
		kind: "compact",
		applied: added !== undefined,
		text: `${e.trigger} compaction: ${items.length} results scored, keep ${keep}, drop ${drop}`,
		ms: r.ms,
		data: {
			trigger: e.trigger,
			items: items.length,
			keep,
			drop
		}
	}).catch(() => undefined);
	return added ? {
		...e,
		instructions: e.instructions ? `${e.instructions}\n\n${added}` : added
	} : e;
}
function jevMissing($) {
	return jevTools ??= (toolListing = $.tool.list()).then((t) => missingJevTools(t.map((x) => x.name))).catch(() => [...JEV_TOOLS]).then(async (missing) => {
		if (jevState !== undefined) await jevApply($, missing);
		return missing;
	});
}
async function jevApply($, missing) {
	const key = missing.join(", ");
	const changed = key !== jevState;
	if (!changed && !bandStale && (key || estimateRegistered)) return;
	jevState = key;
	bandStale = false;
	try {
		$.ui.invalidate("ui.render");
	} catch {}
	if (key) {
		await record($, {
			kind: "error",
			applied: false,
			text: `inactive: jev-api tools missing (${key})`
		}).catch(() => undefined);
		return;
	}
	try {
		if (!estimateRegistered) await $.tool.register(ESTIMATE_SPEC);
		estimateRegistered = true;
	} catch (err) {
		await record($, {
			kind: "error",
			applied: false,
			text: `estimate_effort not registered: ${String(err)}`
		}).catch(() => undefined);
	}
}
async function readLog($) {
	return await $.store.get(LOG_KEY) ?? [];
}
async function stats($) {
	return await $.store.get("stats") ?? {};
}
let storeQueue = Promise.resolve();
const pending = [];
async function record($, d) {
	const entry = {
		...d,
		at: await $.clock.now().catch(() => Date.now())
	};
	remember(entry);
	pending.push(entry);
	if (d.kind !== "outcome" && d.kind !== "turn") void $.ui.status(head(`jev: ${d.text}`, 80));
}
async function flushLog($) {
	if (!pending.length) return storeQueue;
	const entries = pending.splice(0);
	const run = storeQueue.then(async () => {
		const log = await readLog($);
		await $.store.set(LOG_KEY, [...log, ...entries].slice(-MAX_ENTRIES));
		const tally = await stats($);
		for (const key of entries.map(statsKey)) tally[key] = (tally[key] ?? 0) + 1;
		await $.store.set("stats", tally);
	});
	storeQueue = run.catch(() => undefined);
	await storeQueue;
}
async function clearLog($) {
	pending.length = 0;
	forgetRecent();
	const run = storeQueue.then(async () => {
		await $.store.set(LOG_KEY, []);
		await $.store.set("stats", {});
	});
	storeQueue = run.catch(() => undefined);
	await run;
}
async function readTurn($, agentId) {
	return turnOf(await $.session.messages(agentId ? { agentId } : {}));
}
function turnOf(messages) {
	if (!Array.isArray(messages)) return undefined;
	const own = (t) => t === DONE_PROMPT || t.startsWith(`The ${PLUGIN_NAME} plugin sent a message:\n${DONE_PROMPT}\n`);
	return splitTurn(messages.filter((m) => !(m.role === "user" && own(m.text.trim()))));
}
function previousReply(messages) {
	if (!Array.isArray(messages)) return undefined;
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role === "assistant" && m.text.trim()) return m.text.length > 800 ? `…${m.text.slice(-800).replace(/^[\uDC00-\uDFFF]/, "")}` : m.text;
	}
	return undefined;
}
async function packageRunner($, cwd) {
	const locks = [
		["pnpm-lock.yaml", "pnpm"],
		["yarn.lock", "yarn"],
		["bun.lockb", "bun"],
		["bun.lock", "bun"]
	];
	const found = await Promise.all(locks.map(([file]) => $.fs.exists(`${cwd}/${file}`).catch(() => false)));
	return locks.find((_, i) => found[i])?.[1] ?? "npm";
}
async function projectCommands($, cwd) {
	const out = [];
	const has = (file) => $.fs.exists(`${cwd}/${file}`).catch(() => false);
	const read = (file) => $.fs.read(`${cwd}/${file}`).catch(() => undefined);
	const [git, pkg, makefile, cargo, gomod, pytestIni, conftest, pyproject] = await Promise.all([
		has(".git"),
		read("package.json"),
		read("Makefile"),
		has("Cargo.toml"),
		has("go.mod"),
		has("pytest.ini"),
		has("conftest.py"),
		read("pyproject.toml")
	]);
	if (git) {
		out.push(bash("git status --short && git diff --stat", "Show what changed: which files are modified, staged or untracked, with a per-file count of changed lines"));
		out.push(bash("git diff", "Show the full line-by-line diff of unstaged changes"));
		out.push(bash("git log --oneline -n 15", "Show the 15 most recent commits"));
	}
	if (typeof pkg === "string") {
		let scripts = {};
		try {
			scripts = JSON.parse(pkg.replace(/^\uFEFF/, "")).scripts ?? {};
		} catch {}
		const runner = await packageRunner($, cwd);
		for (const name of Object.keys(scripts).filter((n) => isSafeScript(n) && typeof scripts[n] === "string")) {
			const command = name === "test" ? `${runner} test` : `${runner} run ${name}`;
			out.push(bash(command, `Run the project's "${name}" script (${clipScript(scripts[name])})`));
		}
	}
	if (typeof makefile === "string") {
		const targets = new Set([...makefile.matchAll(/^([A-Za-z][\w-]*):(?!=)/gm)].map((m) => m[1]));
		for (const t of [...targets].filter((t) => SAFE_MAKE.test(t))) out.push(bash(`make ${t}`, `Run the Makefile's "${t}" target`));
	}
	if (cargo) {
		out.push(bash("cargo test", "Run the Rust tests"));
		out.push(bash("cargo check", "Type-check the Rust project"));
		out.push(bash("cargo clippy", "Lint the Rust project"));
	}
	if (gomod) {
		out.push(bash("go test ./...", "Run the Go tests"));
		out.push(bash("go vet ./...", "Vet the Go code"));
		out.push(bash("go build ./...", "Build the Go packages"));
	}
	if (pytestIni || conftest || /\[tool\.pytest/.test(String(pyproject ?? ""))) {
		out.push(bash("python -m pytest -q", "Run the Python tests"));
	}
	return out;
}
async function buildCandidates($, request, steps, calls, stepIndex, cache = newCache()) {
	const { statted } = cache;
	const cwd = await $.session.cwd();
	if (cache.cwd !== cwd) {
		cache.cwd = cwd;
		cache.project = undefined;
	}
	const out = [];
	if (cache.scan.request !== undefined && (cache.scan.request !== request || steps.length < cache.scan.steps)) cache.scan = newScan();
	const { scan } = cache;
	const texts = scan.request === undefined ? [request] : [];
	scan.request = request;
	for (; scan.steps < steps.length; scan.steps++) texts.push(steps[scan.steps].text);
	calls.forEach((c, i) => {
		if (c.text === undefined || scan.calls.has(i)) return;
		scan.calls.add(i);
		texts.push(c.text);
	});
	const alreadyRead = new Set(calls.filter((c) => c.tool === "Read").map((c) => absolute(cwd, String(c.input.file_path))));
	const offered = new Set();
	let reads = 0;
	let probes = 0;
	for (const p of mentionedPaths(texts, scan.paths)) {
		if (reads >= MAX_READS) break;
		if (p.startsWith("~")) continue;
		const file = absolute(cwd, p);
		if (offered.has(file) || alreadyRead.has(file) || !isSafeToOffer(file, cwd)) continue;
		if (!statted.has(file)) {
			if (probes >= MAX_STATS) continue;
			probes += 1;
			statted.set(file, await $.fs.stat(file).catch(() => undefined));
		}
		const stat = statted.get(file);
		if (stat?.kind !== "file" || stat.isLink || stat.size > 2e6) continue;
		out.push({
			key: `read ${p}`,
			description: `Read the file ${p}`,
			tool: "Read",
			input: { file_path: file }
		});
		offered.add(file);
		reads += 1;
	}
	for (const term of quotedTerms(request)) {
		out.push(bash(`grep -rnF --exclude-dir=node_modules --exclude-dir=.git -- '${term}' .`, `Search the project for the text "${term}"`));
	}
	out.push(...cache.project ??= await projectCommands($, cwd));
	if (stepIndex === 0) {
		const allSkills = await offerableSkills($);
		const skills = /\bskills?\b/i.test(request) ? allSkills : relevant(request, allSkills);
		for (const c of skills) {
			out.push({
				key: `skill ${c.name}`,
				description: `Use the skill or command "${c.name}": ${clipScript(c.description)}`,
				tool: "Skill",
				input: { skill: c.name }
			});
		}
		const loaded = new Set(calls.filter((c) => c.tool === "ToolSearch").map((c) => String(c.input.query)));
		const tools = (await (toolListing ?? $.tool.list()).catch(() => [])).filter((t) => t.mcp && !AUTH_TOOL.test(t.name) && !t.name.startsWith(JEV_TOOL_PREFIX) && !loaded.has(`select:${t.name}`));
		for (const t of relevant(request, tools)) {
			out.push({
				key: `load ${t.name}`,
				description: `Load the tool ${t.name}: ${clipScript(t.description)}`,
				tool: "ToolSearch",
				input: {
					query: `select:${t.name}`,
					max_results: 1
				}
			});
		}
	}
	return out.slice(0, MAX_CHOICE_OPTIONS - 1);
}
async function summarizeResult($, request, action, output) {
	const r = await $.model.complete({
		model: SUMMARY_MODEL,
		system: SYSTEM,
		prompt: `Request: ${clip(request, 2e3)}\nAction: ${action}\nOutput:\n${clip(output, 12e3)}`,
		maxTokens: 600,
		timeoutMs: 2e4
	});
	if (!r.isAnswered) return {
		ok: false,
		reason: r.reason
	};
	const text = r.text.trim();
	return text ? {
		ok: true,
		text,
		usage: r.usage
	} : {
		ok: false,
		reason: "empty-reply"
	};
}
function offerableSkills($) {
	return skillList ??= (async () => {
		const commands = await $.command.list().catch(() => []);
		const blocked = new Set(await $.store.get(SKILL_BLOCKLIST_KEY).catch(() => undefined) ?? []);
		return dedupeSkills(commands.filter((c) => (c.source === "plugin" || c.source === "user") && c.name !== "jev" && !BUILTIN_COMMANDS.has(c.name) && !blocked.has(c.name)));
	})();
}
async function skillOptions($, request) {
	const skills = relevant(request, await offerableSkills($)).filter((c) => c.name !== NONE);
	if (!skills.length) return undefined;
	const criteria = { [NONE]: "No listed skill is meant for this request" };
	for (const c of skills) criteria[c.name] = clip(c.description, 160);
	return criteria;
}
function summarizeCalls(calls) {
	if (!calls.length) return "replied";
	const parts = new Map();
	for (const c of calls) {
		const target = typeof c.input.file_path === "string" ? c.input.file_path.split("/").pop() : typeof c.input.command === "string" ? head(c.input.command.replace(/\s+/g, " "), 30) : typeof c.input.skill === "string" ? c.input.skill : "";
		const key = target ? `${c.tool} ${target}` : c.tool;
		parts.set(key, (parts.get(key) ?? 0) + 1);
	}
	return [...parts].map(([k, n]) => n > 1 ? `${k} ×${n}` : k).join(", ");
}
async function recordCompare($, turnId, step, request, answer, candidates, toolUses, measured) {
	const best = bestAction(answer);
	const claudeCalls = toolUses.map((u) => ({
		tool: u.name,
		input: u.input ?? {}
	}));
	const bestCandidate = candidates.find((c) => c.key === best?.key);
	const agree = Boolean(bestCandidate && coversStep(claudeCalls, bestCandidate));
	const claudeUsedCandidate = claudeCalls.some((c) => candidates.some((k) => coversStep([c], k)));
	const claudeSummary = summarizeCalls(claudeCalls);
	await record($, {
		kind: "compare",
		applied: false,
		text: `Claude: ${claudeSummary} · Jev best ${best?.key ?? "none"}${agree ? " ✓" : ""}`,
		turnId,
		data: {
			request: clip(request, 120),
			step,
			measured,
			claudeSummary,
			pick: answer.choice,
			best: best?.key,
			bestP: best?.p,
			claude: claudeCalls.map((c) => c.tool),
			claudeCalls: claudeCalls.map((c) => clip(asText(c.input.command ?? c.input.file_path ?? c.input.skill ?? c.input.query ?? ""), 200)),
			agree,
			claudeUsedCandidate
		}
	});
}
async function blockSkill($, name) {
	try {
		const list = await $.store.get(SKILL_BLOCKLIST_KEY) ?? [];
		if (!list.includes(name)) await $.store.set(SKILL_BLOCKLIST_KEY, [...list, name]);
		skillList = undefined;
	} catch {}
}
async function contextCompact($, e, ready, continued, fromPercent, forcePercent, asked) {
	if (e.agentId !== undefined || compactQueued || fromPercent <= 0 && forcePercent <= 0) return;
	const percent = await fillPercent($);
	const forced = forcePercent > 0 && percent >= forcePercent;
	if (!forced && (fromPercent <= 0 || percent < fromPercent || !ready || continued || e.reason !== "answer")) return;
	let text = `${percent.toFixed(0)}% full, forced`;
	if (!forced) {
		let end = asked?.end;
		if (!asked) {
			const ctx = await readTurn($);
			if (!ctx) return;
			const r = await askJev($, {
				request: clip(ctx.request, 3e3),
				final_message: clip(e.answer ?? "", 2e3),
				recent: summarize(ctx.steps)
			}, { end: taskEndQuestion });
			if (!r.ok) return;
			end = noul(r.answers, "end");
		}
		if (end === undefined || end < .5) return;
		text = `${percent.toFixed(0)}% full, task ended (p=${end.toFixed(2)})`;
	}
	if (compactQueued) return;
	compactQueued = true;
	await record($, {
		kind: "autocompact",
		applied: true,
		text,
		data: {
			percent,
			forced
		}
	}).catch(() => undefined);
	$.command.run({
		command: "compact",
		args: ""
	}).then(() => {
		compactQueued = false;
	}, (err) => {
		compactQueued = false;
		lostCompact = String(err);
	});
}
async function fillPercent($) {
	const reported = (await $.session.usage().catch(() => undefined))?.context.percent ?? 0;
	return Number.isFinite(reported) ? reported : 0;
}
async function checkDone($, e, threshold, withEnd) {
	const agents = await $.agent.list().catch(() => undefined);
	if (!agents) return { unfinished: false };
	const waitingOn = agents.filter((a) => !FINISHED.has(a.status)).length;
	if (waitingOn > 0) {
		await record($, {
			kind: "done",
			applied: false,
			text: `skipped: waiting on ${waitingOn} background task(s)`,
			data: {
				skipped: "background",
				continued: false
			}
		});
		return { unfinished: false };
	}
	const ctx = await readTurn($);
	if (!ctx) return { unfinished: false };
	const r = await askJev($, {
		request: clip(ctx.request, 3e3),
		final_message: clip(e.answer ?? "", 2e3),
		recent: summarize(ctx.steps)
	}, withEnd ? {
		done: doneQuestion,
		end: taskEndQuestion
	} : { done: doneQuestion });
	if (!r.ok) return {
		unfinished: false,
		asked: withEnd ? { end: undefined } : undefined
	};
	const done = noul(r.answers, "done");
	const unfinished = shouldContinue(done, threshold);
	await record($, {
		kind: "done",
		applied: unfinished,
		text: unfinished ? `not finished (p=${(done ?? 0).toFixed(2)}), continuing` : `finished (p=${(done ?? 0).toFixed(2)})`,
		ms: r.ms,
		data: {
			p: done,
			continued: unfinished
		}
	});
	return {
		unfinished,
		asked: withEnd ? { end: noul(r.answers, "end") } : undefined
	};
}
export const register = (on, options) => {
	const routing = options.routing === "model" || options.routing === "off" ? options.routing : "effort";
	const takeSteps = options.takeSteps !== false;
	const doneCheck = options.doneCheck !== false;
	const takeThreshold = typeof options.takeThreshold === "number" ? options.takeThreshold : .85;
	const subagents = options.subagents !== false;
	const bypass = options.bypass !== false;
	const takeOnlyForBypass = options.takeOnlyForBypass !== false;
	const measureSteps = options.measureSteps !== false;
	const threshold = (key, fallback) => {
		const v = options[key];
		return typeof v === "number" ? v : fallback;
	};
	const doneThreshold = threshold("doneThreshold", .15);
	const configuredRange = bounds(options.minEffort, options.maxEffort);
	const effortRange = configuredRange ?? {
		minEffort: "low",
		maxEffort: "xhigh"
	};
	const badRange = !configuredRange && (options.minEffort !== undefined || options.maxEffort !== undefined) ? `minEffort ${String(options.minEffort)}, maxEffort ${String(options.maxEffort)}` : undefined;
	const jevRanking = options.compaction !== false;
	const haikuCompact = options.haikuCompact !== false;
	const autoCompactPercent = threshold("autoCompactPercent", 60);
	const taskCompactPercent = threshold("taskCompactPercent", 80);
	const forceCompactPercent = threshold("forceCompactPercent", 95);
	on("ui.render", {
		component: "CommandOutput",
		props: { command: "jev" }
	}, function onRenderJev($, e, next) {
		if (e.props.isErrored) return next(e);
		const { Markdown } = $.ui.resolve(e);
		return Markdown({ text: e.props.text });
	});
	let band = {};
	let autoOff = false;
	on("ui.render", { component: "AbovePrompt" }, async function onRenderBand($, e, next) {
		const effortRow = routing !== "off" && jevState === "";
		if (e.props.hasSurvey || !effortRow && shownMinutes === null) return next(e);
		const { Box, Text, Button } = $.ui.resolve(e);
		const color = shownMinutes === null ? undefined : cacheColor(shownMinutes);
		const cache = shownMinutes === null ? [] : [Text({
			...color ? { color } : { dimColor: true },
			children: [` ${cacheLabel(shownMinutes)}`]
		})];
		if (!effortRow) return Box({
			flexDirection: "column",
			children: [Box({
				flexDirection: "row",
				children: cache
			}), await next(e)]
		});
		return Box({
			flexDirection: "row",
			children: [
				...EFFORT_ORDER.filter((level) => inBandRange(level, effortRange) || level === band.configured || level === band.chosen).map((level) => Text({
					...level === band.configured ? { bold: true } : {},
					...level === band.chosen ? { color: "blue" } : {},
					...level !== band.configured && level !== band.chosen ? { dimColor: true } : {},
					children: [`${level} `]
				})),
				Button({
					key: "auto",
					label: `Jev auto: ${autoOff ? "off" : "on"}`,
					onPress: () => {
						autoOff = !autoOff;
						try {
							$.ui.invalidate("ui.render");
						} catch {
							bandStale = true;
						}
					}
				}),
				...cache
			]
		});
	});
	let donePending = false;
	let sessionEpoch = 0;
	let followUpEpoch = 0;
	let lostFollowUp;
	let agentTurn = 0;
	on("prompt.submit", async function onPromptSubmit($, e, next) {
		if ((await jevMissing($)).length) return next(e);
		if (e.origin?.kind === "plugin" && e.origin.name === PLUGIN_NAME) {
			if (followUpEpoch !== sessionEpoch) return { drop: "jevfort: done follow-up dropped, the conversation was cleared" };
			donePending = true;
			return next(e);
		}
		if (e.origin?.kind === "composer" && !e.isMeta && e.turnId === undefined) donePending = false;
		if (options.classify === false || e.command || e.isMeta || e.origin?.kind === "task-notification" || e.text.trim().length < 3) return next(e);
		const skillCriteria = await skillOptions($, e.text);
		const questions = promptQuestions(skillCriteria);
		const previous = previousReply(await $.session.messages({}).catch(() => undefined));
		const r = await askJev($, {
			request: clip(e.text, 3e3),
			...previous ? { previous_reply: previous } : {}
		}, questions);
		if (!r.ok) return next(e);
		const kind = choice(r.answers, "kind");
		const needsPlan = noul(r.answers, "needs_plan");
		const skillAnswer = choice(r.answers, "skill");
		const skill = skillAnswer && skillCriteria && Object.hasOwn(skillCriteria, skillAnswer.choice) ? {
			name: skillAnswer.choice,
			p: skillAnswer.probabilities[skillAnswer.choice] ?? 0
		} : undefined;
		const added = hints(kind?.choice, needsPlan, skill, takeSteps && !takeOnlyForBypass ? takeThreshold : Number.POSITIVE_INFINITY);
		await record($, {
			kind: "classify",
			applied: added.length > 0,
			text: `${kind?.choice ?? "?"}${needsPlan !== undefined ? `, plan ${needsPlan.toFixed(2)}` : ""}${skill && skill.name !== NONE ? `, skill ${skill.name} ${skill.p.toFixed(2)}` : ""}${added.length ? " → hint" : ""}`,
			ms: r.ms,
			data: {
				request: clip(e.text, 120),
				kind: kind?.choice,
				kindP: kind?.confidence,
				needsPlan,
				skill: skill?.name,
				skillP: skill?.p,
				hints: added.length
			}
		});
		if (!added.length) return next(e);
		return next({
			...e,
			context: [...e.context ?? [], ...added]
		});
	});
	if (options.agentTypes !== false) {
		const offered = new Map();
		on("agent.offer", async function onAgentOffer($, e, next) {
			if ((await jevMissing($)).length) return next(e);
			const r = await next(e);
			if (r?.isOffered === false) offered.delete(e.agent);
			else offered.set(e.agent, {
				description: e.description,
				turn: agentTurn
			});
			return r;
		});
		on("tool.call", { tool: "Agent" }, async function onAgentCall($, e, next) {
			if ((await jevMissing($)).length) return next(e);
			const claudeType = e.subagent_type ?? "";
			const latest = Math.max(...[...offered.values()].map((o) => o.turn));
			for (const [name, o] of offered) if (o.turn < latest) offered.delete(name);
			if (offered.size < 2 || claudeType === "fork") return next(e);
			const criteria = {};
			for (const [name, o] of [...offered].slice(0, MAX_CHOICE_OPTIONS)) criteria[name] = clip(o.description, 200);
			const r = await askJev($, {
				task: clip(e.prompt, 3e3),
				description: e.description
			}, { agent_type: {
				type: "choice",
				instructions: "Which agent type is best suited to carry out `task`?",
				criteria
			} });
			if (!r.ok) return next(e);
			const answer = choice(r.answers, "agent_type");
			if (!answer) return next(e);
			const p = answer.probabilities[answer.choice] ?? 0;
			const canSwitch = GENERAL.has(claudeType) && !GENERAL.has(answer.choice) && Object.hasOwn(criteria, answer.choice) && p >= SWITCH_AT;
			await record($, {
				kind: "agent",
				applied: canSwitch,
				text: `Claude ${claudeType || "(default)"} · Jev ${answer.choice} p=${p.toFixed(2)}${canSwitch ? " → switched" : ""}`,
				ms: r.ms,
				data: {
					claude: claudeType || "general-purpose",
					jev: answer.choice,
					p,
					switched: canSwitch,
					agree: answer.choice === (claudeType || "general-purpose")
				}
			});
			return canSwitch ? next({
				...e,
				subagent_type: answer.choice
			}) : next(e);
		});
	}
	on("session.compact", async function onCompact($, e, next) {
		if (e.agentId) return next(e);
		const ranked = jevRanking ? await withJevRanking($, e) : e;
		const passOn = async () => {
			const r = await next(ranked);
			if (e.trigger !== "precompute" && r?.skip === undefined) {
				cacheExpires = 0;
				compactQueued = false;
			}
			return r;
		};
		if (!haikuCompact) return passOn();
		if (e.trigger === "precompute") return { skip: "jevfort compacts with Haiku when it is time" };
		const transcript = haikuTranscript(ranked.messages);
		if (transcript === undefined) return passOn();
		const note = ranked.instructions?.trim();
		const r = await $.model.complete({
			model: COMPACT_MODEL,
			system: COMPACT_SYSTEM,
			prompt: `${transcript}\n\n---\nWrite the summary now.${note ? `\nThe summary should keep or stress: ${note}` : ""}`,
			maxTokens: COMPACT_MAX_TOKENS,
			timeoutMs: 24e4
		}).catch((err) => ({
			isAnswered: false,
			reason: String(err).slice(0, 80)
		}));
		const text = r.isAnswered ? r.text.trim() : "";
		const written = text.length > 200 && r.isAnswered && r.usage.output_tokens < COMPACT_MAX_TOKENS;
		await record($, {
			kind: "summary",
			applied: written,
			text: written ? `${e.trigger} compaction written by ${COMPACT_MODEL}` : `${COMPACT_MODEL} could not compact (${r.isAnswered ? "empty or cut-off summary" : r.reason}), Claude Code does it`
		}).catch(() => undefined);
		if (!written) return passOn();
		cacheExpires = 0;
		compactQueued = false;
		return { messages: [{
			role: "user",
			text: `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation, written by Haiku 5.5 for jevfort.\n\n${text}\n\nContinue the conversation from where it left off without asking the user any further questions.`,
			toolUses: []
		}] };
	});
	const turns = new Map();
	const firstTurns = new Map();
	const ownCalls = new Set();
	let scratchpad;
	const forgetConversation = () => {
		firstTurns.clear();
		forgetRecent();
		band = {};
		autoOff = false;
		scratchpad = undefined;
	};
	on("session.start", async function onSessionStart($, e, next) {
		sessionEpoch += 1;
		forgetConversation();
		resetCache($);
		jevState = undefined;
		estimateRegistered = false;
		bandStale = false;
		cacheTimer?.cancel();
		cacheTimer = $.clock.every(CACHE_TICK_MS, () => void cacheTick($, autoCompactPercent).catch(() => undefined));
		if (badRange) await record($, {
			kind: "error",
			applied: false,
			text: `invalid effort bounds (${badRange}): using low..xhigh`
		}).catch(() => undefined);
		await $.command.register({
			name: "jev",
			description: "Jev pilot: status, /jev report, /jev candidates, /jev export, /jev clear"
		}).catch((err) => record($, {
			kind: "error",
			applied: false,
			text: `/jev not registered: ${err instanceof Error ? err.message : String(err)}`
		}).catch(() => undefined));
		const result = await next(e);
		dropTurnReads();
		await jevApply($, await jevMissing($));
		toolListing = undefined;
		return result;
	});
	on("session.end", async function onSessionEnd($, e, next) {
		sessionEpoch += 1;
		forgetConversation();
		resetCache($);
		await flushLog($);
		return next(e);
	});
	on("command.run", { command: "jev" }, async function onJevCommand($, e) {
		try {
			const arg = e.args.trim();
			await flushLog($);
			if (arg === "report") {
				return { text: buildReport(await readLog($), takeThreshold) };
			}
			if (arg === "candidates") {
				const ctx = await readTurn($);
				const list = await buildCandidates($, ctx?.request ?? "", [], [], 0);
				const kind = (c) => c.tool === "Skill" ? "Skills" : c.tool === "ToolSearch" ? "Tools to load" : c.tool === "Read" ? "File reads" : "Commands";
				const groups = new Map();
				for (const c of list) groups.set(kind(c), [...groups.get(kind(c)) ?? [], c]);
				const sections = [...groups].map(([name, items]) => `### ${name} (${items.length})\n\n| Option | Description |\n|---|---|\n` + items.map((c) => `| \`${escapePipes(c.key)}\` | ${escapePipes(c.description).replace(/\s+/g, " ")} |`).join("\n"));
				return { text: [
					`## Jev candidates: ${list.length + 1} options`,
					`_For the last prompt: "${clip(ctx?.request ?? "(none)", 60)}". Plus \`claude\`: leave the step to Claude._`,
					...sections
				].join("\n\n") };
			}
			if (arg === "clear") {
				await clearLog($);
				return { text: "Jev pilot: log cleared." };
			}
			if (arg === "export") {
				const log = await readLog($);
				const path = `${await $.session.cwd()}/.jev/decisions-${await $.clock.now().catch(() => Date.now())}.jsonl`;
				try {
					if (await $.fs.exists(path)) return { text: `Jev pilot: ${path} exists, nothing written` };
					await $.fs.write(path, log.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
					return { text: `Jev pilot: wrote ${log.length} entries to ${path}` };
				} catch (err) {
					return { text: `Jev pilot: could not write ${path}: ${err instanceof Error ? err.message : String(err)}` };
				}
			}
			const missing = await jevMissing($);
			const counts = Object.entries(await stats($).catch(() => ({ unreadable: 1 }))).map(([k, v]) => `${k}=${v}`).join(", ") || "none yet";
			const lines = recentDecisions().slice(-10).map((d) => `- ${d.kind}${d.applied ? "" : " (pass)"}: ${d.text}${d.ms !== undefined ? ` [${Math.round(d.ms)}ms]` : ""}`);
			return { text: [
				...missing.length ? [`Jev pilot: inactive, the jev-api tools are missing (${missing.join(", ")}). jevfort needs jev-api 0.2.0 or later and no permissions.deny rule matching its tools; it looks again at the next turn.`] : [],
				`Jev pilot: routing ${routing}${autoOff ? " (effort auto off)" : ""}, take steps ${takeSteps} (p ≥ ${takeThreshold}), done check ${doneCheck}, subagents ${subagents}`,
				`Decisions (all sessions): ${counts}`,
				lines.length ? `Recent:\n${lines.join("\n")}` : "No decisions this session yet.",
				"Full analysis: /jev report"
			].join("\n") };
		} finally {
			if (!turnRunning) dropTurnReads();
		}
	});
	on("turn.complete", async function onTurnComplete($, e, next) {
		if (e.agentId === undefined) {
			turnRunning = false;
			agentTurn += 1;
		}
		const missing = await jevMissing($);
		if (e.agentId === undefined) dropTurnReads();
		if (missing.length) {
			await contextCompact($, e, false, false, taskCompactPercent, forceCompactPercent).catch(() => undefined);
			await flushLog($);
			return next(e);
		}
		turns.delete(e.turnId);
		if (e.reason === "aborted" || e.reason === "error") {
			await record($, {
				kind: "turn",
				applied: false,
				text: `turn ${e.reason}`,
				turnId: e.turnId,
				data: { reason: e.reason }
			});
		}
		if (lostFollowUp !== undefined) {
			await record($, {
				kind: "error",
				applied: false,
				text: `done follow-up not sent: ${lostFollowUp}`
			}).catch(() => undefined);
			lostFollowUp = undefined;
		}
		if (lostCompact !== undefined) {
			await record($, {
				kind: "error",
				applied: false,
				text: `context compaction refused: ${lostCompact}`
			}).catch(() => undefined);
			lostCompact = undefined;
		}
		let continued = false;
		let asked;
		if (e.agentId === undefined) {
			const exempt = donePending;
			donePending = false;
			if (doneCheck && !exempt && e.reason === "answer") {
				try {
					const epoch = sessionEpoch;
					const fill = taskCompactPercent > 0 && !compactQueued ? await fillPercent($) : 0;
					const withEnd = taskCompactPercent > 0 && fill >= taskCompactPercent && !(forceCompactPercent > 0 && fill >= forceCompactPercent);
					const done = await checkDone($, e, doneThreshold, withEnd);
					asked = done.asked;
					if (done.unfinished) {
						continued = true;
						followUpEpoch = epoch;
						$.prompt.submit({ text: DONE_PROMPT }).catch((err) => {
							donePending = false;
							lostFollowUp = String(err);
						});
					}
				} catch (err) {
					await record($, {
						kind: "error",
						applied: false,
						text: `done check failed: ${String(err)}`
					}).catch(() => undefined);
				}
			}
		}
		await contextCompact($, e, true, continued, taskCompactPercent, forceCompactPercent, asked).catch((err) => record($, {
			kind: "error",
			applied: false,
			text: `context compaction check failed: ${String(err)}`
		}).catch(() => undefined));
		await flushLog($);
		if (e.agentId === undefined) haikuPath = undefined;
		return next(e);
	});
	on("tool.call", async function onToolCall($, e, next) {
		if (e.tool === ESTIMATE_TOOL) {
			const input = parseEstimateInput(e);
			if (typeof input === "string") return { deny: `estimate_effort: ${input}` };
			const r = await askJev($, { request: clip(input.prompt, 4e3) }, {
				effort: effortQuestion,
				mechanical: mechanicalQuestion
			});
			const effortAnswer = r.ok ? score(r.answers, "effort") : undefined;
			const est = estimateEffort(effortAnswer, r.ok ? noul(r.answers, "mechanical") : undefined, input);
			await record($, {
				kind: "estimate",
				applied: est.source !== "fallback",
				text: `${input.model}: ${est.effort} (${est.source}${r.ok ? "" : `, ${r.error}`})`,
				ms: r.ms,
				data: {
					model: input.model,
					effort: est.effort,
					source: est.source,
					error: r.ok ? undefined : r.error,
					effortScore: effortAnswer?.score,
					effortConfidence: effortAnswer?.confidence
				}
			});
			return { result: JSON.stringify(est) };
		}
		if ((await jevMissing($)).length) return next(e);
		const result = await next(e);
		if (e.tool_use_id && ownCalls.has(e.tool_use_id)) {
			const isError = result.deny !== undefined || result.isError === true;
			ownCalls.delete(e.tool_use_id);
			await record($, {
				kind: "outcome",
				applied: true,
				text: `${e.tool} ${isError ? "failed" : "ok"}`,
				data: {
					id: e.tool_use_id,
					isError
				}
			});
			const skill = e.skill;
			if (isError && e.tool === "Skill" && typeof skill === "string") await blockSkill($, skill);
		}
		return result;
	});
	on("turn.step", async function* onTurnStep($, e, rawNext) {
		if (e.agentId === undefined) turnRunning = true;
		const next = (request) => cacheWatch($, e, request, rawNext(request));
		if ((await jevMissing($)).length) return yield* next(e);
		if (e.agentId && !subagents) return yield* next(e);
		const turn = turns.get(e.turnId) ?? {
			taken: 0,
			cache: newCache()
		};
		turns.set(e.turnId, turn);
		const messages = await $.session.messages(e.agentId ? { agentId: e.agentId } : {});
		const ctx = turnOf(messages);
		if (!ctx) return yield* next(e);
		const calls = toolCalls(ctx.steps);
		const last = calls.at(-1);
		if (turn.bypassId && e.index > 0) {
			const id = turn.bypassId;
			turn.bypassId = undefined;
			const done = calls.find((c) => c.tool_use_id === id);
			if (done?.text !== undefined && !(done.isError && REFUSED.test(done.text))) {
				const s = await summarizeResult($, ctx.request, turn.bypassAction ?? done.tool, done.text);
				await record($, {
					kind: "bypass",
					applied: s.ok,
					text: s.ok ? `answered with ${SUMMARY_MODEL} after ${turn.bypassAction}` : `summary failed (${s.reason}), Claude answers`,
					turnId: e.turnId,
					data: {
						action: turn.bypassAction,
						model: SUMMARY_MODEL,
						...s.ok ? { usage: s.usage } : { reason: s.reason }
					}
				});
				if (s.ok) {
					const usage = {
						...s.usage,
						model: SUMMARY_MODEL
					};
					yield {
						kind: "text",
						index: 0,
						text: s.text
					};
					yield {
						kind: "stop",
						stopReason: "end_turn",
						usage
					};
					return {
						turnId: e.turnId,
						index: e.index,
						answer: s.text,
						toolUses: [],
						stopReason: "end_turn",
						usage
					};
				}
			}
		}
		const questions = {};
		let candidates = [];
		if (takeSteps && !ctx.command && turn.taken < MAX_TAKES_PER_TURN && (!takeOnlyForBypass || bypass && e.index === 0 && !e.agentId)) {
			candidates = (await buildCandidates($, ctx.request, ctx.steps, calls, e.index, turn.cache)).filter((c) => !(last && sameCall(last, {
				tool: c.tool,
				input: c.input
			})));
			if (candidates.length) questions.next_action = nextActionQuestion(candidates);
		}
		let estimate;
		let held;
		let firstTurn;
		if (routing !== "off" && e.index === 0) {
			if (routing === "model") questions.difficulty = difficultyQuestion;
			const sessionEffort = isEffort(e.effort) ? e.effort : undefined;
			if (!e.agentId) {
				band = sessionEffort ? { configured: sessionEffort } : {};
				$.ui.invalidate("ui.render");
			}
			if (!autoOff) {
				const loop = e.agentId ?? "";
				const first = firstTurns.get(loop);
				const family = modelFamily(e.model);
				const fresh = !first || first.family !== family;
				if (fresh) {
					firstTurn = {
						family,
						from: e.effort
					};
					firstTurns.set(loop, firstTurn);
				}
				estimate = family && sessionEffort && (fresh || EVERY_TURN_MODELS.includes(family)) ? {
					model: family,
					defaultEffort: sessionEffort,
					...effortRange
				} : undefined;
				if (estimate) {
					questions.effort = effortQuestion;
					questions.mechanical = mechanicalQuestion;
				}
				held = !estimate && first?.effort && first.family === family && first.from === e.effort ? first.effort : undefined;
				if (held && held !== e.effort) turn.effort = held;
				if (held && !e.agentId) {
					band.chosen = held;
					$.ui.invalidate("ui.render");
				}
			}
		}
		if (bypass && e.index === 0 && questions.next_action && !e.agentId) questions.single_action = singleActionQuestion;
		const routed = (step) => {
			if (!turn.route && !turn.effort) return step;
			const effort = turn.effort;
			const model = lowerModel(step.model, turn.route?.model);
			return effort || model ? {
				...step,
				...effort ? { effort } : {},
				...model ? { model } : {}
			} : step;
		};
		if (!Object.keys(questions).length) {
			let measure;
			let measured = [];
			if (measureSteps && takeSteps && !ctx.command && e.index > 0 && !e.agentId) {
				measured = (await buildCandidates($, ctx.request, ctx.steps, calls, e.index, turn.cache)).filter((c) => !(last && sameCall(last, {
					tool: c.tool,
					input: c.input
				})));
				if (measured.length) {
					measure = askJev($, {
						request: clip(ctx.request, 4e3),
						recent: summarize(ctx.steps),
						cwd: turn.cache.cwd ??= await $.session.cwd()
					}, { next_action: nextActionQuestion(measured) });
				}
			}
			const claudeResult = yield* next(routed(e));
			let measureResult;
			if (measure) {
				const grace = deadline($, MEASURE_GRACE_MS);
				measureResult = await Promise.race([measure, grace.elapsed]).catch(() => undefined);
				grace.cancel();
			}
			const measureAnswer = measureResult?.ok ? choice(measureResult.answers, "next_action") : undefined;
			if (measureAnswer) await recordCompare($, e.turnId, e.index, ctx.request, measureAnswer, measured, claudeResult.toolUses, true);
			return claudeResult;
		}
		const previous = e.index === 0 && !e.agentId ? previousReply(messages) : undefined;
		const state = {
			request: clip(ctx.request, 4e3),
			...previous ? { previous_reply: previous } : {},
			recent: summarize(ctx.steps),
			cwd: turn.cache.cwd ??= await $.session.cwd()
		};
		const r = await askJev($, state, questions);
		if (!r.ok) {
			await record($, {
				kind: "error",
				applied: false,
				text: `unavailable: ${r.error}`,
				ms: r.ms,
				turnId: e.turnId
			});
			return yield* next(routed(e));
		}
		if (questions.difficulty || estimate) {
			const difficulty = questions.difficulty ? score(r.answers, "difficulty") : undefined;
			turn.route = difficulty ? route(difficulty, "model") : undefined;
			const model = lowerModel(e.model, turn.route?.model);
			const mechanical = noul(r.answers, "mechanical");
			const effortAnswer = estimate ? score(r.answers, "effort") : undefined;
			const est = estimate ? estimateEffort(effortAnswer, mechanical, estimate) : undefined;
			if (est) {
				turn.effort = est.effort !== e.effort ? est.effort : undefined;
				if (firstTurn) firstTurn.effort = est.effort;
				if (!e.agentId) {
					band.chosen = est.effort;
					$.ui.invalidate("ui.render");
				}
			}
			const effort = turn.effort;
			const raised = effort !== undefined && EFFORT_ORDER.indexOf(effort) > (isEffort(e.effort) ? EFFORT_ORDER.indexOf(e.effort) : -1);
			const lowered = Boolean(effort && !raised || model);
			const source = est?.source ?? (held ? "held" : undefined);
			await record($, {
				kind: "route",
				applied: lowered || raised,
				text: `${difficulty ? `difficulty ${difficulty.score.toFixed(2)}` : "effort"} → ${lowered || raised ? `${model ?? e.model}, effort ${effort ?? String(e.effort)}` : "no change"}${source ? ` · ${source}` : ""}`,
				ms: r.ms,
				turnId: e.turnId,
				data: {
					score: difficulty?.score,
					confidence: difficulty?.confidence,
					effort,
					model,
					lowered,
					raised,
					estimate: est?.effort,
					source,
					mechanical,
					effortScore: effortAnswer?.score,
					effortConfidence: effortAnswer?.confidence
				}
			});
		}
		const answer = choice(r.answers, "next_action");
		const best = bestAction(answer);
		const singleAction = noul(r.answers, "single_action") ?? 0;
		const picked = pickCandidate(answer, candidates, takeThreshold);
		const pick = takeOnlyForBypass && (singleAction < SINGLE_ACTION || picked?.tool !== "Read" && picked?.tool !== "Bash") ? undefined : picked;
		if (answer) {
			const p = answer.probabilities[answer.choice] ?? 0;
			await record($, {
				kind: "take",
				applied: pick !== undefined,
				text: `${answer.choice} (p=${p.toFixed(2)})${pick ? "" : best ? `; best action ${best.key} p=${best.p.toFixed(2)}` : ""}`,
				ms: r.ms,
				turnId: e.turnId,
				data: {
					pick: answer.choice,
					p,
					best: best?.key,
					bestP: best?.p,
					candidates: candidates.length,
					threshold: takeThreshold,
					singleAction: noul(r.answers, "single_action"),
					agentId: e.agentId
				}
			});
		}
		if (pick) {
			turn.taken += 1;
			const id = `toolu_jev_${crypto.randomUUID().replace(/-/g, "")}`;
			ownCalls.add(id);
			if (singleAction >= SINGLE_ACTION && (pick.tool === "Read" || pick.tool === "Bash")) {
				turn.bypassId = id;
				turn.bypassAction = pick.key;
			}
			yield {
				kind: "tool",
				index: 0,
				id,
				name: pick.tool
			};
			yield {
				kind: "input",
				index: 0,
				json: JSON.stringify(pick.input)
			};
			yield {
				kind: "stop",
				stopReason: "tool_use",
				usage: null
			};
			return {
				turnId: e.turnId,
				index: e.index,
				answer: "",
				toolUses: [{
					name: pick.tool,
					input: pick.input
				}],
				stopReason: "tool_use",
				usage: null
			};
		}
		const result = yield* next(routed(e));
		if (answer) await recordCompare($, e.turnId, e.index, ctx.request, answer, candidates, result.toolUses, false);
		return result;
	});
	on("tool.check", async function onToolCheck($, e, next) {
		if (e.tool === ESTIMATE_TOOL) {
			const base = await next(e);
			return settled(base) ? base : {
				...base,
				decision: "allow",
				reason: "jevfort: estimate_effort is answered locally"
			};
		}
		if ((await jevMissing($)).length) return next(e);
		const base = await next(e);
		if (e.tool_use_id && ownCalls.has(e.tool_use_id)) {
			if (settled(base) || e.tool === "Read") return base;
			return {
				...base,
				decision: "allow",
				reason: "Jev pilot: vetted action from its read-only/project-script list"
			};
		}
		const input = e.input ?? {};
		if (WRITE_TOOLS.has(e.tool) && !settled(base)) {
			scratchpad ??= {
				roots: [
					await $.env.get("CLAUDE_CODE_TMPDIR"),
					await $.env.get("TMPDIR"),
					"/tmp"
				].filter((r) => Boolean(r)),
				sid: await $.session.id()
			};
			if (inScratchpad(asText(input.file_path ?? input.notebook_path ?? ""), scratchpad.sid, scratchpad.roots)) {
				return {
					...base,
					decision: "allow",
					reason: "jevfort: write inside this session's scratchpad"
				};
			}
		}
		return base;
	});
};
