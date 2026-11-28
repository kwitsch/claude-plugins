// ─────────────────────────────────────────────────────────────────────────────
// build-task-design.workflow.js — the design pipeline of the design-task skill
//
//   Scout → 1..N read-only explorers (one per lens) → (graphmind path only) one
//   project-memory recall → the explore-scribe agent writes the reports, each
//   between a lens header and footer, to EXPLORE_PATH and reads them back →
//   one size agent (size-task tool, own reasoning as fallback) → the designer
//   writes the draft to DRAFT_PATH → review gate → at most one revision round
//   → recheck.
//
// The design-task skill never reads either file. Every run is a full run: the
// skill runs this script again only when the exploration must be redone, and
// answers every other decision by dispatching the designer itself. Intent
// acceptance (human) stays outside the workflow — workflow scripts have no
// AskUserQuestion.
//
// Args: { TASK, EXPLORE_PATH, DRAFT_PATH, GRAPHMIND_AVAILABLE?, REPO_PATH? }
//   TASK         — design task text (the prompt, plus an exploration focus and
//                  earlier binding decisions when the skill runs it again)
//   EXPLORE_PATH — absolute path of the exploration file to write
//                  (create/overwrite)
//   DRAFT_PATH   — absolute path of the draft file to write (create/overwrite)
//   GRAPHMIND_AVAILABLE — optional; true ⇒ the per-lens explorers use the
//                  graphmind MCP tools (default subagent) instead of the
//                  built-in Explore agent, and the designer and design
//                  reviewer get a graphmind hint. Requires a non-empty REPO_PATH.
//   REPO_PATH    — optional; absolute repo root (git rev-parse
//                  --show-toplevel), passed as graphmind's project.
//
// Exit contract (every return except 'error' carries explorePath,
// exploreWritten, size, sizeLine and draftPath):
//   'complete' — { status, explorePath, exploreWritten: true, subsystems,
//                  size, sizeLine, draftPath, keypoints, minorFindings }
//   'blocked'  — { status, stage: 'Explore' | 'Design', reason, explorePath,
//                  exploreWritten, size, sizeLine, draftPath, keypoints (open
//                  design questions only), questions: 1-4 items
//                  { id, question, options (2-4), whyItMatters } }
//   'error'    — { status, stage: 'args', error }
//
// Invocation contract:
//   - PRIMARY: the plugin workflow `build-task-design` (by name, namespaced by the plugin, args)
//     with ONE JSON object as args — the script reads it as the global `args`.
//   - FALLBACK (decodeArgs reports "args global is undefined"): prepend
//     EXACTLY ONE line right after the meta block: `const args = { … }`
//     (JSON literal) and submit the text via `script` without the tool-level
//     `args` parameter.
//   - No clock reads, randomness or FS in the script — the files are written
//     by the explore-scribe agent and the designer.
//
// Models: scout, explorers, memory recall, scribe and size agent on haiku;
// designer sonnet | opus | fable (from the size, default opus; fable falls back
// to opus on a dispatch throw), design reviewer sonnet.
// ─────────────────────────────────────────────────────────────────────────────

