import { afterCwdChanged, afterSessionCwd } from "./lib.mjs";
export const register = (on) => {
	const st = {
		shownAt: undefined,
		probe: null,
		dprintRuns: false
	};
	on("session.start", async function onSessionStart($, e, next) {
		return afterSessionCwd($, st, e, next);
	});
	on("classic.CwdChanged", async function onCwdChanged($, e, next) {
		return afterCwdChanged($, st, e, next);
	});
	on("tool.call", { tool: "EnterWorktree" }, async function onEnterWorktree($, e, next) {
		return afterSessionCwd($, st, e, next);
	});
	on("tool.call", { tool: "ExitWorktree" }, async function onExitWorktree($, e, next) {
		return afterSessionCwd($, st, e, next);
	});
};
