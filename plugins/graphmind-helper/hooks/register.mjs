import { binaryDirs, entryId, fit, isCodePrompt, isRecallable, listing, NUDGE, resolveTools, searchTerms, SETUP_SCRIPTS, shouldNudge } from "./terms.mjs";
const TOAST_MS = 15e3;
const TOOLS_TTL_MS = 3e4;
const NEGATIVE_TTL_MS = 3e4;
const SEARCH_TTL_MS = 18e4;
const RUN_MS = 1e4;
const CHECKPOINT_EVERY = 10;
const AUTO_MEMORY = "Auto-memory is ON: save decisions/patterns/conventions via gm_memory_add. Use --priority for always-injected facts. Recall via gm_memory_search.";
let state = fresh();
function fresh() {
	return {
		ready: new Map(),
		briefed: false,
		nudged: false,
		turns: 0,
		shown: new Set(),
		searched: new Map()
	};
}
function textOf(r) {
	if (r.deny !== undefined || r.isError === true) return undefined;
	if (typeof r.text === "string" && r.text !== "") return r.text;
	if (typeof r.result === "string") return r.result || undefined;
	if (!Array.isArray(r.result)) return undefined;
	const parts = r.result.map((p) => p && typeof p === "object" && typeof p.text === "string" ? p.text : "").filter((t) => t !== "");
	return parts.length ? parts.join("\n") : undefined;
}
async function callText($, tool, cwd, input = {}) {
	return textOf(await $.tool.call({
		tool,
		project: cwd,
		...input
	}).catch(() => ({ deny: "failed" })));
}
async function graphmindBin($, now) {
	if (state.bin) return state.bin;
	if (state.binMissAt !== undefined && now - state.binMissAt < NEGATIVE_TTL_MS) return undefined;
	const [home, pathVar] = await Promise.all([$.env.get("HOME"), $.env.get("PATH")]);
	const candidates = binaryDirs(pathVar, home).map((d) => `${d}/graphmind`);
	const found = await Promise.all(candidates.map((p) => $.fs.stat(p).then((s) => s.kind !== "dir", () => false)));
	state.bin = candidates.find((_, i) => found[i]);
	state.binMissAt = state.bin ? undefined : now;
	return state.bin;
}
async function cli($, bin, args, cwd) {
	try {
		const r = await $.process.run([bin, ...args], {
			cwd,
			timeoutMs: RUN_MS
		});
		return r.exitCode === 0 ? r.stdout : "";
	} catch {
		return "";
	}
}
async function setupWired($) {
	if (state.wired !== undefined) return state.wired;
	let wired = false;
	try {
		const [home, configDir] = await Promise.all([$.env.get("HOME"), $.env.get("CLAUDE_CONFIG_DIR")]);
		const dir = configDir || (home ? `${home}/.claude` : "");
		const file = dir ? `${dir}/settings.json` : "";
		if (file && await $.fs.exists(file)) {
			const text = await $.fs.read(file);
			wired = SETUP_SCRIPTS.some((s) => text.includes(s));
		}
	} catch {}
	state.wired = wired;
	return wired;
}
async function graphmindTools($, now) {
	if (state.tools && now - state.tools.at < TOOLS_TTL_MS) return state.tools.tools;
	if (state.toolsMissAt !== undefined && now - state.toolsMissAt < NEGATIVE_TTL_MS) return undefined;
	const tools = resolveTools(await $.tool.list().catch(() => []));
	state.tools = tools ? {
		at: now,
		tools
	} : undefined;
	state.toolsMissAt = tools ? undefined : now;
	return tools;
}
async function usable($) {
	if (await setupWired($)) return undefined;
	const now = await $.clock.now();
	const [bin, tools, cwd] = await Promise.all([
		graphmindBin($, now),
		graphmindTools($, now),
		$.session.cwd()
	]);
	if (!bin || !tools) return undefined;
	const known = state.ready.get(cwd);
	let status;
	if (known && (known.status !== undefined || now - known.at < NEGATIVE_TTL_MS)) status = known.status;
	else {
		status = await callText($, tools.status, cwd);
		if (state.ready.size > 20) state.ready.clear();
		state.ready.set(cwd, {
			status,
			at: now
		});
	}
	return status === undefined ? undefined : {
		bin,
		tools,
		cwd,
		now,
		status
	};
}
async function recallFor($, prompt, signal) {
	if (!isRecallable(prompt)) return [];
	const use = await usable($);
	if (!use) return [];
	const { bin, tools, cwd, now, status } = use;
	const terms = searchTerms(prompt);
	const last = terms ? state.searched.get(terms) : undefined;
	const search = terms !== "" && (last === undefined || now - last >= SEARCH_TTL_MS);
	const briefing = !state.briefed;
	const [priorityRaw, memoryRaw, code, map, recent] = await Promise.all([
		cli($, bin, [
			"memory",
			"list",
			"--priority",
			"--limit",
			"20",
			"--max-chars",
			"250"
		], cwd),
		search ? cli($, bin, [
			"memory",
			"search",
			terms,
			"--limit",
			"5",
			"--max-chars",
			"300",
			"--no-recall"
		], cwd) : "",
		search && isCodePrompt(prompt) ? callText($, tools.search, cwd, {
			query: terms,
			limit: 5,
			code_only: true
		}) : undefined,
		briefing ? callText($, tools.map, cwd, { limit: 20 }) : undefined,
		briefing ? callText($, tools.memoryList, cwd, { limit: 10 }) : undefined
	]);
	if (signal?.aborted) return [];
	state.turns++;
	const checkpoint = state.turns % CHECKPOINT_EVERY === 0 ? `[graphmind checkpoint — prompt ${state.turns}] Review the last ${CHECKPOINT_EVERY} prompts. Call gm_session_analyze with an array of facts (decisions, conventions, bugs, constraints) that emerged — it batch-saves and deduplicates in one call. Use priority=true for facts needed every session.\n\n` : "";
	if (search) {
		if (state.searched.size > 50) state.searched.clear();
		state.searched.set(terms, now);
	}
	const priority = listing(priorityRaw).filter((l) => entryId(l) !== undefined);
	const pids = new Set(priority.flatMap((l) => entryId(l) ?? []));
	const skip = new Set([...state.shown, ...pids]);
	const found = search ? [{
		title: "[graphmind memory] Relevant:",
		lines: listing(memoryRaw).filter((l) => !l.startsWith("!") && !skip.has(entryId(l) ?? "")).slice(0, 5)
	}, {
		title: "[graphmind code] Relevant symbols:",
		lines: (code ?? "").split("\n").slice(0, 30)
	}] : [];
	let head = checkpoint;
	let blocks;
	if (briefing) {
		head = `[graphmind] Project indexed and ready. Use MCP tools (gm_search, gm_fn, gm_deps, gm_map, gm_outline, gm_query) for code exploration.\n\n${checkpoint}`;
		blocks = [
			{
				title: "Project status:",
				lines: status.split("\n").slice(0, 10)
			},
			{
				title: "Structure:",
				lines: (map ?? "").split("\n").slice(0, 20)
			},
			{
				title: "★ Priority context (always active):",
				lines: priority
			},
			{
				title: "Recent memories:",
				lines: listing(recent ?? "").filter((l) => !pids.has(/\(id: ([0-9a-f]{8})/.exec(l)?.[1] ?? "")).slice(0, 5)
			},
			{
				title: "",
				lines: [AUTO_MEMORY]
			}
		];
	} else {
		blocks = [{
			title: "[graphmind ★ new priority context]",
			lines: priority.filter((l) => !state.shown.has(entryId(l) ?? ""))
		}, ...found];
	}
	const out = fit(head, blocks);
	const rec = briefing ? fit("", found).text.trimEnd() : "";
	for (const l of priority) {
		const id = entryId(l);
		if (id && out.whole.has(l)) state.shown.add(id);
	}
	state.briefed = true;
	return [out.text.trimEnd(), rec].filter(Boolean);
}
async function onSessionStart($, e, next) {
	state = fresh();
	const r = await next(e);
	void $.clock.now().then((now) => graphmindBin($, now)).then((bin) => {
		if (!bin) $.ui.toast("graphmind-helper: the graphmind binary was not found (PATH, ~/.graphmind/bin, ~/.local/bin, /usr/local/bin); the plugin's recall, nudge and MCP server stay off until it is installed (https://github.com/aouicher/graphmind)", { timeoutMs: TOAST_MS });
	}).catch(() => {});
	return r;
}
async function onSessionEnd(_$, e, next) {
	state = {
		...fresh(),
		bin: state.bin,
		wired: state.wired
	};
	return next(e);
}
async function onSessionCompact(_$, e, next) {
	const r = await next(e);
	const skipped = r !== null && typeof r === "object" && r.skip !== undefined;
	if (e.trigger === "precompute" || e.agentId !== undefined || skipped) return r;
	state = {
		...fresh(),
		bin: state.bin,
		wired: state.wired,
		tools: state.tools,
		ready: state.ready
	};
	return r;
}
async function onPromptSubmit($, e, next) {
	if (e.origin?.kind === "plugin" || e.isMeta || e.command) return next(e);
	const added = await recallFor($, e.text, next.signal).catch(() => []);
	return next(added.length ? {
		...e,
		context: [...e.context ?? [], ...added]
	} : e);
}
async function onToolCall($, e, next) {
	const r = await next(e);
	if (state.nudged || !shouldNudge(e)) return r;
	try {
		if (!await usable($)) return r;
		if (next.signal?.aborted || state.nudged) return r;
		state.nudged = true;
		return {
			...r,
			context: [...Array.isArray(r.context) ? r.context : [], NUDGE]
		};
	} catch {
		return r;
	}
}
export const register = (on) => {
	on("session.start", onSessionStart);
	on("session.end", onSessionEnd);
	on("session.compact", onSessionCompact);
	on("prompt.submit", onPromptSubmit);
	on("tool.call", onToolCall);
};
