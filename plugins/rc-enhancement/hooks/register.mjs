const GATE_REASON = "Interaction rule violation: the final response ends with a plain-text question to the user. " + "Follow the CRITICAL RULE from the session start (how to interact with the user): " + "route the question through the AskUserQuestion tool instead — no exceptions, not even a casual yes/no offer.";
const isBareQuestion = (answer) => {
	const lines = answer.replace(/```[\s\S]*?```/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
	return /\?\s*$/.test(lines[lines.length - 1] ?? "");
};
export const register = (on) => {
	let gateTurnId;
	let gatePending = false;
	on("turn.start", async function onTurnStart(_$, e, next) {
		if (e.agentId === undefined) {
			gateTurnId = gatePending || e.text.includes(GATE_REASON) ? e.turnId : undefined;
			gatePending = false;
		}
		return next(e);
	});
	on("turn.complete", async function onTurnComplete($, e, next) {
		if (e.agentId === undefined && e.reason === "answer" && e.turnId !== gateTurnId && isBareQuestion(e.answer)) {
			gatePending = true;
			$.prompt.submit({ text: GATE_REASON }).catch(() => {
				gatePending = false;
			});
		}
		return next(e);
	});
};
