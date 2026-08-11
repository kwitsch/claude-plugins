import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  CONTEXT_CHAR_LIMIT,
  SYMBOL_LIMIT,
  PATTERN_CHAR_LIMIT,
  PROJECT_CACHE_TTL_MS,
  isCbmEnabled,
  resolveBundleCache,
  resolveProjectCacheDir,
  projectCacheKey,
  readProjectCache,
  writeProjectCache,
  pickProject,
  graphQueryFromToolInput,
  formatSessionContext,
  formatSubagentContext,
  formatSymbolContext,
  formatCoverageContext,
  buildOutput,
} from "../../plugins/linux-token-efficiency/hooks/cbm-context.mjs";

test("limits are the documented constants", () => {
  assert.equal(CONTEXT_CHAR_LIMIT, 1500);
  assert.equal(SYMBOL_LIMIT, 10);
  assert.equal(PATTERN_CHAR_LIMIT, 200);
});

test("isCbmEnabled: only the trimmed literal false disables (fail-open)", () => {
  assert.equal(isCbmEnabled("false"), false);
  assert.equal(isCbmEnabled("  false  "), false);
  assert.equal(isCbmEnabled(undefined), true);
  assert.equal(isCbmEnabled(""), true);
  assert.equal(isCbmEnabled("true"), true);
  assert.equal(isCbmEnabled("FALSE"), true);
  assert.equal(isCbmEnabled("${user_config.cbm_enabled}"), true);
});

test("resolveBundleCache: CBM_BUNDLE_CACHE wins when usable", () => {
  assert.equal(resolveBundleCache({ CBM_BUNDLE_CACHE: "/data/cbm" }), "/data/cbm");
});

test("resolveBundleCache: falls back to CLAUDE_PLUGIN_DATA/cbm", () => {
  assert.equal(resolveBundleCache({ CBM_BUNDLE_CACHE: "", CLAUDE_PLUGIN_DATA: "/pd" }), path.join("/pd", "cbm"));
});

test("resolveBundleCache: an uninterpolated placeholder is never a path", () => {
  const out = resolveBundleCache({
    CBM_BUNDLE_CACHE: "${CLAUDE_PLUGIN_DATA}/cbm",
    CLAUDE_PLUGIN_DATA: "${CLAUDE_PLUGIN_DATA}",
    TMPDIR: "/tmpdir",
  });
  assert.equal(out.includes("${"), false);
  assert.equal(out.startsWith(path.join("/tmpdir", "claude-cbm-")), true);
});

test("resolveBundleCache: no TMPDIR falls back under /tmp", () => {
  const out = resolveBundleCache({});
  assert.equal(out.startsWith(path.join("/tmp", "claude-cbm-")), true);
});

test("resolveProjectCacheDir: a project-cache subdir of the bundle cache", () => {
  assert.equal(resolveProjectCacheDir({ CBM_BUNDLE_CACHE: "/data/cbm" }), path.join("/data/cbm", "project-cache"));
});

