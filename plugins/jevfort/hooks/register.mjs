import { AUTH_TOOL, BUILTIN_COMMANDS, CACHE_TTL, COMPACT_API_TIMEOUT_S, COMPACT_MAX_TOKENS, COMPACT_MODEL, COMPACT_SYSTEM, COMPACT_TIMEOUT_MS, EFFORT_ORDER, ESTIMATE_SPEC, ESTIMATE_TOOL, EVERY_TURN_MODELS, GENERAL, HAIKU_API_TIMEOUT_S, HAIKU_TIMEOUT_MS, JEV_API_TIMEOUT_S, JEV_BATCH, JEV_TOOLS, JEV_TOOL_PREFIX, MAX_CHOICE_OPTIONS, MAX_ERROR, MAX_PAUSE_MS, MAX_READS, MAX_STATS, PAUSE_MS, RELEVANCE, SAFE_MAKE, SKILL_BLOCKLIST_KEY, SUMMARY_MODEL, SWITCH_AT, SYSTEM, TIMEOUT_MS, absolute, bash, bounds, cacheColor, cacheLabel, choice, clip, clipScript, compactInstructions, compactItems, dedupeSkills, effortQuestion, estimateEffort, haikuTranscript, inBandRange, inScratchpad, isAnswer, isEffort, isSafeScript, isSafeToOffer, mechanicalQuestion, mentionedPaths, minutesLeft, missingJevTools, modelFamily, nextActionQuestion, nextTtl, noul, parseEstimateInput, pickCandidate, quotedTerms, relevant, sameCall, score, singleActionQuestion, splitTurn, summarize, taskEndQuestion, toolCalls } from "./lib.mjs";
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
	const done = (r) => r.ok ? r : {
		ok: false,
		error: clip(r.error, MAX_ERROR)
	};
	if (startedAt < jevPause.until) return {
		ok: false,
		error: `paused for ${Math.ceil((jevPause.until - startedAt) / 1e3)} s after a timeout (${jevPause.error})`
	};
	if (!haikuPath && !turnRunning) readBetweenTurns = true;
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
let readBetweenTurns = false;
function dropTurnReads() {
	readBetweenTurns = false;
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
let cacheTimer;
function redraw($) {
	try {
		$.ui.invalidate("ui.render");
	} catch {}
}
function showMinutes($, minutes) {
	if (minutes === shownMinutes) return;
	shownMinutes = minutes;
	redraw($);
}
function resetCache($) {
	cacheExpires = 0;
	cacheTtl = "1h";
	lastResponseAt = undefined;
	coldCompacted = false;
	compactQueued = false;
	shownMinutes = null;
	redraw($);
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
	}).catch(() => undefined);
}
async function* cacheWatch($, original, run) {
	const result = yield* run;
	if (original.agentId === undefined && result.usage) {
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
	return added ? {
		...e,
		instructions: e.instructions ? `${e.instructions}\n\n${added}` : added
	} : e;
}
function jevMissing($) {
	if (!jevTools && !turnRunning) readBetweenTurns = true;
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
	redraw($);
	if (key) return;
	try {
		if (!estimateRegistered) await $.tool.register(ESTIMATE_SPEC);
		estimateRegistered = true;
	} catch {}
}
async function readTurn($, agentId) {
	return turnOf(await $.session.messages(agentId ? { agentId } : {}));
}
function turnOf(messages) {
	if (!Array.isArray(messages)) return undefined;
	return splitTurn(messages);
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
			const command = name === "test" && runner !== "bun" ? `${runner} test` : `${runner} run ${name}`;
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
		for (const c of relevant(request, await offerableSkills($))) {
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
	}).catch((err) => ({
		isAnswered: false,
		reason: String(err).slice(0, 80)
	}));
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
		return dedupeSkills(commands.filter((c) => (c.source === "plugin" || c.source === "user") && !BUILTIN_COMMANDS.has(c.name) && !blocked.has(c.name)));
	})();
}
function debugEffort($, e, source, chosen) {
	try {
		$.ui.log(`effort ${e.agentId ? `(agent ${e.agentId}) ` : ""}${String(e.model)}: session ${String(e.effort)} → ${chosen ?? "unchanged"} · ${source}`, { to: "debug" });
	} catch {}
}
async function blockSkill($, name) {
	try {
		const list = await $.store.get(SKILL_BLOCKLIST_KEY) ?? [];
		if (!list.includes(name)) await $.store.set(SKILL_BLOCKLIST_KEY, [...list, name]);
		skillList = undefined;
	} catch {}
}
async function contextCompact($, e, ready, fromPercent, forcePercent) {
	if (e.agentId !== undefined || compactQueued || fromPercent <= 0 && forcePercent <= 0) return;
	const percent = await fillPercent($);
	const forced = forcePercent > 0 && percent >= forcePercent;
	if (!forced && (fromPercent <= 0 || percent < fromPercent || !ready || e.reason !== "answer")) return;
	if (!forced) {
		const ctx = await readTurn($);
		if (!ctx) return;
		const r = await askJev($, {
			request: clip(ctx.request, 3e3),
			final_message: clip(e.answer ?? "", 2e3),
			recent: summarize(ctx.steps)
		}, { end: taskEndQuestion });
		if (!r.ok) return;
		const end = noul(r.answers, "end");
		if (end === undefined || end < .5) return;
	}
	if (compactQueued) return;
	compactQueued = true;
	$.command.run({
		command: "compact",
		args: ""
	}).then(() => {
		compactQueued = false;
	}, () => {
		compactQueued = false;
	});
}
async function fillPercent($) {
	const reported = (await $.session.usage().catch(() => undefined))?.context.percent ?? 0;
	return Number.isFinite(reported) ? reported : 0;
}
export const register = (on, options) => {
	const routing = options.routing !== false;
	const takeSteps = options.takeSteps !== false;
	const takeThreshold = typeof options.takeThreshold === "number" ? options.takeThreshold : .85;
	const subagents = options.subagents !== false;
	const bypass = options.bypass !== false;
	const takeOnlyForBypass = options.takeOnlyForBypass !== false;
	const threshold = (key, fallback) => {
		const v = options[key];
		return typeof v === "number" ? v : fallback;
	};
	const configuredRange = bounds(options.minEffort, options.maxEffort);
	const effortRange = configuredRange ?? {
		minEffort: "low",
		maxEffort: "xhigh"
	};
	const jevRanking = options.compaction !== false;
	const haikuCompact = options.haikuCompact !== false;
	const autoCompactPercent = threshold("autoCompactPercent", 60);
	const taskCompactPercent = threshold("taskCompactPercent", 80);
	const forceCompactPercent = threshold("forceCompactPercent", 95);
	let band = {};
	let autoOff = false;
	on("ui.render", { component: "AbovePrompt" }, async function onRenderBand($, e, next) {
		const effortRow = routing && jevState === "";
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
	let agentTurn = 0;
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
			if (offered.size < 2 || !GENERAL.has(claudeType)) return next(e);
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
			const canSwitch = !GENERAL.has(answer.choice) && Object.hasOwn(criteria, answer.choice) && p >= SWITCH_AT;
			return canSwitch ? next({
				...e,
				subagent_type: answer.choice
			}) : next(e);
		});
	}
	on("session.compact", async function onCompact($, e, next) {
		if (e.agentId) return next(e);
		const ranked = jevRanking ? await withJevRanking($, e) : e;
		if (!turnRunning) dropTurnReads();
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
		const focus = ranked.instructions?.trim();
		const r = await $.model.complete({
			model: COMPACT_MODEL,
			system: COMPACT_SYSTEM,
			prompt: `${transcript}\n\n---\nWrite the summary now.${focus ? `\nThe summary should keep or stress: ${focus}` : ""}`,
			maxTokens: COMPACT_MAX_TOKENS,
			timeoutMs: 24e4
		}).catch((err) => ({
			isAnswered: false,
			reason: String(err).slice(0, 80)
		}));
		const text = r.isAnswered ? r.text.trim() : "";
		const written = text.length > 200 && r.isAnswered && r.usage.output_tokens < COMPACT_MAX_TOKENS;
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
		band = {};
		autoOff = false;
		scratchpad = undefined;
	};
	on("session.start", async function onSessionStart($, e, next) {
		forgetConversation();
		resetCache($);
		jevState = undefined;
		estimateRegistered = false;
		bandStale = false;
		cacheTimer?.cancel();
		cacheTimer = $.clock.every(CACHE_TICK_MS, () => void cacheTick($, autoCompactPercent).catch(() => undefined));
		const result = await next(e);
		dropTurnReads();
		await jevApply($, await jevMissing($));
		readBetweenTurns = false;
		toolListing = undefined;
		return result;
	});
	on("session.end", async function onSessionEnd($, e, next) {
		forgetConversation();
		resetCache($);
		return next(e);
	});
	on("turn.complete", async function onTurnComplete($, e, next) {
		if (e.agentId === undefined) {
			turnRunning = false;
			agentTurn += 1;
		}
		turns.delete(e.turnId);
		const missing = await jevMissing($);
		if (!turnRunning) dropTurnReads();
		if (missing.length) {
			await contextCompact($, e, false, taskCompactPercent, forceCompactPercent).catch(() => undefined);
			return next(e);
		}
		await contextCompact($, e, true, taskCompactPercent, forceCompactPercent).catch(() => undefined);
		if (!turnRunning) dropTurnReads();
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
			return { result: JSON.stringify(est) };
		}
		if ((await jevMissing($)).length) return next(e);
		const result = await next(e);
		if (e.tool_use_id && ownCalls.has(e.tool_use_id)) {
			const isError = result.deny !== undefined || result.isError === true;
			ownCalls.delete(e.tool_use_id);
			const skill = e.skill;
			if (isError && e.tool === "Skill" && typeof skill === "string") await blockSkill($, skill);
		}
		return result;
	});
	on("turn.step", async function* onTurnStep($, e, rawNext) {
		if (e.agentId === undefined) {
			if (!turnRunning && readBetweenTurns) dropTurnReads();
			turnRunning = true;
		}
		const next = (request) => cacheWatch($, e, rawNext(request));
		if ((await jevMissing($)).length) return yield* next(e);
		if (e.agentId && !subagents) return yield* next(e);
		const turn = turns.get(e.turnId) ?? {
			taken: 0,
			cache: newCache()
		};
		turns.set(e.turnId, turn);
		if (routing && e.index === 0 && !e.agentId) {
			band = isEffort(e.effort) ? { configured: e.effort } : {};
			redraw($);
		}
		const messages = await $.session.messages(e.agentId ? { agentId: e.agentId } : {});
		const ctx = turnOf(messages);
		const routed = (step) => turn.effort ? {
			...step,
			effort: turn.effort
		} : step;
		const hold = () => {
			const first = firstTurns.get(e.agentId ?? "");
			const family = modelFamily(e.model);
			const held = family && !EVERY_TURN_MODELS.includes(family) && first?.effort && first.family === family && first.from === e.effort ? first.effort : undefined;
			if (!held) return false;
			if (held !== e.effort) turn.effort = held;
			debugEffort($, e, "held", held);
			if (!e.agentId) {
				band.chosen = held;
				redraw($);
			}
			return true;
		};
		if (!ctx) {
			if (routing && e.index === 0 && !autoOff) hold();
			return yield* next(routed(e));
		}
		const calls = toolCalls(ctx.steps);
		const last = calls.at(-1);
		if (turn.bypassId && e.index > 0) {
			const id = turn.bypassId;
			turn.bypassId = undefined;
			const done = calls.find((c) => c.tool_use_id === id);
			if (done?.text !== undefined && !(done.isError && REFUSED.test(done.text))) {
				const s = await summarizeResult($, ctx.request, turn.bypassAction ?? done.tool, done.text);
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
			const build = buildCandidates($, ctx.request, ctx.steps, calls, e.index, turn.cache);
			build.catch(() => undefined);
			const timer = deadline($, TIMEOUT_MS);
			try {
				candidates = (await Promise.race([build, timer.elapsed]) ?? []).filter((c) => !(last && sameCall(last, {
					tool: c.tool,
					input: c.input
				})));
			} finally {
				timer.cancel();
			}
			if (candidates.length) questions.next_action = nextActionQuestion(candidates);
		}
		let estimate;
		let heldApplied = false;
		let firstTurn;
		if (routing && e.index === 0) {
			const sessionEffort = isEffort(e.effort) ? e.effort : undefined;
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
				if (!estimate) heldApplied = hold();
			}
		}
		if (bypass && e.index === 0 && questions.next_action && !e.agentId) questions.single_action = singleActionQuestion;
		if (!Object.keys(questions).length) return yield* next(routed(e));
		const previous = e.index === 0 && !e.agentId ? previousReply(messages) : undefined;
		const state = {
			request: clip(ctx.request, 4e3),
			...previous ? { previous_reply: previous } : {},
			recent: summarize(ctx.steps),
			cwd: turn.cache.cwd ??= await $.session.cwd()
		};
		const r = await askJev($, state, questions);
		if (autoOff && heldApplied) {
			turn.effort = undefined;
			if (!e.agentId) {
				band.chosen = undefined;
				redraw($);
			}
		}
		if (!r.ok) {
			if (estimate) debugEffort($, e, `jev unavailable (${r.error})`, undefined);
			return yield* next(routed(e));
		}
		if (estimate) {
			const mechanical = noul(r.answers, "mechanical");
			const effortAnswer = score(r.answers, "effort");
			const est = estimateEffort(effortAnswer, mechanical, estimate);
			if (firstTurn) firstTurn.effort = est.effort;
			debugEffort($, e, `${est.source}${effortAnswer ? ` (score ${effortAnswer.score.toFixed(2)})` : ""}${autoOff ? " · auto off" : ""}`, autoOff ? undefined : est.effort);
			if (!autoOff) {
				turn.effort = est.effort !== e.effort ? est.effort : undefined;
				if (!e.agentId) {
					band.chosen = est.effort;
					redraw($);
				}
			}
		}
		const answer = choice(r.answers, "next_action");
		const singleAction = noul(r.answers, "single_action") ?? 0;
		const picked = pickCandidate(answer, candidates, takeThreshold);
		const pick = takeOnlyForBypass && (singleAction < SINGLE_ACTION || picked?.tool !== "Read" && picked?.tool !== "Bash") ? undefined : picked;
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
		return yield* next(routed(e));
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
			const target = e.tool === "NotebookEdit" ? input.notebook_path : input.file_path;
			if (inScratchpad(asText(target ?? ""), scratchpad.sid, scratchpad.roots)) {
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
