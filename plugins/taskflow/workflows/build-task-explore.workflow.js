// ─────────────────────────────────────────────────────────────────────────────
// build-task-explore.workflow.js — build-task design pipeline, phase 1 of 3
//
//   Scout → 1..N read-only explorers (one per lens) → (graphmind path only) one
//   project-memory recall → the explore-scribe agent writes the reports, each
//   between a lens header and footer, to EXPLORE_PATH and reads them back.
//
// The build-task skill never reads that file; it hands the path on to
// build-task-design.workflow.js. Runs once per build-task invocation: resumes and
// intent corrections re-run only the design script, which reads the same file.
//
// Args: { TASK, EXPLORE_PATH, GRAPHMIND_AVAILABLE?, REPO_PATH? }
//   TASK         — design task / work description
//   EXPLORE_PATH — absolute path of the exploration file to write
//                  (create/overwrite)
//   GRAPHMIND_AVAILABLE — optional; true ⇒ the per-lens explorers use the
//                  graphmind MCP tools (default subagent) instead of the
//                  built-in Explore agent. Requires a non-empty REPO_PATH.
//   REPO_PATH    — optional; absolute repo root (git rev-parse
//                  --show-toplevel), passed as graphmind's project.
//
// Exit contract:
//   'complete' — { status, explorePath, subsystems: [{ name, focus }] }
//   'error'    — { status, stage: 'args' | 'Scout' | 'Explore' | 'Scribe', error }
//
// Invocation contract:
//   - PRIMARY: the plugin workflow `build-task-explore` (by name, namespaced by the plugin, args)
//     with ONE JSON object as args — the script reads it as the global `args`.
//   - FALLBACK (decodeArgs reports "args global is undefined"): prepend
//     EXACTLY ONE line right after the meta block: `const args = { … }`
//     (JSON literal) and submit the text via `script` without the tool-level
//     `args` parameter.
//   - No clock reads, randomness or FS in the script — the file is written by
//     the explore-scribe agent.
//
// Models: scout, explorers, memory recall and scribe on haiku.
// ─────────────────────────────────────────────────────────────────────────────

export const meta = {
  name: "build-task-explore",
  description: "Design task → scout → read-only explorers → exploration reports written to EXPLORE_PATH",
  phases: [
    { title: "Scout", detail: "Survey the repository and pick 1-4 lenses" },
    { title: "Explore", detail: "One read-only explorer per lens, plus the graphmind memory recall" },
    { title: "Scribe", detail: "Write each lens report between header and footer to EXPLORE_PATH and check the pairs" },
  ],
};

// ── Inputs via the `args` global (decoder with fail-fast guard) ─────────────
function decodeArgs(required, defaults) {
  let a = typeof args === "undefined" ? null : args;
  // The runtime delivers args as a JSON STRING instead of an object depending
  // on the invocation path (observed for named invocation) — parse
  // tolerantly, including double-encoded; only genuinely unusable input
  // fails hard.
  for (let i = 0; typeof a === "string" && i < 2; i++) {
    try {
      a = JSON.parse(a);
    } catch (e) {
      return { __error: "args arrived as a non-JSON string (\"" + a.slice(0, 120) + "\") — pass ONE JSON object with keys: " + required.join(", ") };
    }
  }
  if (typeof a !== "object" || a === null || Array.isArray(a)) {
    const kind = a === null ? (typeof args === "undefined" ? "undefined" : "null") : Array.isArray(a) ? "an array" : typeof a;
    return {
      __error: "args global is "
        + kind
        + " — invoke this as a saved/plugin workflow WITH a JSON object as input, or prepend `const args = {…}` to the script text; the ad-hoc {script, args} tool-call shape does not thread args.",
    };
  }
  const missing = required.filter((k) => a[k] == null || a[k] === "");
  if (missing.length) return { __error: "missing required args: " + missing.join(", ") + " (got keys: " + Object.keys(a).join(", ") + ")" };
  return { ...defaults, ...a };
}
const A = decodeArgs(["TASK", "EXPLORE_PATH"], { GRAPHMIND_AVAILABLE: false, REPO_PATH: "" });
if (A.__error) return { status: "error", stage: "args", error: A.__error };
const { TASK, EXPLORE_PATH, GRAPHMIND_AVAILABLE, REPO_PATH } = A;
// Availability is decided once in build-task/SKILL.md and threaded in (see
// .claude/rules/script-authoring.md §4). Accept the "true" string too — args
// can arrive JSON-string-encoded. A set flag with no absolute REPO_PATH fails
// loud (an empty project would make graphmind answer from the checkout its MCP
// server started in — silent wrong-branch results in a worktree).
const REPO = typeof REPO_PATH === "string" ? REPO_PATH.trim() : "";
const wantGraphmind = GRAPHMIND_AVAILABLE === true || GRAPHMIND_AVAILABLE === "true";
const USE_GRAPHMIND = wantGraphmind && REPO.startsWith("/");
if (wantGraphmind && !USE_GRAPHMIND) {
  return { status: "error", stage: "args", error: "GRAPHMIND_AVAILABLE=true requires a non-empty absolute REPO_PATH" };
}

