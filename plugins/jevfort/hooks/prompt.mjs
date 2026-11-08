export const NONE = "none";
export const KIND_LEVELS = {
	question: "Asks for an explanation, information or an opinion; no change is needed",
	task: "Asks for a change: writing, editing, fixing or building something",
	command: "Asks to run, show or check one specific thing (tests, status, a file)",
	conversation: "Small talk, thanks, or a reply to the assistant with no new request"
};
export const SKILL_HINT = .6;
export const PLAN_HINT = .85;
export function promptQuestions(skills) {
	const questions = {
		kind: {
			type: "choice",
			instructions: "What kind of message is `request`, sent to an AI coding assistant? When `previous_reply` is present, `request` answers it: read a short follow-up like 'fix it' or 'yes' in that light.",
			criteria: KIND_LEVELS
		},
		needs_plan: {
			type: "noul",
			instructions: "Is `request` a large or ambiguous change (several files, design choices, unclear scope) that the assistant should plan and confirm before editing anything? When `previous_reply` is present, `request` refers to it: a follow-up approving or naming a change already described there is not ambiguous.",
			criteria: {
				true: "Large or ambiguous: plan first",
				false: "Small, clear, or not a change at all"
			}
		}
	};
	if (skills) questions.skill = {
		type: "choice",
		instructions: "Which listed skill is squarely meant for `request`, if any?",
		criteria: skills
	};
	return questions;
}
export function hints(kind, needsPlan, skill, takeThreshold) {
	const out = [];
	if (skill && skill.name !== NONE && skill.p >= SKILL_HINT && skill.p < takeThreshold) {
		out.push(`Jev routing hint: the skill "${skill.name}" looks like a fit for this request (p=${skill.p.toFixed(2)}). Consider invoking it.`);
	}
	if (kind === "task" && (needsPlan ?? 0) >= PLAN_HINT) {
		out.push(`Jev routing hint: this looks like a large or ambiguous change (p=${(needsPlan ?? 0).toFixed(2)}). Outline a short plan and confirm it with the user before editing.`);
	}
	return out;
}