test("projectCacheKey: stable, filesystem-safe, distinct per cwd", () => {
  const a = projectCacheKey("/repos/app");
  const b = projectCacheKey("/repos/app");
  const c = projectCacheKey("/repos/other");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("readProjectCache / writeProjectCache: round-trip, miss, expiry, corruption", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cbm-project-cache-"));
  try {
    assert.equal(readProjectCache(dir, "/repos/app"), null); // miss: no file yet

    writeProjectCache(dir, "/repos/app", "app-project");
    assert.equal(readProjectCache(dir, "/repos/app"), "app-project"); // round-trip
    assert.equal(readProjectCache(dir, "/repos/other"), null); // distinct cwd, no cross-talk

    const key = projectCacheKey("/repos/app");
    const filePath = path.join(dir, `${key}.json`);
    fs.writeFileSync(filePath, JSON.stringify({ project: "app-project", cachedAt: Date.now() - PROJECT_CACHE_TTL_MS - 1 }));
    assert.equal(readProjectCache(dir, "/repos/app"), null); // expired entry -> miss

    fs.writeFileSync(filePath, "not json");
    assert.equal(readProjectCache(dir, "/repos/app"), null); // corrupt entry -> miss, never throws

    fs.rmSync(filePath);
    assert.equal(readProjectCache(dir, "/repos/app"), null); // deleted -> miss

    // A missing cache directory never throws on write (best-effort).
    writeProjectCache(path.join(dir, "does", "not", "exist", "yet"), "/repos/app", "later-project");
    assert.equal(readProjectCache(path.join(dir, "does", "not", "exist", "yet"), "/repos/app"), "later-project");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pickProject: exact path, nearest ancestor, no match, unrecognized payload", () => {
  const payload = {
    projects: [
      { name: "outer", path: "/repos" },
      { name: "inner", path: "/repos/app" },
      { name: "other", path: "/elsewhere" },
    ],
  };
  assert.equal(pickProject(payload, "/repos/app"), "inner");
  assert.equal(pickProject(payload, "/repos/app/src/deep"), "inner");
  assert.equal(pickProject(payload, "/repos/other-app"), "outer");
  assert.equal(pickProject(payload, "/nowhere"), null);
  assert.equal(pickProject({ unexpected: true }, "/repos/app"), null);
  assert.equal(pickProject("not json shaped", "/repos/app"), null);
  assert.equal(pickProject(payload, ""), null);
});

test("pickProject: accepts a bare array and alternate key names", () => {
  const payload = [{ project_name: "graph", repo_path: "/repos/app" }];
  assert.equal(pickProject(payload, "/repos/app/lib"), "graph");
});

test("graphQueryFromToolInput: Grep, Glob, empty, over-long, unknown tool", () => {
  assert.deepEqual(graphQueryFromToolInput("Grep", { pattern: "handleRequest" }), {
    flag: "--name-pattern",
    value: "handleRequest",
  });
  assert.deepEqual(graphQueryFromToolInput("Glob", { pattern: "**/*.mjs" }), {
    flag: "--file-pattern",
    value: "**/*.mjs",
  });
  assert.equal(graphQueryFromToolInput("Grep", { pattern: "" }), null);
  assert.equal(graphQueryFromToolInput("Grep", { pattern: "   " }), null);
  assert.equal(graphQueryFromToolInput("Grep", { pattern: "x".repeat(201) }), null);
  assert.equal(graphQueryFromToolInput("Grep", {}), null);
  assert.equal(graphQueryFromToolInput("Read", { pattern: "x" }), null);
  assert.equal(graphQueryFromToolInput("Grep", null), null);
});

test("formatSessionContext: names the project, its index state and the graph tools", () => {
  const ctx = formatSessionContext("app", { status: "ready", files: 42 });
  assert.notEqual(ctx, null);
  assert.equal(ctx?.includes("app"), true);
  assert.equal(ctx?.includes("ready"), true);
  assert.equal(ctx?.includes("mcp__codebase-memory__"), true);
  assert.equal(formatSessionContext("", { status: "ready" }), null);
});

test("formatSessionContext: an unrecognized status payload still names the project", () => {
  const ctx = formatSessionContext("app", "garbage");
  assert.notEqual(ctx, null);
  assert.equal(ctx?.includes("app"), true);
});

test("formatSubagentContext: shorter, names the project, tells the agent to pass symbols through", () => {
  const ctx = formatSubagentContext("app", { status: "ready" });
  assert.notEqual(ctx, null);
  assert.equal(ctx?.includes("app"), true);
  assert.equal((ctx ?? "").length <= (formatSessionContext("app", { status: "ready" }) ?? "").length, true);
  assert.equal(formatSubagentContext("", {}), null);
});

test("formatSymbolContext: bullet list, capped at the limit, null when empty", () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    qualified_name: `pkg.Sym${i}`,
    file: `src/f${i}.mjs`,
    line: i + 1,
  }));
  const ctx = formatSymbolContext({ results: many }, 10);
  assert.notEqual(ctx, null);
  assert.equal((ctx ?? "").split("\n").filter((l) => l.startsWith("- ")).length, 10);
  assert.equal(ctx?.includes("pkg.Sym0"), true);
  assert.equal(ctx?.includes("src/f0.mjs:1"), true);
  assert.equal(formatSymbolContext({ results: [] }, 10), null);
  assert.equal(formatSymbolContext({ nope: 1 }, 10), null);
  assert.equal(formatSymbolContext(null, 10), null);
});

test("formatSymbolContext: truncates to CONTEXT_CHAR_LIMIT", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
    qualified_name: `pkg.${"S".repeat(300)}${i}`,
    file: `src/${"d".repeat(300)}/f${i}.mjs`,
  }));
  const ctx = formatSymbolContext({ results: many }, 10);
  assert.equal((ctx ?? "").length <= CONTEXT_CHAR_LIMIT, true);
});

test("formatCoverageContext: warns only on a reported gap", () => {
  assert.notEqual(formatCoverageContext({ skipped: true }, "/repo/a.mjs"), null);
  assert.notEqual(formatCoverageContext({ status: "partially_parsed" }, "/repo/a.mjs"), null);
  assert.notEqual(formatCoverageContext({ indexed: false }, "/repo/a.mjs"), null);
  assert.equal(formatCoverageContext({ status: "covered", indexed: true }, "/repo/a.mjs"), null);
  assert.equal(formatCoverageContext({ skipped: false }, "/repo/a.mjs"), null);
  assert.equal(formatCoverageContext({ nope: 1 }, "/repo/a.mjs"), null);
  assert.equal(formatCoverageContext("garbage", "/repo/a.mjs"), null);
  assert.equal(formatCoverageContext({ skipped: true }, ""), null);
  assert.equal(formatCoverageContext({ skipped: true }, "/repo/a.mjs")?.includes("/repo/a.mjs"), true);
});

test("buildOutput: exactly hookSpecificOutput.{hookEventName,additionalContext}", () => {
  const out = buildOutput("SessionStart", "ctx");
  assert.deepEqual(out, {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: "ctx",
    },
  });
  assert.deepEqual(Object.keys(out), ["hookSpecificOutput"]);
  assert.deepEqual(Object.keys(out.hookSpecificOutput ?? {}), ["hookEventName", "additionalContext"]);
});
