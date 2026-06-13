#!/usr/bin/env node
// Fake context-mode hook CLI: last argv = event. Echoes a known additionalContext.
// Mirrors the real CLI's casing contract: it only accepts lowercase event keys, so a
// non-lowercase event is rejected (exit 1, no stdout) — a regression that drops the
// .toLowerCase() in delegate.mjs then fails the casing tests loudly.
let buf = ""; process.stdin.on("data", d => buf += d);
process.stdin.on("end", () => {
  const event = process.argv[process.argv.length - 1];
  if (event !== event.toLowerCase()) { process.exit(1); } // reject non-lowercase, like the real CLI
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: event, additionalContext: `CTXMODE[${event}]` },
  }));
});