export const meta = {
  name: "build-task-design",
  description: "Design task → scout → explorers → exploration file → size → reviewed design draft; exits complete or blocked with decide-ready questions",
  phases: [
    { title: "Scout", detail: "Survey the repository and pick 1-4 lenses" },
    { title: "Explore", detail: "One read-only explorer per lens, plus the graphmind memory recall" },
    { title: "Scribe", detail: "Write each lens report between header and footer to EXPLORE_PATH and check the pairs" },
    { title: "Size", detail: "Size the task with the size-task tool (own reasoning as fallback)" },
    { title: "Design", detail: "Write/revise draft, review gate, validate open questions" },
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
const A = decodeArgs(["TASK", "EXPLORE_PATH", "DRAFT_PATH"], { GRAPHMIND_AVAILABLE: false, REPO_PATH: "" });
if (A.__error) return { status: "error", stage: "args", error: A.__error };
const { TASK, EXPLORE_PATH, DRAFT_PATH, GRAPHMIND_AVAILABLE, REPO_PATH } = A;
for (const [k, v] of [["EXPLORE_PATH", EXPLORE_PATH], ["DRAFT_PATH", DRAFT_PATH]]) {
  if (typeof v !== "string" || !v.startsWith("/")) return { status: "error", stage: "args", error: k + " must be an absolute path" };
}
// Availability is decided once in design-task/SKILL.md and threaded in (see
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
// A hint is appended to the designer and design-reviewer prompts only when graphmind was found.
const gmHint = (purpose, project) =>
  USE_GRAPHMIND
    ? `\n\nHint: graphmind indexes this repository. Optionally load its tools with ToolSearch(query: "select:mcp__graphmind__gm_search,mcp__graphmind__gm_outline,mcp__graphmind__gm_fn,mcp__graphmind__gm_deps") and use them ${purpose} rather than broad Grep/Read; pass project: ${project} on every call. Fall back to Read/Grep when a call errors or returns nothing.`
    : "";

const MODELS = { scout: "haiku", explorer: "haiku", scribe: "haiku", size: "haiku", designReview: "sonnet" };
// Designer model is chosen per run from the Size stage's result (S/M/L/XL).
const DESIGN_MODEL = { S: "sonnet", M: "opus", L: "opus", XL: "fable" };
const designerModel = (s) => DESIGN_MODEL[String(s).toUpperCase()] || "opus";

// Prepended to every inline prompt below — same wording as the rule baked into
// every plugin agents/*.md file: these agents run headless inside a Workflow, so
// any prose between tool calls is wasted tokens no one reads.
const NO_NARRATION = "No narrative text between tool calls — call tools silently and speak only in your final message (the report or structured output). Write that final message in English, whatever the language of the task or its inputs; commit messages are not covered.";

const MAX_PARALLEL_EXPLORES = 4;
const MAX_OPEN_QUESTIONS = 4; // question limit of the decide skill in the orchestrator
// Decide-ready answer options of the blocked exits.
const REEXPLORE = "Re-run explore";
const RETRY = "Retry the design";
const STOP = "Stop";

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
const SIZE_RESULT = {
  type: "object",
  required: ["size", "line"],
  properties: {
    size: { enum: ["S", "M", "L", "XL"] },
    line: { type: "string" },
  },
};
const OPEN_QUESTION = {
  type: "object",
  required: ["id", "question", "options", "whyItMatters"],
  properties: {
    id: { type: "string" },
    question: { type: "string" },
    options: { type: "array", items: { type: "string" }, description: "2-4 concrete options; free text arrives via the Other option outside the workflow" },
    whyItMatters: { type: "string", description: "what in the design changes with the answer" },
  },
};
const DESIGN_RESULT = {
  type: "object",
  required: ["status", "keypoints", "openQuestions"],
  properties: {
    status: { enum: ["done", "blocked"] },
    detail: { type: "string" },
    keypoints: { type: "string", description: "the draft's Keypoints section verbatim and nothing else; never put open questions in it" },
    openQuestions: { type: "array", items: OPEN_QUESTION, description: "the open user-decidable questions, one object each; empty array when the design is decision-complete" },
  },
};
const DESIGN_REVIEW = {
  type: "object",
  required: ["approved", "findings", "questionVerdicts"],
  properties: {
    approved: { type: "boolean" },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "description"],
        properties: {
          severity: { enum: ["blocking", "minor"] },
          description: { type: "string" },
        },
      },
    },
    // Question validation: 'genuine' = only the user can decide it;
    // 'resolvable' = answerable from code/context → resolution says how.
    questionVerdicts: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "verdict"],
        properties: {
          id: { type: "string" },
          verdict: { enum: ["genuine", "resolvable"] },
          resolution: { type: "string" },
        },
      },
    },
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// EXPLORE STAGES  (Scout → Explore → Scribe)
// A failed stage is recorded, not returned: the Size stage still runs, so every
// exit carries a size. A Scout failure skips Explore and Scribe; an Explore
// failure skips Scribe.
// ═════════════════════════════════════════════════════════════════════════════
let subsystems = [];

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

