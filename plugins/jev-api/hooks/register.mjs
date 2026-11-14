const TYPES = [
	"noul",
	"choice",
	"score"
];
const TOOLS = [...TYPES, "batch"];
const HAIKU_MODEL = "claude-haiku-5-5";
const HAIKU_SYSTEM = `You stand in for a text classifier. Answer every question about the given text and reply with JSON only (no prose, no code fence): {"answers":{"<id>":<answer>}} with one answer per question id.
An answer is, by question type:
- noul: {"type":"noul","noul":<probability 0..1 that the answer is yes>}
- choice: {"type":"choice","choice":"<exactly one option name>","confidence":<0..1>,"probabilities":{"<option>":<0..1>,...}} with every option listed
- score: {"type":"score","score":<number from 0 to levels-1, fractional between levels>,"confidence":<0..1>,"probabilities":{"0":<0..1>,"1":<0..1>,...}} with every level index listed
Calibration: be a calibrated estimator, not a cautious one. For noul use the whole range: 0.97 to 0.99 when the answer is clearly yes, 0.01 to 0.03 when it is clearly no, values in between only when the case is genuinely open. For choice and score spread the probabilities honestly over neighbouring options; a score is the probability-weighted mean of the level indexes, so it is rarely a whole number. For a score over ordered levels pick the lowest level that fully handles the case: most everyday cases sit in the lower half of the scale and the top two levels are rare, so when two neighbouring levels fit, give the lower one more weight.`;
const NOUL_STRETCH = 2.5;
const STATE = {
	type: "string",
	description: "The text the question is about."
};
const DEFAULT_TIMEOUT_S = 20;
const MAX_TIMEOUT_S = 30;
const TIMEOUT = {
	type: "number",
	exclusiveMinimum: 0,
	description: `Optional: the HTTP timeout of the request in seconds, at most ${MAX_TIMEOUT_S}. Default: the plugin's timeout option, else ${DEFAULT_TIMEOUT_S}.`
};
const DEFAULT_JEV_URL = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_MODEL = "jev-latest";
const QUESTION_ID = "answer";
const HTTP_URL = /^https?:\/\/[^/?#\s]+(?:[/?#]\S*)?$/i;
const HTTP_BASE = /^https?:\/\/[^/?#\s]+(?:\/[^?#\s]*)?$/i;
const MAX_OPTIONS = 255;
const MIN_LEVELS = 2;
const MAX_LEVELS = 10;
const HAIKU_MAX_TOKENS = 16384;
const MAX_DETAIL = 1e3;
const REGISTER_WAIT_MS = 1e3;
const MAX_RETRY_MS = 3e5;
const RETRY_BASE_MS = 5e3;
const MIN_REDACT_KEY = 6;
const TOOL_PREFIX = "mcp__jev-api__";
const SPECS = {
	noul: {
		description: "Ask TypeSafe Jev a yes/no question about a text; returns the probability (0..1) that the answer is true.",
		inputSchema: {
			type: "object",
			properties: {
				instructions: {
					type: "string",
					description: "The yes/no question to answer about the text."
				},
				state: STATE,
				timeout: TIMEOUT,
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
		description: "Ask TypeSafe Jev to pick one of named options for a text; returns the choice, its confidence and every option's probability.",
		inputSchema: {
			type: "object",
			properties: {
				instructions: {
					type: "string",
					description: "What to choose."
				},
				state: STATE,
				timeout: TIMEOUT,
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
		description: "Ask TypeSafe Jev to rate a text along ordered levels; returns the score (the expected level: 0 is the first, values between levels are fractional), its confidence, each level's probability and the legend.",
		inputSchema: {
			type: "object",
			properties: {
				instructions: {
					type: "string",
					description: "What to rate."
				},
				state: STATE,
				timeout: TIMEOUT,
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
	},
	batch: {
		description: "Ask TypeSafe Jev several noul, choice and score questions about one text in a single request; returns a JSON array of the answers in question order, each as the noul, choice or score tool returns it. One invalid or unanswered question fails the whole call.",
		inputSchema: {
			type: "object",
			properties: {
				state: STATE,
				timeout: TIMEOUT,
				questions: {
					type: "array",
					description: "The questions, each with the input of the noul, choice or score tool minus state, plus its type.",
					minItems: 1,
					items: {
						type: "object",
						properties: {
							type: {
								type: "string",
								enum: [...TYPES],
								description: "The question type."
							},
							instructions: {
								type: "string",
								description: "The question."
							},
							criteria: { description: `noul: optional { true, false } strings; choice: 1 to ${MAX_OPTIONS} option names -> descriptions; score: ${MIN_LEVELS} to ${MAX_LEVELS} levels, lowest first.` }
						},
						required: ["type", "instructions"]
					}
				}
			},
			required: ["state", "questions"]
		}
	}
};
function isRecord(v) {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isOptionalString(v) {
	return v === undefined || typeof v === "string";
}
function json(text, reviver) {
	try {
		return JSON.parse(text, reviver);
	} catch {
		return undefined;
	}
}
function fail(tool, reason) {
	return { deny: `${tool}: ${reason}` };
}
function seconds(v) {
	return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(v, MAX_TIMEOUT_S) : undefined;
}
function isType(v) {
	return TYPES.includes(v);
}
function message(err) {
	if (err instanceof Error) return err.message;
	try {
		return String(err);
	} catch {
		return "unknown error";
	}
}
function hide(text, url, placeholder) {
	let href = url;
	try {
		href = new URL(url).href;
	} catch {}
	return text.replaceAll(href, placeholder).replaceAll(url, placeholder);
}
function hideHost(text, url) {
	let host = "";
	try {
		host = new URL(url).hostname;
	} catch {
		return text;
	}
	if (!host) return text;
	let t = text;
	for (const h of new Set([host, host.replace(/^\[(.*)\]$/, "$1")])) {
		t = t.replace(new RegExp(`(?<![\\w.-])${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "gi"), "<host>");
	}
	return t;
}
function isText(v) {
	return typeof v === "string" && v.trim() !== "";
}
function parseQuestion(type, instructions, criteria) {
	if (!isText(instructions)) return "instructions must be a non-empty string";
	if (type === "noul") {
		const msg = "criteria must be an object with optional string fields true and false";
		if (criteria === undefined) return {
			type,
			instructions
		};
		if (!isRecord(criteria)) return msg;
		const { true: yes, false: no, ...rest } = criteria;
		if (Object.keys(rest).length > 0 || !isOptionalString(yes) || !isOptionalString(no)) return msg;
		return {
			type,
			instructions,
			criteria: {
				true: yes,
				false: no
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
			type,
			instructions,
			criteria: Object.fromEntries(valid)
		};
	}
	const msg = `criteria must be an array of ${MIN_LEVELS} to ${MAX_LEVELS} strings`;
	if (!Array.isArray(criteria) || criteria.length < MIN_LEVELS || criteria.length > MAX_LEVELS || !criteria.every((v) => typeof v === "string")) return msg;
	return {
		type,
		instructions,
		criteria
	};
}
function parseInput(tool, e) {
	const { instructions, state } = e;
	if (tool !== "batch" && !isText(instructions)) return "instructions must be a non-empty string";
	if (!isText(state)) return "state must be a non-empty string";
	if (tool !== "batch") {
		const question = parseQuestion(tool, instructions, e["criteria"]);
		return typeof question === "string" ? question : {
			state,
			questions: [question]
		};
	}
	const list = e["questions"];
	if (!Array.isArray(list) || list.length < 1) return "questions must be a non-empty array";
	const questions = [];
	for (const [i, q] of list.entries()) {
		if (!isRecord(q) || !isType(q["type"])) return `questions[${i}]: type must be one of ${TYPES.join(", ")}`;
		const question = parseQuestion(q["type"], q["instructions"], q["criteria"]);
		if (typeof question === "string") return `questions[${i}]: ${question}`;
		questions.push(question);
	}
	return {
		state,
		questions
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
function detail(text, redact, numbers) {
	const body = json(text, numbers ? (_k, v, c) => typeof v === "number" && c?.source !== undefined && redact(c.source) !== c.source ? c.source : v : undefined);
	if (!isRecord(body)) return undefined;
	const error = body["error"];
	const why = body["detail"] ?? (isRecord(error) ? error["message"] : undefined);
	if (why === undefined) return undefined;
	const clean = (v) => {
		if (typeof v === "string") return redact(v);
		if (typeof v === "number") return numbers && redact(String(v)) !== String(v) ? redact(String(v)) : v;
		return isRecord(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [redact(k), x])) : v;
	};
	return typeof why === "string" ? redact(why) : JSON.stringify(why, (_k, v) => clean(v));
}
function isUnit(v) {
	return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}
function hasProbabilities(v, keys) {
	return isRecord(v) && keys.every((k) => isUnit(v[k]));
}
function stretch(p) {
	const c = Math.min(Math.max(p, .001), .999);
	return 1 / (1 + Math.exp(-NOUL_STRETCH * Math.log(c / (1 - c))));
}
function round4(v) {
	return Math.round(v * 1e4) / 1e4;
}
function checkAnswer(q, a) {
	if (!isRecord(a) || a["type"] !== q.type) return undefined;
	if (q.type === "noul") return isUnit(a["noul"]) ? {
		type: "noul",
		noul: round4(stretch(a["noul"]))
	} : undefined;
	const { confidence, probabilities } = a;
	if (!isUnit(confidence)) return undefined;
	if (q.type === "choice") {
		const options = Object.keys(q.criteria);
		const picked = a["choice"];
		if (typeof picked !== "string" || !options.includes(picked) || !hasProbabilities(probabilities, options)) return undefined;
		const sum = options.reduce((t, o) => t + probabilities[o], 0);
		if (!(sum > 0)) return undefined;
		return {
			type: "choice",
			choice: picked,
			confidence,
			probabilities: Object.fromEntries(options.map((o) => [o, round4(probabilities[o] / sum)]))
		};
	}
	const levels = q.criteria.map((_, i) => String(i));
	if (!hasProbabilities(probabilities, levels)) return undefined;
	const total = levels.reduce((sum, l) => sum + probabilities[l], 0);
	if (!(total > 0)) return undefined;
	const normalized = levels.map((l) => probabilities[l] / total);
	const mean = normalized.reduce((sum, p, i) => sum + i * p, 0);
	return {
		type: "score",
		score: round4(mean),
		confidence,
		legend: Object.fromEntries(q.criteria.map((l, i) => [i, l])),
		probabilities: Object.fromEntries(levels.map((l, i) => [l, round4(normalized[i])]))
	};
}
function haikuTokens(questions) {
	let n = 256;
	for (const q of questions) {
		n += 256;
		if (q.type === "choice") {
			for (const key of Object.keys(q.criteria)) n += Math.ceil(key.length / 3) + 12;
		} else if (q.type === "score") n += 16 * q.criteria.length;
	}
	return Math.min(HAIKU_MAX_TOKENS, n);
}
async function askHaiku($, tool, state, questions, timeoutMs, signal) {
	const ids = questions.map((_, i) => tool === "batch" ? `q${i}` : QUESTION_ID);
	const prompt = `Text:\n${state}\n\nQuestions (JSON):\n${JSON.stringify(Object.fromEntries(ids.map((id, i) => [id, questions[i]])))}`;
	let onAbort;
	try {
		const reply = $.model.complete({
			model: HAIKU_MODEL,
			system: HAIKU_SYSTEM,
			prompt,
			maxTokens: haikuTokens(questions),
			timeoutMs
		}, { signal });
		reply.catch(() => undefined);
		const aborted = new Promise((resolve) => {
			if (signal.aborted) resolve("aborted");
			else {
				onAbort = () => resolve("aborted");
				signal.addEventListener("abort", onAbort, { once: true });
			}
		});
		const r = await Promise.race([reply, aborted]);
		if (r === "aborted") return fail(tool, "the call was abandoned");
		if (!r.isAnswered) {
			if (r.reason !== "aborted") return fail(tool, `fallback: ${r.reason}`);
			return fail(tool, signal.aborted ? "the call was abandoned" : `fallback: timeout after ${timeoutMs}ms`);
		}
		const body = json(r.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, ""));
		const answers = isRecord(body) ? body["answers"] : undefined;
		const list = [];
		for (const [i, q] of questions.entries()) {
			const answer = checkAnswer(q, isRecord(answers) ? answers[ids[i]] : undefined);
			if (answer === undefined) return fail(tool, `fallback: Haiku's reply had no valid ${q.type} answer${tool === "batch" ? ` for questions[${i}]` : ""}`);
			list.push(answer);
		}
		return { result: JSON.stringify(tool === "batch" ? list : list[0]) };
	} catch (err) {
		return fail(tool, `fallback: ${message(err)}`);
	} finally {
		if (onAbort) signal.removeEventListener("abort", onAbort);
	}
}
async function ask($, tool, state, questions, env, timeoutMs, signal) {
	const ids = questions.map((_, i) => tool === "batch" ? `q${i}` : QUESTION_ID);
	const target = endpoint(env.jevUrl, env.base);
	if (!target.ok) return fail(tool, target.error);
	const { key } = env;
	const model = env.model ?? DEFAULT_MODEL;
	const headers = { "Content-Type": "application/json" };
	if (key && /^https:/i.test(target.url)) headers["Authorization"] = `Bearer ${key}`;
	const redact = (text) => {
		let t = env.jevUrl ? hide(text, target.url, "<JEV_URL>") : env.base ? hide(text, target.url, "<TYPESAFE_BASE_URL>/v1/systemone") : text;
		if (key && key.length >= MIN_REDACT_KEY) t = t.replaceAll(key, "<TYPESAFE_API_KEY>");
		return env.jevUrl || env.base ? hideHost(t, target.url) : t;
	};
	let timer;
	let onAbort;
	try {
		const request = $.http.fetch(target.url, {
			method: "POST",
			headers,
			body: JSON.stringify({
				model,
				state,
				questions: Object.fromEntries(ids.map((id, i) => [id, questions[i]]))
			})
		});
		request.catch(() => undefined);
		const stop = new Promise((resolve) => {
			timer = $.clock.after(timeoutMs, () => resolve("timeout"));
			if (signal.aborted) resolve("aborted");
			else {
				onAbort = () => resolve("aborted");
				signal.addEventListener("abort", onAbort, { once: true });
			}
		});
		const res = await Promise.race([request, stop]);
		if (res === "timeout") return fail(tool, `timeout after ${timeoutMs}ms`);
		if (res === "aborted") return fail(tool, "the call was abandoned");
		if (!res.ok) {
			const why = detail(res.text, redact, key !== undefined && key.length >= MIN_REDACT_KEY && /^[-+.\deE]+$/.test(key));
			let text = why === undefined ? "" : why.trim();
			if (text.length > MAX_DETAIL) {
				text = text.slice(0, MAX_DETAIL);
				if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
				text += "…";
			}
			return fail(tool, `HTTP ${res.status}${text === "" ? "" : `: ${text}`}`);
		}
		const body = json(res.text);
		if (body === undefined) return fail(tool, `HTTP ${res.status} response was not valid JSON`);
		const answers = isRecord(body) ? body["answers"] : undefined;
		const list = [];
		for (const [i, q] of questions.entries()) {
			const answer = isRecord(answers) ? answers[ids[i]] : undefined;
			if (!isRecord(answer) || answer["type"] !== q.type) return fail(tool, `response had no ${q.type} answer${tool === "batch" ? ` for questions[${i}]` : ""}`);
			list.push(answer);
		}
		return { result: JSON.stringify(tool === "batch" ? list : list[0]) };
	} catch (err) {
		return fail(tool, redact(message(err)));
	} finally {
		timer?.cancel();
		if (onAbort) signal.removeEventListener("abort", onAbort);
	}
}
async function registerOne($, st, type) {
	try {
		const r = await $.tool.register({
			name: type,
			...SPECS[type]
		});
		const tool = r?.tool;
		if (typeof tool === "string" && tool.startsWith("mcp__") && tool.endsWith(`__${type}`)) st.names.set(tool, type);
		st.missing.delete(type);
	} catch (err) {
		const n = (st.failures.get(type) ?? 0) + 1;
		st.failures.set(type, n);
		st.retryAt.set(type, Date.now() + (n === 1 ? 0 : Math.min(MAX_RETRY_MS, RETRY_BASE_MS * 2 ** (n - 2))));
		if (n === 1) {
			try {
				void Promise.resolve($.ui.log(`registering ${type} failed: ${message(err)}`)).catch(() => undefined);
			} catch {}
		}
	}
}
async function ensureTools($, st, ms) {
	const now = Date.now();
	for (const type of TOOLS) {
		if (!st.missing.has(type) || st.pending.has(type) || (st.retryAt.get(type) ?? 0) > now) continue;
		const p = registerOne($, st, type);
		st.pending.set(type, p);
		void p.then(() => {
			st.pending.delete(type);
			st.stuck.delete(type);
		});
	}
	const waiting = [...st.pending].filter(([type]) => !st.stuck.has(type));
	if (waiting.length === 0) return;
	let timer;
	try {
		const late = await Promise.race([Promise.all(waiting.map(([, p]) => p)).then(() => false), new Promise((resolve) => {
			timer = $.clock.after(ms, () => resolve(true));
		})]);
		if (late) {
			for (const [type] of waiting) if (st.pending.has(type)) st.stuck.add(type);
		}
	} finally {
		timer?.cancel();
	}
}
export function register(on, options) {
	const fallbackS = seconds(options?.["timeout"]) ?? DEFAULT_TIMEOUT_S;
	const names = new Map(TOOLS.map((t) => [TOOL_PREFIX + t, t]));
	const st = {
		names,
		missing: new Set(TOOLS),
		pending: new Map(),
		retryAt: new Map(),
		failures: new Map(),
		stuck: new Set()
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
			if (!key && !base && !jevUrl) return await askHaiku($, type, input.state, input.questions, timeoutMs, next.signal);
			return await ask($, type, input.state, input.questions, {
				key,
				base,
				jevUrl,
				model
			}, timeoutMs, next.signal);
		} catch (err) {
			return fail(type, message(err));
		}
	});
}
