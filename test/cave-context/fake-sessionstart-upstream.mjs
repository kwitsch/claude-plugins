// test/cave-context/fake-sessionstart-upstream.mjs
// Fake context-mode SessionStart CLI double: emits a routing block FOLLOWED BY a
// <session_knowledge> continuity directive, mirroring context-mode's real layout
// (routing first, continuity appended).
let buf = ""; process.stdin.on("data", (d) => (buf += d));
process.stdin.on("end", () => {
  const routing = "<ctx_routing>Route big output through ctx_* tools.</ctx_routing>";
  const continuity = '<session_knowledge source="compact">\n<session_guide>\n## Last Request\nport session-init\n</session_guide>\n</session_knowledge>';
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: routing + "\n\n" + continuity },
  }));
});
