const REROUTE_TARGET = "cc-knowledge:claude-code-expert";
function normalize(value) {
	return (typeof value === "string" ? value : "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function rerouteType(subagentType) {
	return normalize(subagentType) === "claude-code-guide" ? REROUTE_TARGET : subagentType;
}
export function register(on) {
	on("tool.call", { tool: ["Agent", "Task"] }, function reroute(_$, e, next) {
		const subagent_type = rerouteType(e.subagent_type);
		return next(subagent_type === e.subagent_type ? e : {
			...e,
			subagent_type
		});
	});
}
