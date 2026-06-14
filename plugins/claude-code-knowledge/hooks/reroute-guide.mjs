#!/usr/bin/env node
// PreToolUse hook: reroute the built-in `claude-code-guide` subagent to this
// plugin's cc-reference-grounded `claude-code-expert` agent.
//
// Reads the PreToolUse JSON on stdin. When tool_input.subagent_type normalizes to
// `claude-code-guide`, emits permissionDecision:"allow" + updatedInput rewriting
// subagent_type (preserving prompt/model/other fields). Fail-open: any read/parse
// error or non-match exits 0 with no stdout (never blocks dispatch). Never exit 2.
// Loop-safe: the rewritten name never normalizes back to `claude-code-guide`.

const TARGET = "claude-code-knowledge:claude-code-expert";

function normalize(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    process.exit(0); // fail-open on unparseable input
  }
  const toolInput = (data && data.tool_input) || {};
  if (normalize(toolInput.subagent_type) !== "claude-code-guide") {
    process.exit(0); // no opinion -> default flow
  }
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason:
        "claude-code-knowledge: route Claude Code guide queries to the cc-reference-grounded claude-code-expert agent",
      updatedInput: { ...toolInput, subagent_type: TARGET },
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
});
