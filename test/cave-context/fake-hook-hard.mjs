#!/usr/bin/env node
// Fake context-mode hook CLI that emits the PreToolUse "hard" fields (permissionDecision,
// updatedInput, decision) so the security-relevant forwarding path is exercised.
let buf = ""; process.stdin.on("data", d => buf += d);
process.stdin.on("end", () => {
  const event = process.argv[process.argv.length - 1];
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: event, permissionDecision: "deny", permissionDecisionReason: "blocked by ctx" },
    updatedInput: { command: "echo safe" },
    decision: "block",
  }));
});
