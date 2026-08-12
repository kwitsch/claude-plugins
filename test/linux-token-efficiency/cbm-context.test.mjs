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
  unwrapToolResult,
  pickProjectEntry,
  graphQueryFromToolInput,
  formatSessionContext,
  formatSubagentContext,
  formatSymbolContext,
  formatCoverageContext,
  relativeToProject,
  buildOutput,
} from "../../plugins/linux-token-efficiency/mcp/cbm-context.mjs";

// Recorded from the pinned v0.10.1 binary: search_graph with format:"json".
const SEARCH_JSON = {
  total: 2,
  count: 2,
  cols: ["name", "label", "lines", "in", "out"],
  groups: [
    {
      qn_prefix: "app.",
      file: "src/server.mjs",
      rows: [["handleRequest", "function", "12-40", 1, 2]],
    },
    {
      qn_prefix: "app.util.",
      file: "src/util.mjs",
      rows: [["slugify", "function", "7-9", 0, 1]],
    },
  ],
  has_more: false,
};

// Recorded from the pinned v0.10.1 binary: check_index_coverage with paths:[…].
const COVERAGE_GAP = {
  project: "app",
  signal: "ok",
  paths: [
    {
      requested_path: "src/server.mjs",
      path: "src/server.mjs",
      coverage_lookup: "ok",
      status: "not_indexed",
      freshness: "unknown",
      recommended_action: "reindex",
      coverage: [],
    },
  ],
};

const COVERAGE_UNAVAILABLE = {
  project: "app",
  paths: [
    {
      requested_path: "src/server.mjs",
      path: "src/server.mjs",
      coverage_lookup: "error",
      status: "coverage_unavailable",
    },
  ],
};

test("limits are the documented constants", () => {
  assert.equal(CONTEXT_CHAR_LIMIT, 1500);
  assert.equal(SYMBOL_LIMIT, 10);
  assert.equal(PATTERN_CHAR_LIMIT, 200);
  assert.equal(PROJECT_CACHE_TTL_MS, 10 * 60 * 1000);
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

test("resolveBundleCache: CBM_BUNDLE_CACHE wins, then CLAUDE_PLUGIN_DATA, never a placeholder", () => {
  assert.equal(resolveBundleCache({ CBM_BUNDLE_CACHE: "/data/cbm" }), "/data/cbm");
  assert.equal(resolveBundleCache({ CBM_BUNDLE_CACHE: "", CLAUDE_PLUGIN_DATA: "/pd" }), path.join("/pd", "cbm"));
  const out = resolveBundleCache({
    CBM_BUNDLE_CACHE: "${CLAUDE_PLUGIN_DATA}/cbm",
    CLAUDE_PLUGIN_DATA: "${CLAUDE_PLUGIN_DATA}",
    TMPDIR: "/tmpdir",
  });
  assert.equal(out.includes("${"), false);
  assert.equal(out.startsWith(path.join("/tmpdir", "claude-cbm-")), true);
  assert.equal(resolveBundleCache({}).startsWith(path.join("/tmp", "claude-cbm-")), true);
});

test("resolveProjectCacheDir: a project-cache subdir of the bundle cache", () => {
  assert.equal(resolveProjectCacheDir({ CBM_BUNDLE_CACHE: "/data/cbm" }), path.join("/data/cbm", "project-cache"));
});

test("projectCacheKey: stable, filesystem-safe, distinct per cwd", () => {
  assert.equal(projectCacheKey("/repos/app"), projectCacheKey("/repos/app"));
  assert.notEqual(projectCacheKey("/repos/app"), projectCacheKey("/repos/other"));
  assert.match(projectCacheKey("/repos/app"), /^[0-9a-f]{64}$/);
});

test("readProjectCache / writeProjectCache: {name,root} round-trip, miss, expiry, corruption", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cbm-project-cache-"));
  try {
    assert.equal(readProjectCache(dir, "/repos/app"), null);

    writeProjectCache(dir, "/repos/app", {
      name: "app-project",
      root: "/repos/app",
    });
    assert.deepEqual(readProjectCache(dir, "/repos/app"), {
      name: "app-project",
      root: "/repos/app",
    });
    assert.equal(readProjectCache(dir, "/repos/other"), null);

    const filePath = path.join(dir, `${projectCacheKey("/repos/app")}.json`);
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        project: "app-project",
        root: "/repos/app",
        cachedAt: Date.now() - PROJECT_CACHE_TTL_MS - 1,
      }),
    );
    assert.equal(readProjectCache(dir, "/repos/app"), null); // expired

    fs.writeFileSync(filePath, JSON.stringify({ project: "app-project", cachedAt: Date.now() }));
    assert.equal(readProjectCache(dir, "/repos/app"), null); // pre-rework entry without a root -> miss

    fs.writeFileSync(filePath, "not json");
    assert.equal(readProjectCache(dir, "/repos/app"), null); // corrupt -> miss, never throws

    // Best-effort write: a missing directory is created, an unusable entry is ignored.
    const deep = path.join(dir, "does", "not", "exist", "yet");
    writeProjectCache(deep, "/repos/app", {
      name: "later",
      root: "/repos/app",
    });
    assert.deepEqual(readProjectCache(deep, "/repos/app"), {
      name: "later",
      root: "/repos/app",
    });
    writeProjectCache(deep, "/repos/blank", { name: "", root: "" });
    assert.equal(readProjectCache(deep, "/repos/blank"), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unwrapToolResult: peels the MCP envelope, prefers structuredContent, null on isError/garbage", () => {
  const payload = { projects: [{ name: "app", path: "/repos/app" }] };
  assert.deepEqual(
    unwrapToolResult({
      content: [{ type: "text", text: JSON.stringify(payload) }],
      isError: false,
    }),
    payload,
  );
  assert.deepEqual(
    unwrapToolResult({
      content: [{ type: "text", text: "{}" }],
      structuredContent: payload,
    }),
    payload,
  );
  assert.equal(
    unwrapToolResult({
      content: [{ type: "text", text: JSON.stringify(payload) }],
      isError: true,
    }),
    null,
  );
  assert.equal(unwrapToolResult({ content: [{ type: "text", text: "not json" }] }), null);
  assert.equal(unwrapToolResult({ content: [] }), null);
  assert.equal(unwrapToolResult(null), null);
  assert.equal(unwrapToolResult("garbage"), null);
});

