import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

const V = fileURLToPath(new URL("../../plugins/cave-context/bin/context-mode/", import.meta.url));

test("vendored LICENSE + NOTICE present, foreign hooks stripped", () => {
  assert.ok(existsSync(join(V, "LICENSE")), "ELv2 LICENSE shipped");
  assert.ok(existsSync(join(V, "NOTICE")), "vendor NOTICE shipped");
  for (const d of ["gemini-cli", "cursor", "vscode-copilot", "codex", "kimi", "kiro", "jetbrains-copilot"]) {
    assert.ok(!existsSync(join(V, "hooks", d)), `foreign hook dir removed: ${d}`);
  }
});

test("server.bundle imports embedded and exposes ctx tools; sessionstart deps resolve", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "cm-vendor-test-"));
  process.env.CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS = "1";
  process.env.CONTEXT_MODE_DIR = scratch;
  process.env.CLAUDE_PROJECT_DIR = scratch;
  const mod = await import(join(V, "server.bundle.mjs"));
  const names = (mod.REGISTERED_CTX_TOOLS ?? []).map((t) => t.name);
  for (const n of ["ctx_index", "ctx_search", "ctx_fetch_and_index", "ctx_batch_execute"]) {
    assert.ok(names.includes(n), `tool exposed: ${n}`);
  }
  // hook work modules import without running fd-0/exit logic
  for (const m of ["routing-block.mjs", "session-extract.bundle.mjs", "session-loaders.mjs",
                   "session-db.bundle.mjs", "session-snapshot.bundle.mjs",
                   "auto-injection.mjs", "session-helpers.mjs"]) {
    await import(join(V, "hooks", m)); // throws if the closure is incomplete
  }
});

test("packaging artifacts removed from vendored tree", () => {
  for (const p of [".claude-plugin", ".codex-plugin", ".openclaw-plugin", "openclaw.plugin.json", "skills", "hooks/hooks.json"]) {
    assert.ok(!existsSync(join(V, p)), `packaging artifact removed: ${p}`);
  }
});

test("non-Claude-Code platform cruft + dev/install machinery stripped; runtime closure kept", () => {
  // Stripped: tsc dev tree (ALL platform adapters incl codex), per-platform configs,
  // CLI/install cruft, and the ctx_insight dashboard + CLI bundle (ctx_insight is denied
  // at the server — see DENIED_UPSTREAM_TOOLS in mcp/server.mjs).
  for (const p of ["build", "cli.bundle.mjs", "insight", "start.mjs", "scripts", "bin", "README.md",
                   "configs/codex", "configs/cursor", "configs/gemini-cli"]) {
    assert.ok(!existsSync(join(V, p)), `stripped: ${p}`);
  }
  // Kept: the in-process runtime closure.
  for (const p of ["server.bundle.mjs", "hooks", "configs/claude-code", "package.json", "LICENSE", "NOTICE"]) {
    assert.ok(existsSync(join(V, p)), `kept: ${p}`);
  }
});