// Returns null when the exploration file was written intact, else { stage, error }.
async function runExplore() {
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
  if (!scout) return { stage: "Scout", error: "scout returned no result" };

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
  subsystems = proposed.slice(0, MAX_PARALLEL_EXPLORES);
  if (subsystems.length === 0) subsystems.push({ name: "whole task", focus: TASK });
  log("Scout: " + subsystems.length + " exploration target(s)");

  if (subsystems.some((x) => x.name === "graphmind memory")) return { stage: "Scout", error: "a scout lens is named graphmind memory, which is reserved for the memory recall" };
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
  if (!exploreOuts.some((r) => r && r.report)) return { stage: "Explore", error: "all explorers returned null" };
  const memo = USE_GRAPHMIND && recalled && typeof recalled.report === "string" ? recalled.report.trim() : "";
  const lensEntries = [
    ...subsystems.map((s, i) => [s.name, exploreOuts[i] && exploreOuts[i].report ? exploreOuts[i].report : ""]),
    ...(memo && memo !== "none" ? [[MEMORY_LENS, memo]] : []),
  ].filter(([, body]) => body);
  const expectedLenses = lensEntries.map(([name]) => name);
  const lenses = lensEntries.map(([name, body]) => lensBlock(name, body));

  // SCRIBE  (the script has no FS access, and the skill must never hold the
  //          exploration text: the explore-scribe agent writes and reads back)
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
  if (problems.length) return { stage: "Scribe", error: "scribe could not write EXPLORE_PATH intact (" + problems.join("; ") + ")" };

  log("Exploration written to " + EXPLORE_PATH);
  return null;
}

const exploreError = await runExplore();
const exploreWritten = exploreError === null;
if (exploreError) log("Exploration failed (" + exploreError.stage + ": " + exploreError.error + ") — sizing anyway");

// ═════════════════════════════════════════════════════════════════════════════
// SIZE  (one inline agent calls the size-task tool; sizing never fails the run)
// ═════════════════════════════════════════════════════════════════════════════
phase("Size");
// Empty when the scout failed: the tool is then called without subsystems.
const sizeSubsystems = subsystems.map((s) => s.name + " — " + s.focus);
const sizePrompt = `${NO_NARRATION}\n\nYou size a software task. Do not explore the repository and never edit anything.
1. Load the tool: ToolSearch(query: "select:mcp__taskflow__size-task").
2. Call mcp__taskflow__size-task with task = the task text between the <<<TASK>>> markers below, verbatim${sizeSubsystems.length ? ", and subsystems = " + JSON.stringify(sizeSubsystems) : "; omit subsystems"}.
3. The tool's result text starts with the size letter: return size = that letter (S, M, L or XL) and line = the result text verbatim (e.g. "M (jev-api, probability 0.81)").
4. The tool is missing or returns an error: decide the size yourself from the task text — S one single edit in one place, M a feature or fix with tests inside one plugin, L several distinct parts, a whole plugin or two to four plugins, XL repository-wide — and return line = "<X> (own reasoning: <one-sentence reason>)".
Structured output only.
<<<TASK>>>
${TASK}
<<<END TASK>>>`;
const sizeOpts = { label: "size", phase: "Size", schema: SIZE_RESULT, model: MODELS.size };
let sized = await agent(sizePrompt, sizeOpts);
if (!sized) sized = await agent(sizePrompt, { ...sizeOpts, label: "size:retry" });
// No result twice ⇒ the default M, so every exit still carries a size.
const SIZE = sized ? sized.size : "M";
const SIZE_LINE = sized ? sized.line : "M (size agent returned no result; default)";
let DESIGNER_MODEL = designerModel(SIZE);
log("Size " + SIZE_LINE + " → designer: " + DESIGNER_MODEL);

// Fields every non-args return carries.
const common = () => ({ explorePath: EXPLORE_PATH, exploreWritten, size: SIZE, sizeLine: SIZE_LINE, draftPath: DRAFT_PATH });
const blocked = (stage, reason, questions, extra) => ({ status: "blocked", stage, reason, ...common(), ...(extra || {}), questions });

if (exploreError) {
  const why = exploreError.stage + ": " + exploreError.error;
  log("Exit: blocked — exploration failed");
  return blocked("Explore", why, [{
    id: "explore",
    question: "Exploration failed (" + why + "). Re-run it?",
    options: [REEXPLORE, STOP],
    whyItMatters: "The design reads the exploration file; a free-text answer is added to the task as the exploration focus.",
  }]);
}