test("pickProjectEntry: exact path, nearest ancestor, no match, key aliases", () => {
  const payload = {
    projects: [
      { name: "outer", path: "/repos" },
      { name: "inner", path: "/repos/app" },
      { name: "other", path: "/elsewhere" },
    ],
  };
  assert.deepEqual(pickProjectEntry(payload, "/repos/app"), {
    name: "inner",
    root: "/repos/app",
  });
  assert.deepEqual(pickProjectEntry(payload, "/repos/app/src/deep"), {
    name: "inner",
    root: "/repos/app",
  });
  assert.deepEqual(pickProjectEntry(payload, "/repos/other-app"), {
    name: "outer",
    root: "/repos",
  });
  assert.equal(pickProjectEntry(payload, "/nowhere"), null);
  assert.equal(pickProjectEntry({ unexpected: true }, "/repos/app"), null);
  assert.equal(pickProjectEntry(payload, ""), null);
  assert.deepEqual(pickProjectEntry([{ project_name: "graph", repo_path: "/repos/app" }], "/repos/app/lib"), {
    name: "graph",
    root: "/repos/app",
  });
});

test("graphQueryFromToolInput: MCP argument names, not CLI flags", () => {
  assert.deepEqual(graphQueryFromToolInput("Grep", { pattern: "handleRequest" }), { arg: "name_pattern", value: "handleRequest" });
  assert.deepEqual(graphQueryFromToolInput("Glob", { pattern: "**/*.mjs" }), {
    arg: "file_pattern",
    value: "**/*.mjs",
  });
  assert.equal(graphQueryFromToolInput("Grep", { pattern: "" }), null);
  assert.equal(graphQueryFromToolInput("Grep", { pattern: "   " }), null);
  assert.equal(graphQueryFromToolInput("Grep", { pattern: "x".repeat(201) }), null);
  assert.equal(graphQueryFromToolInput("Grep", {}), null);
  assert.equal(graphQueryFromToolInput("Read", { pattern: "x" }), null);
  assert.equal(graphQueryFromToolInput("Grep", null), null);
});

