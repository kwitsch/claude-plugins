import { DEFAULT_CONTEXT_TOKENS, DEFAULT_DENSITY, DEFAULT_OVERFLOW, DEFAULT_TIMEOUT_S, HAIKU_MAX_CHARS, PLUGIN, REGISTER_WAIT_MS, SERVER_TOOL_PREFIX, TOOLS, TOOL_PREFIX, answerJev, askHaiku, configureServer, cutState, ensureTools, fail, isOverflow, loadKnowledge, message, newLink, parseInput, seconds, untilAbort } from "./lib.mjs";
export function register(on, options) {
	const fallbackS = seconds(options?.["timeout"]) ?? DEFAULT_TIMEOUT_S;
	const optionOverflow = options?.["overflow"];
	const defaultOverflow = isOverflow(optionOverflow) ? optionOverflow : DEFAULT_OVERFLOW;
	const names = new Map(TOOLS.map((t) => [TOOL_PREFIX + t, t]));
	const st = {
		names,
		missing: new Set(TOOLS),
		pending: new Map(),
		gen: 0,
		retryAt: new Map(),
		failures: new Map(),
		stuck: new Set()
	};
	const know = {
		density: DEFAULT_DENSITY,
		persisted: DEFAULT_DENSITY,
		samples: 0,
		nctx: DEFAULT_CONTEXT_TOKENS,
		loaded: undefined
	};
	const link = newLink();
	on("session.start", async function onSessionStart($, e, next) {
		try {
			st.gen++;
			st.retryAt.clear();
			st.failures.clear();
			st.stuck.clear();
			if (st.missing.size > 0) await ensureTools($, st, 5 * REGISTER_WAIT_MS);
		} catch {}
		try {
			const [key, base, jevUrl, model] = (await Promise.all([
				$.env.get("TYPESAFE_API_KEY"),
				$.env.get("TYPESAFE_BASE_URL"),
				$.env.get("JEV_URL"),
				$.env.get("TYPESAFE_DEFAULT_MODEL")
			])).map((v) => v?.trim() || undefined);
			if (key || base || jevUrl) await configureServer($, link, {
				key,
				base,
				jevUrl,
				model
			}, new AbortController().signal);
		} catch {}
		return next(e);
	});
	on("tool.call", async function onToolCall($, e, next) {
		const type = names.get(e.tool);
		if (type === undefined) return next(e);
		try {
			if (st.missing.size > 0) {
				try {
					await untilAbort(ensureTools($, st, REGISTER_WAIT_MS), next.signal);
				} catch {}
			}
			const input = parseInput(type, e);
			if (typeof input === "string") return fail(type, input);
			const [key, base, jevUrl, model] = (await Promise.all([
				$.env.get("TYPESAFE_API_KEY"),
				$.env.get("TYPESAFE_BASE_URL"),
				$.env.get("JEV_URL"),
				$.env.get("TYPESAFE_DEFAULT_MODEL")
			])).map((v) => v?.trim() || undefined);
			if (next.signal.aborted) return fail(type, "the call was abandoned");
			const timeoutMs = Math.max(1, Math.round((seconds(e["timeout"]) ?? fallbackS) * 1e3));
			if (!key && !base && !jevUrl) return await askHaiku($, type, cutState(input.state, HAIKU_MAX_CHARS), input.questions, timeoutMs, next.signal);
			await untilAbort(loadKnowledge($, know), next.signal);
			if (next.signal.aborted) return fail(type, "the call was abandoned");
			return await answerJev($, type, input, input.overflow ?? defaultOverflow, {
				key,
				base,
				jevUrl,
				model
			}, timeoutMs, next.signal, know, link);
		} catch (err) {
			return fail(type, message(err));
		}
	});
	on("tool.check", async function onToolCheck(_$, e, next) {
		if (!e.tool.startsWith(SERVER_TOOL_PREFIX)) return next(e);
		if (next.origin?.plugin === PLUGIN) return {
			decision: "allow",
			reason: `${PLUGIN}'s own HTTP transport`
		};
		return {
			decision: "deny",
			reason: `this tool is the internal HTTP transport of the ${PLUGIN} plugin; use ${TOOLS.map((t) => TOOL_PREFIX + t).join(", ")}`
		};
	});
}