// ═════════════════════════════════════════════════════════════════════════════
// DESIGN  (write draft → review gate → optional 1 revision round)
// ═════════════════════════════════════════════════════════════════════════════
phase("Design");

const designerPrompt = (mode, extra) =>
  `${mode}
Task:
${TASK}

Draft file to write (create/overwrite): ${DRAFT_PATH}
Open-question cap: ${MAX_OPEN_QUESTIONS} (2-4 options each).${gmHint("to verify the files, symbols and signatures the exploration reports mention", JSON.stringify(REPO))}
Draft requirements, question bar, and self-review checklist per your role
definition.
## Exploration reports
Read the exploration file at ${EXPLORE_PATH} before designing (written by the Scribe stage of this workflow).

${extra}
Return structured output: status, the Keypoints section verbatim as the
\`keypoints\` STRING field, and \`openQuestions\` as its OWN top-level array
field (empty array when decision-complete) — never embedded as text/tags
inside \`keypoints\`.`;

// A full re-run (design-task) reuses DRAFT_PATH and carries earlier user answers in TASK as
// "Binding user decisions from earlier rounds": the designer must Read an existing draft before
// Write may overwrite it, and must record those answers so the reviewer's USER DECISION check sees them.
const initialMode = "This is a fresh run: produce the first complete draft. If the draft file already exists from an earlier run, Read it first (Write refuses to overwrite an unread file) and replace its whole content. Any 'Binding user decisions from earlier rounds' in the task are user answers: record each under Decisions & assumptions as 'USER DECISION' and never reverse them.";

// A schema-valid result can still be garbage: observed in production, the designer
// sometimes fails to place openQuestions in its own structured-output field and
// instead embeds it as literal `<openQuestions>...</openQuestions>` (even a stray
// `</invoke>`) text inside the `keypoints` string — schema validation passes (it's
// still just a string), but the result is unusable. Treat that shape as a failed
// call, same as a null result, so it gets the same retry.
/** @param {any} d @returns {boolean} */
function hasContaminatedKeypoints(d) {
  const kp = d && typeof d.keypoints === "string" ? d.keypoints : "";
  return /<openQuestions|<\/invoke/i.test(kp);
}

// DESIGNER_MODEL can be downgraded permanently for the rest of this run: an
// account/session without Fable access throws on dispatch rather than
// returning null, so an XL task must not be stuck retrying 'fable'.
async function runDesigner(mode, extra, label) {
  const opts = (l) => ({ label: l, phase: "Design", schema: DESIGN_RESULT, model: DESIGNER_MODEL, agentType: "taskflow:designer" });
  const run = async (l) => {
    try {
      return await agent(designerPrompt(mode, extra), opts(l));
    } catch (e) {
      if (DESIGNER_MODEL !== "fable") throw e;
      log("designer dispatch on fable failed (" + e.message + ") — falling back to opus for the rest of this run");
      DESIGNER_MODEL = "opus";
      return await agent(designerPrompt(mode, extra), opts(l + ":fable-fallback"));
    }
  };
  let d = await run(label);
  if (d === null || hasContaminatedKeypoints(d)) {
    if (d === null && DESIGNER_MODEL === "fable") {
      log("designer on fable returned null (usage limit?) — retrying on opus");
      DESIGNER_MODEL = "opus";
    }
    d = await run(label + ":retry");
  }
  // A contaminated retry is as unusable as null — fail rather than show it.
  return d === null || hasContaminatedKeypoints(d) ? null : d;
}

const designReviewerPrompt = `Design task:
${TASK}

Draft to review: ${DRAFT_PATH}
Apply your full checklist (role definition) against the codebase where
needed. The draft builds on explorer reports from a lightweight model: verify
that every file path, symbol and signature the draft relies on actually exists
in the codebase, and flag any that do not as blocking.${gmHint("to check that those files, symbols and signatures exist", JSON.stringify(REPO))} Structured output only.`;

async function reviewDesign(label) {
  const opts = { label, phase: "Design", schema: DESIGN_REVIEW, model: MODELS.designReview, agentType: "taskflow:design-reviewer" };
  let r = await agent(designReviewerPrompt, opts);
  if (r === null) r = await agent(designReviewerPrompt, { ...opts, label: label + ":retry" });
  if (r && !Array.isArray(r.findings)) r.findings = [];
  return r;
}

