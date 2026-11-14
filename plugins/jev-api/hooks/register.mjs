import { DEFAULT_CONTEXT_TOKENS, DEFAULT_DENSITY, DEFAULT_OVERFLOW, DEFAULT_TIMEOUT_S, HAIKU_MAX_CHARS, REGISTER_WAIT_MS, TOOLS, TOOL_PREFIX, answerJev, askHaiku, cutState, ensureTools, fail, isOverflow, loadKnowledge, message, parseInput, seconds } from "./lib.mjs";
export function register(on, options) {
	const fallbackS = seconds(options?.["timeout"]) ?? DEFAULT_TIMEOUT_S;
	const optionOverflow = options?.["overflow"];
	const defaultOverflow = isOverflow(optionOverflow) ? optionOverflow : DEFAULT_OVERFLOW;
	const names = new Map(TOOLS.map((t) => [TOOL_PREFIX + t, t]));
	const st = {
		names,
		missing: new Set(TOOLS),
		pending: new Map(),
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
	on("session.start", async function onSessionStart($, e, next) {
		try {
			if (st.missing.size > 0) await ensureTools($, st, 5 * REGISTER_WAIT_MS);
		} catch {}
		return next(e);
	});
	on("tool.call", async function onToolCall($, e, next) {
		const type = names.get(e.tool);
		if (type === undefined) return next(e);
		try {
			if (st.missing.size > 0) {
				try {
					await ensureTools($, st, REGISTER_WAIT_MS);
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
			await loadKnowledge($, know);
			if (next.signal.aborted) return fail(type, "the call was abandoned");
			return await answerJev($, type, input, input.overflow ?? defaultOverflow, {
				key,
				base,
				jevUrl,
				model
			}, timeoutMs, next.signal, know);
		} catch (err) {
			return fail(type, message(err));
		}
	});
}
