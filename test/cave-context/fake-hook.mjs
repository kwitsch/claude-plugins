#!/usr/bin/env node
// Fake context-mode hook CLI: last argv = event. Echoes a known additionalContext.
let buf = ""; process.stdin.on("data", d => buf += d);
process.stdin.on("end", () => {
  const event = process.argv[process.argv.length - 1];
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: event, additionalContext: `CTXMODE[${event}]` },
  }));
});