// D1: the designer is blocked or returned nothing usable.
const designerBlocked = (reason) => {
  log("Exit: blocked — " + reason);
  return blocked("Design", reason, [{
    id: "design-blocked",
    question: "The designer is blocked: " + reason + ". How should the design continue?",
    options: [REEXPLORE, RETRY, STOP],
    whyItMatters: "Re-run explore explores again with this reason as focus; Retry or a free-text answer starts the designer again with that answer.",
  }]);
};
// D2: the design reviewer returned nothing twice.
const reviewFailed = (reason) => {
  log("Exit: blocked — " + reason);
  return blocked("Design", reason, [{
    id: "review-failed",
    question: "The design reviewer returned no result. How should the design continue?",
    options: [RETRY, REEXPLORE, STOP],
    whyItMatters: "Retry has the designer re-check and finish the draft without a further review; Re-run explore runs the whole workflow again, review included.",
  }]);
};

let design = await runDesigner(initialMode, "", "design");
if (!design) return designerBlocked("designer returned null twice");
if (design.status === "blocked") return designerBlocked(design.detail || "designer blocked without a detail");
let review = await reviewDesign("design-review");
if (!review) return reviewFailed("design reviewer returned null twice");

// Exactly one revision round: fix blocking findings + decide 'resolvable'
// questions ourselves (using the reviewer's resolution as a hint).
const blocking = review.findings.filter((f) => f.severity === "blocking");
const resolvable = (review.questionVerdicts || []).filter((v) => v.verdict === "resolvable");
if (blocking.length || resolvable.length) {
  log("Design review: " + blocking.length + " blocking, " + resolvable.length + " resolvable question(s) — one revision round");
  const revisionExtra = `## Revision input (from the design review)
Blocking findings to fix:\n${JSON.stringify(blocking)}\n
Questions judged RESOLVABLE — decide them yourself now (the reviewer's
suggested resolution is a hint, verify it against the code), record each under
Decisions & assumptions, and remove them from Open questions:\n${JSON.stringify(resolvable)}\n
User decisions already recorded in the draft remain binding.\n`;
  design = await runDesigner("This is a REVISION round on the existing draft at " + DRAFT_PATH + " — revise it in place.", revisionExtra, "design:revise");
  if (!design || design.status === "blocked") return designerBlocked("designer failed during revision");
  review = await reviewDesign("design-recheck");
  if (!review) return reviewFailed("design reviewer failed on recheck");
  const stillBlocking = review.findings.filter((f) => f.severity === "blocking");
  if (stillBlocking.length) {
    // D3: blocking findings survived the revision round.
    log("Exit: blocked — design still blocking after one revision");
    return blocked("Design", "design still blocking after one revision", [{
      id: "findings",
      question: "Blocking review findings remain after the revision round: " + JSON.stringify(stillBlocking) + ". How should the design continue?",
      options: ["Run another design round", STOP],
      whyItMatters: "Another round has the designer revise the draft against exactly these findings.",
    }]);
  }
}

// ── Exit gate: remaining GENUINE questions ⇒ blocked with them (draft stays at DRAFT_PATH) ─
const verdictOf = {};
for (const v of review.questionVerdicts || []) verdictOf[v.id] = v.verdict;
const genuineQuestions = (design.openQuestions || [])
  .filter((q) => (verdictOf[q.id] || "genuine") === "genuine") // unrated questions are conservatively treated as genuine
  .slice(0, MAX_OPEN_QUESTIONS);

if (genuineQuestions.length > 0) {
  // D4: open design questions only the user can decide, each {id, question, options[2-4], whyItMatters}.
  log("Exit: blocked — " + genuineQuestions.length + " open design question(s); draft persisted at " + DRAFT_PATH);
  return blocked("Design", "open design questions", genuineQuestions, { keypoints: design.keypoints });
}

log("Exit: design complete at " + DRAFT_PATH);
return {
  status: "complete",
  ...common(),
  subsystems: subsystems.map((s) => ({ name: s.name, focus: s.focus })),
  keypoints: design.keypoints, // verbatim for the intent acceptance in the design-task skill
  minorFindings: (review.findings || []).filter((f) => f.severity === "minor"),
};