const MODELS = { scout: "haiku", explorer: "haiku", scribe: "haiku" };

// Prepended to every inline prompt below — same wording as the rule baked into
// every plugin agents/*.md file: these agents run headless inside a Workflow, so
// any prose between tool calls is wasted tokens no one reads.
const NO_NARRATION = "No narrative text between tool calls — call tools silently and speak only in your final message (the report or structured output). Write that final message in English, whatever the language of the task or its inputs; commit messages are not covered.";

const MAX_PARALLEL_EXPLORES = 4;

// ── Schemas ──────────────────────────────────────────────────────────────────
const SCOUT_SCHEMA = {
  type: "object",
  required: ["subsystems"],
  properties: {
    subsystems: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "focus"],
        properties: { name: { type: "string" }, focus: { type: "string" } },
      },
    },
  },
};
const EXPLORE_SCHEMA = {
  type: "object",
  required: ["report"],
  properties: { report: { type: "string" } },
};
const WRITE_RESULT = {
  type: "object",
  required: ["status"],
  properties: {
    status: { enum: ["written", "blocked"] },
    detail: { type: "string" },
    lensHeaders: { type: "array", items: { type: "string" } },
    lensFooters: { type: "array", items: { type: "string" } },
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// SCOUT  (pick 1..N lenses)
// ═════════════════════════════════════════════════════════════════════════════
phase("Scout");
log("Explore path: " + (USE_GRAPHMIND ? "graphmind MCP tools" : "Explore agent"));

const scoutPrompt = `${NO_NARRATION}\n\nYou are a read-only scout. Task to be designed:\n${TASK}\n
Survey the repository just enough to answer:
1. subsystems — the 1-${MAX_PARALLEL_EXPLORES} lenses an explorer should each dig into
   (name: a short lens name of a few words, used as the job label and section
   header; focus: one line on what to find there). For a single-subsystem
   task, return exactly one subsystem covering the whole task.
Do not design anything. Structured output only.`;

const scout = await agent(scoutPrompt, {
  label: "scout",
  phase: "Scout",
  schema: SCOUT_SCHEMA,
  model: MODELS.scout,
  agentType: "Explore",
});
if (!scout) {
  return {
    status: "error",
    stage: "Scout",
    error: "scout returned no result",
  };
}

// Dedup WITHIN this single scout response (trim+lowercase exact-match key) — a
// duplicate name in one call would otherwise burn a budget slot on exploring
// the same lens twice instead of a genuinely distinct one. A free-form
// LLM-chosen name's literal '|' is replaced with '/' so no downstream name
// (the '## Lens: <name>' headers, the dedup key) carries a pipe.
const seenProposedNames = new Set();
const proposed = Array.isArray(scout.subsystems)
  ? scout.subsystems
    .filter((s) => s && typeof s.name === "string" && s.name.trim() !== "")
    .map((s) => ({ ...s, name: s.name.replace(/[\r\n]+/g, " ").replace(/\|/g, "/").replace(/^#+\s*/, "").trim() }))
    .filter((s) => s.name !== "")
    .filter((s) => {
      const key = s.name.toLowerCase();
      if (seenProposedNames.has(key)) return false;
      seenProposedNames.add(key);
      return true;
    })
  : [];
const subsystems = proposed.slice(0, MAX_PARALLEL_EXPLORES);
if (subsystems.length === 0) subsystems.push({ name: "whole task", focus: TASK });
log("Scout: " + subsystems.length + " exploration target(s)");

// ═════════════════════════════════════════════════════════════════════════════
// EXPLORE  (one read-only explorer per lens + the graphmind memory recall)
// ═════════════════════════════════════════════════════════════════════════════
const explorerPrompt = (s) =>
  `${NO_NARRATION}\n\nYou are a read-only codebase explorer (never edit anything). Task being
designed:\n${TASK}\n\n
Your lens: ${s.name} — ${s.focus}
Report for the designer: relevant files (exact paths), existing patterns and
conventions to follow, the real flow end to end, key signatures/interfaces the
design must match, recent related commits, constraints and pitfalls you can
see in the code. Dense and exact — file paths and symbol names, not prose
generalities. Structured output only.`;

const graphmindExplorePrompt = (s) =>
  `${NO_NARRATION}\n\nYou are a read-only codebase explorer (never edit anything). Task being
designed:\n${TASK}\n\n
Your lens: ${s.name} — ${s.focus}
This repository is indexed by graphmind (code graph + project memory). Use it first:
1. Load the tools: ToolSearch(query: "select:mcp__graphmind__gm_search,mcp__graphmind__gm_outline,mcp__graphmind__gm_fn,mcp__graphmind__gm_deps").
2. Pass project: "${REPO}" on EVERY graphmind call (absolute checkout path — use
   exactly this value; it pins answers to this checkout's branch, worktrees included).
3. Code: mcp__graphmind__gm_search with an ENGLISH query naming the identifier or intent
   (translate the lens/focus if needed; ';' separates several queries) to locate
   symbols and files; mcp__graphmind__gm_outline for a file's structure with line
   numbers; mcp__graphmind__gm_deps for what a file imports; mcp__graphmind__gm_fn
   (file= to disambiguate) only when you need full source or callers/callees — do
   not chain it after every search.
4. The graph does not cover string literals, config values, env vars, or unindexed
   files (dotfiles, gitignored files): use Read/Grep/Glob for those. If a graphmind
   call errors or returns nothing for your lens, fall back to Read/Grep/Glob yourself
   and still produce the report — never return empty for a recoverable failure.
5. graphmind does not cover git history: run \`git log --oneline -n 15\` (and, when
   useful, scoped to the lens's paths) via Bash yourself for recent related commits.
Project memory (decisions, conventions, known bugs) is recalled once for all explorers
and handed to the designer separately — do not search it yourself or repeat it.
Report for the designer: relevant files (exact paths), existing patterns and
conventions to follow, the real flow end to end, key signatures/interfaces the design
must match, recent related commits, constraints and pitfalls. Dense and exact — file
paths and symbol names, not prose generalities; write markdown, not raw JSON.
Structured output only.`;

// One project-memory recall shared by all explorers (they would otherwise each run
// near-identical gm_memory_search calls); its report becomes the "graphmind memory" lens below.
const graphmindRecallPrompt = () =>
  `${NO_NARRATION}\n\nYou are a read-only knowledge recaller (never edit anything). Task being
designed:\n${TASK}\n\n
Lenses under exploration: ${subsystems.map((s) => s.name + " — " + s.focus).join("; ")}
1. Load the tool: ToolSearch(query: "select:mcp__graphmind__gm_memory_search").
2. Call mcp__graphmind__gm_memory_search with project: "${REPO}" (use exactly this value)
   and ENGLISH keywords (translate if needed) — one call per distinct theme, at most 3.
3. Report only entries that bear on the task (decisions, conventions, known bugs), one
   line each. If the tool errors or nothing relevant exists, report exactly "none".
Write markdown, not raw JSON. Structured output only.`;

if (subsystems.some((x) => x.name === "graphmind memory")) return { status: "error", stage: "Scout", error: "a scout lens is named graphmind memory, which is reserved for the memory recall" };
phase("Explore");
const exploreOpts = (s) => {
  const base = { label: s.name, phase: "Explore", schema: EXPLORE_SCHEMA, model: MODELS.explorer };
  return USE_GRAPHMIND ? base : { ...base, agentType: "Explore" };
};
const pickPrompt = (s) => (USE_GRAPHMIND ? graphmindExplorePrompt(s) : explorerPrompt(s));
// The memory recall depends only on the subsystems, so it runs in the same batch.
const recallTask = () => agent(graphmindRecallPrompt(), { label: "graphmind memory", phase: "Explore", schema: EXPLORE_SCHEMA, model: MODELS.explorer });
const batch = await parallel([...subsystems.map((s) => () => agent(pickPrompt(s), exploreOpts(s))), ...(USE_GRAPHMIND ? [recallTask] : [])]);
const exploreOuts = batch.slice(0, subsystems.length);
const recalled = USE_GRAPHMIND ? batch[subsystems.length] : null;

// Every Explore job that returned a report gets one header/footer pair; a failed
// explorer and an empty memory recall are omitted, so no placeholder reaches the designer.
const MEMORY_LENS = "graphmind memory";
// Report lines that look like a marker get a leading backslash, so only the real markers match.
const escapeMarkers = (body) => body.replace(/^(?=## Lens: |_End of lens: )/gm, "\\");
const lensBlock = (name, body) => "## Lens: " + name + "\n" + escapeMarkers(body) + "\n_End of lens: " + name + "_";
if (!exploreOuts.some((r) => r && r.report)) return { status: "error", stage: "Explore", error: "all explorers returned null" };
const memo = USE_GRAPHMIND && recalled && typeof recalled.report === "string" ? recalled.report.trim() : "";
const lensEntries = [
  ...subsystems.map((s, i) => [s.name, exploreOuts[i] && exploreOuts[i].report ? exploreOuts[i].report : ""]),
  ...(memo && memo !== "none" ? [[MEMORY_LENS, memo]] : []),
].filter(([, body]) => body);
const expectedLenses = lensEntries.map(([name]) => name);
const lenses = lensEntries.map(([name, body]) => lensBlock(name, body));

// ═════════════════════════════════════════════════════════════════════════════
// SCRIBE  (the script has no FS access, and the skill must never hold the
//          exploration text: the explore-scribe agent writes and reads back)
// ═════════════════════════════════════════════════════════════════════════════
phase("Scribe");
const scribeText = `# Exploration reports\n\n${lenses.join("\n\n")}`;
const scribePrompt = `Write the text between the BEGIN/END markers below to ${EXPLORE_PATH} (create/overwrite), byte for byte — no edits, no summary, markers excluded — then Read the file back and report its lens headers and footers.\n<<<BEGIN>>>\n${scribeText}\n<<<END>>>`;
// Compares the scribe's read-back report, not the script's own text: only the
// written file can show a truncated or altered write.
const lensProblems = (w) => {
  if (!w || w.status !== "written") return ["not written" + (w && w.detail ? " (" + w.detail + ")" : "")];
  const headers = Array.isArray(w.lensHeaders) ? w.lensHeaders.map((h) => String(h).trim()) : [];
  const footers = Array.isArray(w.lensFooters) ? w.lensFooters.map((f) => String(f).trim()) : [];
  const missing = expectedLenses.filter((n) => !headers.includes(n));
  const open = headers.filter((n) => !footers.includes(n));
  const same = (a) => a.length === expectedLenses.length && a.every((n, i) => n === expectedLenses[i]);
  return [
    ...(missing.length ? ["missing lens header(s): " + missing.join(", ")] : []),
    ...(open.length ? ["lens header(s) without footer: " + open.join(", ")] : []),
    ...(same(headers) && same(footers) ? [] : ["lens headers/footers differ from the expected lenses in count or order"]),
  ];
};
const scribeOpts = { label: "scribe", phase: "Scribe", schema: WRITE_RESULT, model: MODELS.scribe, agentType: "taskflow:explore-scribe" };
let written = await agent(scribePrompt, scribeOpts);
let problems = lensProblems(written);
if (problems.length) {
  // A file that was written is only re-read; a failed write is written again.
  const rewrite = !written || written.status !== "written";
  const followUp = rewrite
    ? scribePrompt + "\nRetry: the file may already exist from an earlier attempt; Read it first, then overwrite it."
    : `Do not write anything. Read ${EXPLORE_PATH} in full (offset/limit chunks until its end) and report its lens headers and footers.`;
  written = await agent(followUp, { ...scribeOpts, label: "scribe:retry" });
  problems = lensProblems(written);
}
if (problems.length) return { status: "error", stage: "Scribe", error: "scribe could not write EXPLORE_PATH intact (" + problems.join("; ") + ")" };

log("Exit: exploration written to " + EXPLORE_PATH);
return {
  status: "complete",
  explorePath: EXPLORE_PATH,
  subsystems: subsystems.map((s) => ({ name: s.name, focus: s.focus })),
};
