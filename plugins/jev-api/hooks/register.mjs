const TYPES = [
	"noul",
	"choice",
	"score"
];
const NEEDS = " Needs TYPESAFE_API_KEY, TYPESAFE_BASE_URL or JEV_URL to be set.";
const STATE = {
	type: "string",
	description: "The text the question is about."
};
const DEFAULT_JEV_URL = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_MODEL = "jev-latest";
const TIMEOUT_MS = 3e4;
const QUESTION_ID = "answer";
const HTTP_URL = /^https?:\/\/[^/?#\s]+(?:[/?#]\S*)?$/i;
const HTTP_BASE = /^https?:\/\/[^/?#\s]+(?:\/[^?#\s]*)?$/i;
const MAX_OPTIONS = 255;
const MIN_LEVELS = 2;
const MAX_LEVELS = 10;
const TOOL_PREFIX = "mcp__jev-api__";
const SPECS = {
	noul: {
		description: "Ask TypeSafe Jev a yes/no question about a text; returns the probability (0..1) that the answer is true." + NEEDS,
		inputSchema: {
			type: "object",
			properties: {
				instructions: {
					type: "string",
					description: "The yes/no question to answer about the text."
				},
				state: STATE,
				criteria: {
					type: "object",
					description: "Optional: what counts as true and what counts as false.",
					properties: {
						true: {
							type: "string",
							description: "What counts as true."
						},
						false: {
							type: "string",
							description: "What counts as false."
						}
					},
					additionalProperties: false
				}
			},
			required: ["instructions", "state"]
		}
	},
	choice: {
		description: "Ask TypeSafe Jev to pick one of named options for a text; returns the choice, its confidence and every option's probability." + NEEDS,
		inputSchema: {
			type: "object",
			properties: {
				instructions: {
					type: "string",
					description: "What to choose."
				},
				state: STATE,
				criteria: {
					type: "object",
					description: "The options: option name -> description of when to pick it.",
					additionalProperties: { type: "string" },
					minProperties: 1,
					maxProperties: MAX_OPTIONS
				}
			},
			required: [
				"instructions",
				"state",
				"criteria"
			]
		}
	},
	score: {
		description: "Ask TypeSafe Jev to rate a text along ordered levels; returns the score (the expected level: 0 is the first, values between levels are fractional), its confidence, each level's probability and the legend." + NEEDS,
		inputSchema: {
			type: "object",
			properties: {
				instructions: {
					type: "string",
					description: "What to rate."
				},
				state: STATE,
				criteria: {
					type: "array",
					description: "The levels, lowest first; scores start at 0.",
					items: { type: "string" },
					minItems: MIN_LEVELS,
					maxItems: MAX_LEVELS
				}
			},
			required: [
				"instructions",
				"state",
				"criteria"
			]
		}
	}
};
function isRecord(v) {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isOptionalString(v) {
	return v === undefined || typeof v === "string";
}
function json(text) {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}
function fail(type, reason) {
	return { deny: `${type}: ${reason}` };
}
function message(err) {
	return err instanceof Error ? err.message : String(err);
}
function hide(text, url, placeholder) {
	let href = url;
	try {
		href = new URL(url).href;
	} catch {}
	return text.replaceAll(href, placeholder).replaceAll(url, placeholder);
}
function isText(v) {
	return typeof v === "string" && v.trim() !== "";
}
function parseInput(type, e) {
	const { instructions, state, criteria } = e;
	if (!isText(instructions)) return "instructions must be a non-empty string";
	if (!isText(state)) return "state must be a non-empty string";
	if (type === "noul") {
		const msg = "criteria must be an object with optional string fields true and false";
		if (criteria === undefined) return {
			state,
			question: {
				type,
				instructions
			}
		};
		if (!isRecord(criteria)) return msg;
		const { true: yes, false: no, ...rest } = criteria;
		if (Object.keys(rest).length > 0 || !isOptionalString(yes) || !isOptionalString(no)) return msg;
		return {
			state,
			question: {
				type,
				instructions,
				criteria: {
					true: yes,
					false: no
				}
			}
		};
	}
	if (type === "choice") {
		const msg = `criteria must map 1 to ${MAX_OPTIONS} non-blank option names to string descriptions`;
		if (!isRecord(criteria)) return msg;
		const entries = Object.entries(criteria);
		const valid = entries.filter((p) => p[0].trim() !== "" && typeof p[1] === "string");
		if (entries.length < 1 || entries.length > MAX_OPTIONS || valid.length !== entries.length) return msg;
		return {
			state,
			question: {
				type,
				instructions,
				criteria: Object.fromEntries(valid)
			}
		};
	}
	const msg = `criteria must be an array of ${MIN_LEVELS} to ${MAX_LEVELS} strings`;
	if (!Array.isArray(criteria) || criteria.length < MIN_LEVELS || criteria.length > MAX_LEVELS || !criteria.every((v) => typeof v === "string")) return msg;
	return {
		state,
		question: {
			type,
			instructions,
			criteria
		}
	};
}
function endpoint(jev, base) {
	if (jev) return HTTP_URL.test(jev) ? {
		ok: true,
		url: jev
	} : {
		ok: false,
		error: "JEV_URL must be an http(s) URL"
	};
	if (base) {
		return HTTP_BASE.test(base) ? {
			ok: true,
			url: base.replace(/\/+$/, "") + "/v1/systemone"
		} : {
			ok: false,
			error: "TYPESAFE_BASE_URL must be an http(s) URL without query or fragment"
		};
	}
	return {
		ok: true,
		url: DEFAULT_JEV_URL
	};
}
function detail(text) {
	const body = json(text);
	if (!isRecord(body)) return undefined;
	const error = body["error"];
	const why = body["detail"] ?? (isRecord(error) ? error["message"] : undefined);
	if (why === undefined) return undefined;
	return typeof why === "string" ? why : JSON.stringify(why);
}
async function ask($, state, question, env, signal) {
	const { type } = question;
	const target = endpoint(env.jevUrl, env.base);
	if (!target.ok) return fail(type, target.error);
	const { key } = env;
	const model = env.model ?? DEFAULT_MODEL;
	const headers = { "Content-Type": "application/json" };
	if (key && /^https:/i.test(target.url)) headers["Authorization"] = `Bearer ${key}`;
	let timer;
	try {
		const request = $.http.fetch(target.url, {
			method: "POST",
			headers,
			body: JSON.stringify({
				model,
				state,
				questions: { [QUESTION_ID]: question }
			})
		});
		request.catch(() => undefined);
		const stop = new Promise((resolve) => {
			timer = $.clock.after(TIMEOUT_MS, () => resolve("timeout"));
			if (signal.aborted) resolve("aborted");
			else signal.addEventListener("abort", () => resolve("aborted"), { once: true });
		});
		const res = await Promise.race([request, stop]);
		if (res === "timeout") return fail(type, `timeout after ${TIMEOUT_MS}ms`);
		if (res === "aborted") return fail(type, "the call was abandoned");
		if (!res.ok) {
			const why = detail(res.text);
			return fail(type, `HTTP ${res.status}${why === undefined ? "" : `: ${why}`}`);
		}
		const body = json(res.text);
		if (body === undefined) return fail(type, `HTTP ${res.status} response was not valid JSON`);
		const answers = isRecord(body) ? body["answers"] : undefined;
		const answer = isRecord(answers) ? answers[QUESTION_ID] : undefined;
		if (!isRecord(answer) || answer["type"] !== type) return fail(type, `response had no ${type} answer`);
		return { result: JSON.stringify(answer) };
	} catch (err) {
		const why = message(err);
		return fail(type, env.jevUrl ? hide(why, target.url, "<JEV_URL>") : env.base ? hide(why, target.url, "<TYPESAFE_BASE_URL>/v1/systemone") : why);
	} finally {
		timer?.cancel();
	}
}
export function register(on) {
	const names = new Map(TYPES.map((t) => [TOOL_PREFIX + t, t]));
	on("session.start", async function onSessionStart($, e, next) {
		const results = await Promise.allSettled(TYPES.map((type) => $.tool.register({
			name: type,
			...SPECS[type]
		})));
		for (const [i, r] of results.entries()) {
			const type = TYPES[i];
			if (r.status === "rejected") await Promise.resolve($.ui.log(`registering ${type} failed: ${message(r.reason)}`)).catch(() => undefined);
			else {
				const tool = r.value?.tool;
				if (tool?.startsWith("mcp__") && tool.endsWith(`__${type}`)) names.set(tool, type);
			}
		}
		return next(e);
	});
	on("tool.call", async function onToolCall($, e, next) {
		const type = names.get(e.tool);
		if (type === undefined) return next(e);
		try {
			const [key, base, jevUrl, model] = (await Promise.all([
				$.env.get("TYPESAFE_API_KEY"),
				$.env.get("TYPESAFE_BASE_URL"),
				$.env.get("JEV_URL"),
				$.env.get("TYPESAFE_DEFAULT_MODEL")
			])).map((v) => v?.trim() || undefined);
			if (!key && !base && !jevUrl) return fail(type, "none of TYPESAFE_API_KEY, TYPESAFE_BASE_URL, JEV_URL is set");
			const input = parseInput(type, e);
			if (typeof input === "string") return fail(type, input);
			return await ask($, input.state, input.question, {
				key,
				base,
				jevUrl,
				model
			}, next.signal);
		} catch (err) {
			return fail(type, message(err));
		}
	});
}
