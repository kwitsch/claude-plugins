export const CLAUDE = "claude";
export function nextActionQuestion(candidates) {
	const criteria = { [CLAUDE]: "Something not listed: writing or editing code, composing a different command, answering or explaining to the user, planning, or any step that needs judgment." };
	for (const c of candidates) criteria[c.key] = c.description;
	return {
		type: "choice",
		instructions: [
			"An AI coding assistant is working on the user request in `request`; `recent` lists its latest steps and their results.",
			"Pick the assistant's single best next action.",
			"Pick a listed action (read, run, skill, load) only when that exact action is clearly the right next step now. Pick a skill only when the request is squarely what that skill is for, and load a tool only when the request needs that tool. If the needed information is already in `recent`, or the assistant should now write code or reply, pick claude."
		].join(" "),
		criteria
	};
}
export const singleActionQuestion = {
	type: "noul",
	instructions: "Can the user request in `request` be fully answered by performing one read-only action (reading one file, or running one routine command such as the tests or git status) and briefly reporting what it shows?",
	criteria: {
		true: "Yes: the request only asks to run, read, show or check something, and a short report of that one result fully answers it",
		false: "No: it also needs code changes, several steps, investigation, explanation beyond the output, or judgment"
	}
};
export const DIFFICULTY_LEVELS = [
	"Trivial: a lookup, running a known command, or a short factual answer",
	"Routine: a small, well-specified change or explanation in one place",
	"Substantial: changes across several files, debugging with an unclear cause, or design choices",
	"Hard: architecture, subtle concurrency or security issues, or a large ambiguous task"
];
export const difficultyQuestion = {
	type: "score",
	instructions: "How much reasoning does an AI coding assistant need to fully handle the user request in `request`? When `previous_reply` is present, `request` answers the assistant's previous reply: judge a short follow-up like 'yes' or 'do it' by the work it approves or asks about there.",
	criteria: DIFFICULTY_LEVELS
};
export const doneQuestion = {
	type: "noul",
	instructions: "An AI coding assistant just stopped. Did it fully finish the user's request in `request`, judging from `final_message` and `recent`?",
	criteria: {
		true: "Finished, or stopped for a good reason: it needs an answer only the user can give, or it reports a real blocker",
		false: "Stopped partway: steps it said it would do are not done, it asks permission to continue work it could just do, or the request is only partly handled"
	}
};
export function bestAction(answer) {
	if (!answer) return undefined;
	let best;
	for (const [key, p] of Object.entries(answer.probabilities)) {
		if (key !== CLAUDE && (!best || p > best.p)) best = {
			key,
			p
		};
	}
	return best;
}
export function pickCandidate(answer, candidates, threshold) {
	if (!answer || answer.choice === CLAUDE) return undefined;
	if ((answer.probabilities[answer.choice] ?? 0) < threshold) return undefined;
	return candidates.find((c) => c.key === answer.choice);
}
export const EFFORT_ORDER = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
export function isEffort(v) {
	return EFFORT_ORDER.includes(v);
}
export const ESTIMATE_MODELS = [
	"haiku",
	"sonnet",
	"opus",
	"fable"
];
const MODEL_BIAS = {
	haiku: .75,
	sonnet: .25,
	opus: -.25,
	fable: -.75
};
export const EVERY_TURN_MODELS = ["sonnet", "opus"];
export const MIN_CONFIDENCE = .5;
export const MECHANICAL_FROM = .8;
export const ESTIMATE_NAME = "estimate_effort";
export const ESTIMATE_TOOL = `mcp__jevfort__${ESTIMATE_NAME}`;
const isModel = (v) => ESTIMATE_MODELS.includes(v);
export function modelFamily(id) {
	return ESTIMATE_MODELS.find((m) => id.includes(m));
}
export function inBandRange(level, range) {
	const i = EFFORT_ORDER.indexOf(level);
	return i >= EFFORT_ORDER.indexOf(range.minEffort) && i <= EFFORT_ORDER.indexOf(range.maxEffort);
}
export function bounds(min, max) {
	if (!isEffort(min) || !isEffort(max) || EFFORT_ORDER.indexOf(min) > EFFORT_ORDER.indexOf(max)) return undefined;
	return {
		minEffort: min,
		maxEffort: max
	};
}
export function parseEstimateInput(raw) {
	const { model, defaultEffort, minEffort, maxEffort, prompt } = raw;
	const effortError = (name) => `${name} must be one of ${EFFORT_ORDER.join(", ")}`;
	if (!isModel(model)) return `model must be one of ${ESTIMATE_MODELS.join(", ")}`;
	if (!isEffort(defaultEffort)) return effortError("defaultEffort");
	if (!isEffort(minEffort)) return effortError("minEffort");
	if (!isEffort(maxEffort)) return effortError("maxEffort");
	if (!bounds(minEffort, maxEffort)) return "minEffort must not be above maxEffort";
	if (typeof prompt !== "string" || prompt.trim() === "") return "prompt must be a non-empty string";
	return {
		model,
		defaultEffort,
		minEffort,
		maxEffort,
		prompt
	};
}
export function estimateEffort(effort, mechanical, b) {
	if (mechanical !== undefined && mechanical >= MECHANICAL_FROM) return {
		effort: b.minEffort,
		source: "mechanical"
	};
	if (!effort || !Number.isFinite(effort.score) || !(effort.confidence >= MIN_CONFIDENCE)) return {
		effort: b.defaultEffort,
		source: "fallback"
	};
	const i = Math.round(effort.score + MODEL_BIAS[b.model]);
	const clamped = Math.min(Math.max(i, EFFORT_ORDER.indexOf(b.minEffort)), EFFORT_ORDER.indexOf(b.maxEffort));
	return {
		effort: EFFORT_ORDER[clamped],
		source: "jev"
	};
}
export const EFFORT_LEVELS = [
	"Low: a lookup, running a known command, or a short factual answer",
	"Medium: a small, well-specified change or explanation in one place",
	"High: changes across several files, debugging with an unclear cause, or design choices",
	"Extra high: architecture, subtle concurrency or security issues, or a large ambiguous task",
	"Max: a long multi-part task needing deep, novel reasoning where mistakes are costly"
];
export const effortQuestion = {
	type: "score",
	instructions: "How much reasoning effort does a mid-tier AI coding model need to fully handle the user request in `request`? When `previous_reply` is present, `request` answers the assistant's previous reply: judge a short follow-up like 'yes' or 'do it' by the work it approves or asks about there.",
	criteria: EFFORT_LEVELS
};
export const mechanicalQuestion = {
	type: "noul",
	instructions: "Is the user request in `request` a purely mechanical task that needs no judgment, design or investigation?",
	criteria: {
		true: "Yes: renaming, reformatting, moving or copying, running a named command, or applying an edit spelled out exactly",
		false: "No: it needs understanding, choices, debugging, explanation or design"
	}
};
export const ESTIMATE_SPEC = {
	name: ESTIMATE_NAME,
	description: "Estimate the reasoning effort a prompt most likely needs, decided by TypeSafe Jev. Returns JSON {\"effort\": level, \"source\": \"jev\"|\"mechanical\"|\"fallback\"}: a purely mechanical prompt gets minEffort; Jev's estimate is biased by the model (a stronger model needs less) and kept within minEffort..maxEffort; when Jev is unreachable or unsure, defaultEffort.",
	inputSchema: {
		type: "object",
		properties: {
			model: {
				type: "string",
				enum: [...ESTIMATE_MODELS],
				description: "The model that will run the prompt"
			},
			defaultEffort: {
				type: "string",
				enum: [...EFFORT_ORDER],
				description: "Returned when Jev is unreachable or unsure"
			},
			minEffort: {
				type: "string",
				enum: [...EFFORT_ORDER],
				description: "Lowest effort to return; also the answer for a mechanical prompt"
			},
			maxEffort: {
				type: "string",
				enum: [...EFFORT_ORDER],
				description: "Highest effort to return"
			},
			prompt: {
				type: "string",
				description: "The prompt to estimate"
			}
		},
		required: [
			"model",
			"defaultEffort",
			"minEffort",
			"maxEffort",
			"prompt"
		]
	}
};
export const LOW_BELOW = 1;
export const HIGH_FROM = 1.8;
export function route(answer, mode) {
	if (!answer || answer.confidence < MIN_CONFIDENCE) return undefined;
	const level = answer.score;
	if (mode === "effort" || level >= HIGH_FROM) return { level };
	return {
		level,
		model: level < LOW_BELOW ? "claude-haiku-5-5" : "claude-sonnet-5-5"
	};
}
const MODEL_TIER = (model) => /haiku/.test(model) ? 0 : /sonnet/.test(model) ? 1 : /opus|fable/.test(model) ? 2 : -1;
export function lowerModel(current, target) {
	if (!target) return undefined;
	const c = MODEL_TIER(current);
	return c > MODEL_TIER(target) ? target : undefined;
}
export function shouldContinue(done, threshold = .15) {
	return done !== undefined && done < threshold;
}
export function inScratchpad(file, sessionId, roots) {
	if (!file.startsWith("/") || !sessionId) return false;
	const segs = file.split("/");
	if (segs.includes("..")) return false;
	const path = `/${segs.filter((seg) => seg !== "" && seg !== ".").join("/")}`;
	for (const root of roots) {
		const prefix = `${root.replace(/\/+$/, "")}/`;
		if (prefix === "/" || !path.startsWith(prefix)) continue;
		const rest = path.slice(prefix.length).split("/");
		if (rest.length >= 5 && /^claude-\d+$/.test(rest[0]) && rest[2] === sessionId && rest[3] === "scratchpad") return true;
	}
	return false;
}
