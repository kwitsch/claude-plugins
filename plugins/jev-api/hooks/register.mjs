import { DEFAULT_CONTEXT_TOKENS, DEFAULT_DENSITY, DEFAULT_OVERFLOW, DEFAULT_TIMEOUT_S, HAIKU_MAX_CHARS, PLUGIN, REGISTER_WAIT_MS, SERVER_TOOL_PREFIX, TOOL, answerJev, askHaiku, cutState, ensureTools, fail, isOverflow, loadKnowledge, message, newLink, parseInput, seconds, untilAbort } from "./lib.mjs";
const REQUEST_TOOL = `mcp__${PLUGIN}__${TOOL}`;
export function register(on, options) {
	const fallbackS = seconds(options?.["timeout"]) ?? DEFAULT_TIMEOUT_S;
	const optionOverflow = options?.["overflow"];
	const defaultOverflow = isOverflow(optionOverflow) ? optionOverflow : DEFAULT_OVERFLOW;
	const names = new Set([REQUEST_TOOL]);
	const st = {
		names,
		registered: false,
		pending: undefined,
		gen: 0,
		retryAt: 0,
		failures: 0,
		stuck: false
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
			st.retryAt = 0;
			st.failures = 0;
			st.stuck = false;
			if (!st.registered) await ensureTools($, st, 5 * REGISTER_WAIT_MS);
		} catch {}
		return next(e);
	});
	on("tool.call", async function onToolCall($, e, next) {
		if (!names.has(e.tool)) return next(e);
		try {
			if (!st.registered) {
				try {
					await untilAbort(ensureTools($, st, REGISTER_WAIT_MS), next.signal);
				} catch {}
			}
			const input = parseInput(e);
			if (typeof input === "string") return fail(input);
			const [key, base, jevUrl, model] = (await Promise.all([
				$.env.get("TYPESAFE_API_KEY"),
				$.env.get("TYPESAFE_BASE_URL"),
				$.env.get("JEV_URL"),
				$.env.get("TYPESAFE_DEFAULT_MODEL")
			])).map((v) => v?.trim() || undefined);
			if (next.signal.aborted) return fail("the call was abandoned");
			const timeoutMs = Math.max(1, Math.round((seconds(e["timeout"]) ?? fallbackS) * 1e3));
			if (!key && !base && !jevUrl) return await askHaiku($, cutState(input.state, HAIKU_MAX_CHARS), input.questions, timeoutMs, next.signal);
			await untilAbort(loadKnowledge($, know), next.signal);
			if (next.signal.aborted) return fail("the call was abandoned");
			return await answerJev($, input, input.overflow ?? defaultOverflow, {
				key,
				base,
				jevUrl,
				model
			}, timeoutMs, next.signal, know, link);
		} catch (err) {
			return fail(message(err));
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
			reason: `this tool is the internal HTTP transport of the ${PLUGIN} plugin; use ${REQUEST_TOOL}`
		};
	});
}
