import { expect, test } from "claude-code/testing";
import { REROUTE_TARGET } from "../hooks/reroute.mjs";

test("an Agent call to claude-code-guide runs as the expert, keeping its other arguments", async ($, on) => {
  let seen: unknown;
  on("tool.call", (_$, e) => {
    seen = e;
    return { result: "ok" };
  });
  const r = await $.tool.call({ tool: "Agent", subagent_type: "claude-code-guide", description: "D", prompt: "P", model: "haiku" });
  expect(r.result).toBe("ok");
  expect(seen).toMatchObject({ tool: "Agent", subagent_type: REROUTE_TARGET, description: "D", prompt: "P", model: "haiku" });
});

test("a case/separator variant of the guide is rerouted too", async ($, on) => {
  let seen: unknown;
  on("tool.call", (_$, e) => {
    seen = e;
    return { result: "ok" };
  });
  await $.tool.call({ tool: "Agent", subagent_type: "Claude Code Guide", description: "D", prompt: "P" });
  expect(seen).toMatchObject({ subagent_type: REROUTE_TARGET });
});

test("an Agent call to any other subagent passes untouched", async ($, on) => {
  let seen: unknown;
  on("tool.call", (_$, e) => {
    seen = e;
    return { result: "ok" };
  });
  await $.tool.call({ tool: "Agent", subagent_type: "general-purpose", description: "D", prompt: "P" });
  expect(seen).toMatchObject({ subagent_type: "general-purpose" });
});

test("a call of another tool is not touched", async ($, on) => {
  let seen: unknown;
  on("tool.call", (_$, e) => {
    seen = e;
    return { result: "ok" };
  });
  await $.tool.call({ tool: "Bash", command: "echo claude-code-guide" });
  expect(seen).toMatchObject({ tool: "Bash", command: "echo claude-code-guide" });
});
