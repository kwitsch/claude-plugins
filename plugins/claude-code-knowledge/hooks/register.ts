import type { Register } from "claude-code";
import { rerouteType } from "./reroute.mjs";

export const register: Register = (on) => {
  // Reroute a claude-code-guide dispatch to the cc-reference-grounded expert; every other call passes untouched.
  // No .catch: a throwing hook is skipped, so a failure fails open (the guide runs un-rerouted), as the old mcp_tool hook did.
  on("tool.call", { tool: ["Agent", "Task"] }, (_$, e, next) => {
    const subagent_type = rerouteType(e.subagent_type);
    return next(subagent_type === e.subagent_type ? e : { ...e, subagent_type });
  });
};
