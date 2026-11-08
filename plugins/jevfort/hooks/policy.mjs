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
		],
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
export const RISK_LEVELS = [
	"Harmless: only reads or inspects",
	"Changes files or state inside the project only (edits, installs, builds, local commits)",
	"Could destroy or leak data, or reach outside the project: deleting outside the project, force-pushing, rewriting history, publishing, sending data to external services, changing system configuration"
];
export const bashRiskQuestion = {
	type: "score",
	instructions: "How risky is it to run the shell command in `command` from the directory in `cwd` on a developer machine?",
	criteria: RISK_LEVELS
};
export const inScopeQuestion = (what) => ({
	type: "noul",
	instructions: `Is ${what} something the user's request in \`request\` asked for or clearly needs?`,
	criteria: {
		true: "Asked for, or a needed part of doing what was asked",
		false: "Not asked for and not needed for the request"
	}
});
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
const EFFORT_ORDER = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
export const LOW_BELOW = 1;
export const HIGH_FROM = 1.8;
export function route(answer, mode) {
	if (!answer || answer.confidence < .5) return undefined;
	const level = answer.score;
	if (level < LOW_BELOW) return {
		level,
		effort: "low",
		...mode === "model" ? { model: "claude-haiku-5-5" } : {}
	};
	if (level < HIGH_FROM) return {
		level,
		effort: "medium",
		...mode === "model" ? { model: "claude-sonnet-5-5" } : {}
	};
	return {
		level,
		effort: "high"
	};
}
export const effortKeepsCache = (model) => /(opus|sonnet)-5-5/.test(model);
export function adjustEffort(current, target) {
	if (!target || typeof current !== "string") return undefined;
	const ci = EFFORT_ORDER.indexOf(current);
	const ti = EFFORT_ORDER.indexOf(target);
	if (ci < 0) return undefined;
	if (target === "high") return ci < ti ? target : undefined;
	return ci > ti ? target : undefined;
}
const MODEL_TIER = (model) => /haiku/.test(model) ? 0 : /sonnet/.test(model) ? 1 : /opus|fable/.test(model) ? 2 : -1;
export function lowerModel(current, target) {
	if (!target) return undefined;
	const c = MODEL_TIER(current);
	return c > MODEL_TIER(target) ? target : undefined;
}
export const DEFAULT_GATE = {
	dangerAsk: .5,
	dangerDeny: .8,
	scopeDeny: .2,
	editScope: .15
};
export function gateBash(risk, inScope, t = DEFAULT_GATE) {
	const dangerous = risk?.probabilities["2"] ?? 0;
	if (dangerous < t.dangerAsk) return undefined;
	if (inScope !== undefined && inScope < t.scopeDeny && dangerous >= t.dangerDeny) {
		return {
			decision: "deny",
			reason: "Jev: this command could destroy or leak data and the request does not seem to ask for it. Use a safer command or ask the user first."
		};
	}
	return {
		decision: "ask",
		reason: `Jev: this command looks risky (${Math.round(dangerous * 100)}% likely to reach outside the project or destroy data).`
	};
}
export function gateEdit(inScope, t = DEFAULT_GATE) {
	if (inScope === undefined || inScope >= t.editScope) return undefined;
	return {
		decision: "ask",
		reason: "Jev: this change doesn't look like part of the request."
	};
}
export function shouldContinue(done, threshold = .15) {
	return done !== undefined && done < threshold;
}
