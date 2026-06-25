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
                   "session-db.bundle.mjs", "session-snapshot.bundle.mjs"]) {
    await import(join(V, "hooks", m)); // throws if the closure is incomplete
  }
});