test("formatSessionContext / formatSubagentContext: project, index state, steer", () => {
  const ctx = formatSessionContext("app", { status: "ready", files: 42 });
  assert.notEqual(ctx, null);
  assert.equal(ctx?.includes("app"), true);
  assert.equal(ctx?.includes("ready"), true);
  assert.equal(ctx?.includes("mcp__codebase-memory__"), true);
  assert.equal(formatSessionContext("", { status: "ready" }), null);
  assert.notEqual(formatSessionContext("app", "garbage"), null);
  const sub = formatSubagentContext("app", { status: "ready" });
  assert.equal(sub?.includes("app"), true);
  assert.equal((sub ?? "").length <= (formatSessionContext("app", { status: "ready" }) ?? "").length, true);
  assert.equal(formatSubagentContext("", {}), null);
});

test("formatSymbolContext: reads cols/groups/rows, prefixes the qualified name, caps at the limit", () => {
  const ctx = formatSymbolContext(SEARCH_JSON, 10);
  assert.notEqual(ctx, null);
  assert.equal(ctx?.includes("- app.handleRequest — src/server.mjs:12"), true);
  assert.equal(ctx?.includes("- app.util.slugify — src/util.mjs:7"), true);
  assert.equal(ctx?.includes("mcp__codebase-memory__"), true);
  assert.equal(
    formatSymbolContext(SEARCH_JSON, 1)
      ?.split("\n")
      .filter((l) => l.startsWith("- ")).length,
    1,
  );
  assert.equal(formatSymbolContext({ ...SEARCH_JSON, groups: [] }, 10), null);
  assert.equal(
    formatSymbolContext(
      {
        total: 0,
        count: 0,
        groups: [{ qn_prefix: "", file: "a", rows: [["x"]] }],
      },
      10,
    ),
    null,
  ); // no cols
  assert.equal(formatSymbolContext({ results: [{ qualified_name: "old.shape" }] }, 10), null); // pre-rework shape is silence
  assert.equal(formatSymbolContext(null, 10), null);
});

test("formatSymbolContext: truncates to CONTEXT_CHAR_LIMIT", () => {
  const rows = Array.from({ length: 10 }, (_, i) => [`${"S".repeat(300)}${i}`, "function", `${i + 1}-${i + 9}`, 0, 0]);
  const ctx = formatSymbolContext(
    {
      cols: ["name", "label", "lines", "in", "out"],
      groups: [{ qn_prefix: "pkg.", file: `src/${"d".repeat(300)}/f.mjs`, rows }],
    },
    10,
  );
  assert.equal((ctx ?? "").length <= CONTEXT_CHAR_LIMIT, true);
});

test("formatCoverageContext: warns on a real gap, silent on no-signal payloads", () => {
  const warn = formatCoverageContext(COVERAGE_GAP, "src/server.mjs");
  assert.notEqual(warn, null);
  assert.equal(warn?.includes("src/server.mjs"), true);
  assert.equal(warn?.includes("not_indexed"), true);
  assert.equal(formatCoverageContext(COVERAGE_UNAVAILABLE, "src/server.mjs"), null);
  assert.equal(
    formatCoverageContext(
      {
        paths: [
          {
            requested_path: "src/server.mjs",
            coverage_lookup: "ok",
            status: "indexed",
            freshness: "current",
            recommended_action: "none",
          },
        ],
      },
      "src/server.mjs",
    ),
    null,
  );
  assert.notEqual(
    formatCoverageContext(
      {
        paths: [{ path: "src/server.mjs", coverage_lookup: "ok", indexed: false }],
      },
      "src/server.mjs",
    ),
    null,
  );
  assert.equal(formatCoverageContext(COVERAGE_GAP, "src/other.mjs"), null); // no matching paths[] entry
  assert.equal(formatCoverageContext(COVERAGE_GAP, ""), null);
  assert.equal(formatCoverageContext({ status: "skipped" }, "src/server.mjs"), null); // pre-rework flat shape is silence
  assert.equal(formatCoverageContext("garbage", "src/server.mjs"), null);
});

test("relativeToProject: inside, exact root, outside", () => {
  assert.equal(relativeToProject("/repos/app", "/repos/app/src/server.mjs"), "src/server.mjs");
  assert.equal(relativeToProject("/repos/app", "/repos/app"), ".");
  assert.equal(relativeToProject("/repos/app", "/repos/other/a.mjs"), null);
  assert.equal(relativeToProject("", "/repos/app/a.mjs"), null);
  assert.equal(relativeToProject("/repos/app", ""), null);
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
