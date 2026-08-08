// ─────────────────────────────────────────────────────────────────────────────
// design-to-spec.workflow.js
//
// Workflow for the design part ahead of `spec-driven-delivery.workflow.js`:
//   Explore project → Draft design → Review design → Write spec → Review spec
//
// Derived from references/designing.md of the `feature-development` skill
// (kwitsch/claude-plugins, coding-toolbox). Intent confirmation (human) stays
// OUTSIDE the workflow — workflow scripts have no AskUserQuestion. Hence two
// exit kinds:
//
//   Exit 1 — 'complete':             Design complete, spec written to
//                                    SPEC_PATH; keypoints in the result so
//                                    the orchestrator can present them
//                                    verbatim for approval (AskUserQuestion).
//   Exit 2 — 'user_input_required':  Questions remain that only the user can
//                                    decide. The draft is fully persisted at
//                                    DRAFT_PATH; the result carries the
//                                    questions (AskUserQuestion-compatible:
//                                    ≤4 questions, 2-4 options each). The
//                                    orchestrator collects the answers and
//                                    re-runs the workflow with RESUME=true,
//                                    the same DRAFT_PATH, and the answers in
//                                    USER_INPUT.
//
// Invocation contract:
//   - PRIMARY: invoke as a saved/plugin workflow by name
//     (/<plugin>:design-to-spec) and pass inputs via the `args` parameter —
//     the script reads them as the global `args` (officially documented;
//     structured data, no escaping needed for TASK/USER_INPUT).
//   - FALLBACK (ad-hoc `script` submission): prepend the script text with
//     EXACTLY ONE line right after the meta block: `const args = { … }`
//     (JSON literal). NEVER rely on the `args` parameter of an ad-hoc
//     {script, args} call — the global arrives as `undefined` there
//     (observed silent total failure; the docs scope `args` to saved
//     workflows). decodeArgs() below fails loudly in that case.
//   - No Date.now()/Math.random()/FS in the script — everything file-related
//     runs through agent() workers; the draft is written to DRAFT_PATH by
//     the designer agent itself (persistent state between runs).
//   - Second persisted artifact: the session-scoped Explore-result cache
//     (DRAFT_PATH without its .md suffix + ".explore-<task key>.md"), written
//     by a cache-writer agent and reused by later RESUME rounds. Session-only,
//     never committed.
//   - Resume: RESUME=true ⇒ DRAFT_PATH exists and USER_INPUT holds the
//     answers to the previously returned questions (recommended: JSON
//     [{id, answer}] or free text; answers are BINDING for the designer).
//   - Restartable any number of times: if genuinely user-decidable questions
//     come up again after a resume, the run ends with Exit 2 again.
//
// Model assignment by difficulty:
//   scout     haiku   — classify complexity/subsystems
//   explorer  sonnet  — read-only codebase exploration (agentType 'explore')
//   designer  opus    — design, trade-offs, decisions (highest judgment load)
//   designRev sonnet  — consistency/scope/placeholder gate + question validation
//   specWriter sonnet — approved draft → spec (transformation, decisions stand)
//   specRev   sonnet  — completeness/unambiguity gate
//   cacheProbe  haiku  — read the Explore-cache header + one git fingerprint
//   cacheWriter sonnet — verbatim persistence of the exploration reports
// ─────────────────────────────────────────────────────────────────────────────

export const meta = {
  name: "design-to-spec",
  description: "Design task → exploration → design draft (reviewed) → spec (reviewed); exits as a finished spec or as a draft + open user questions (resumable)",
  phases: [
    { title: "Explore", detail: "Scout subsystems, explore codebase read-only" },
    { title: "Design", detail: "Write/revise draft, review gate, validate open questions" },
    { title: "Spec", detail: "Draft → spec, review gate" },
  ],
};

// ── Inputs via the `args` global (decoder with fail-fast guard) ─────────────
// Expected: { TASK, DRAFT_PATH, SPEC_PATH, RESUME?, USER_INPUT? }
//   TASK       — design task / work description
//   DRAFT_PATH — absolute path of the draft file (persisted between runs)
//   SPEC_PATH  — absolute target path of the spec (input for spec-driven-delivery)
//   RESUME     — false on the first run; true when restarting with draft + answers
//   USER_INPUT — '' on the first run; otherwise the answers to the open questions
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
      return { __error: 'args arrived as a non-JSON string ("' + a.slice(0, 120) + '") — pass ONE JSON object with keys: ' + required.join(", ") };
    }
  }
  if (typeof a !== "object" || a === null || Array.isArray(a)) {
    const kind = a === null ? (typeof args === "undefined" ? "undefined" : "null") : Array.isArray(a) ? "an array" : typeof a;
    return {
      __error:
        "args global is " +
        kind +
        " — invoke this as a saved/plugin workflow WITH a JSON object as input, or prepend `const args = {…}` to the script text; the ad-hoc {script, args} tool-call shape does not thread args.",
    };
  }
  const missing = required.filter((k) => a[k] == null || a[k] === "");
  if (missing.length) return { __error: "missing required args: " + missing.join(", ") + " (got keys: " + Object.keys(a).join(", ") + ")" };
  return { ...defaults, ...a };
}
const A = decodeArgs(["TASK", "DRAFT_PATH", "SPEC_PATH"], { RESUME: false, USER_INPUT: "" });
if (A.__error) return { status: "error", stage: "args", error: A.__error };
const { TASK, DRAFT_PATH, SPEC_PATH, RESUME, USER_INPUT } = A;
if (RESUME && !USER_INPUT) return { status: "error", stage: "args", error: "RESUME=true requires USER_INPUT (the answers to the previously returned questions)" };

const MODELS = {
  scout: "haiku", // pure classification — deliberately small
  explorer: "sonnet",
  designer: "opus",
  designReview: "sonnet",
  specWriter: "sonnet", // 1:1 transformation, no new decisions
  specReview: "sonnet", // document comparison draft↔spec
  cacheProbe: "haiku", // read 4 header lines + run one git command
  cacheWriter: "sonnet", // verbatim reproduction at length — fidelity over cost
};
// ── Plugin agent types (namespace = plugin name; keep in sync on rename).
//    An unknown type throws hard — this script assumes the taskflow plugin
//    agents are installed; the static role prompts live there.
const AGENTS = {
  designer: "taskflow:designer",
  reviewer: "taskflow:design-reviewer",
};

const MAX_PARALLEL_EXPLORES = 4;
const MAX_OPEN_QUESTIONS = 4; // AskUserQuestion limit of the orchestrator

// ── Explore-result cache (session-scoped; reused by resume rounds) ───────────
// The path is derived from DRAFT_PATH — no extra arg to thread through the two
// resume call sites of build-task/SKILL.md. The TASK key makes a changed task
// address a different file instead of relying on a string compare an agent
// would have to echo back.
function taskKey(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
const lineCount = (s) => s.split("\n").length;
const EXPLORE_CACHE_PATH = DRAFT_PATH.replace(/\.md$/i, "") + ".explore-" + taskKey(TASK) + ".md";
const CACHE_HEADER_LINES = 5; // 4 header lines + 1 blank separator before the body
const MAX_TOTAL_EXPLORE_AREAS = 6; // 4 from the first scout + at most 2 added over all resume rounds
const FINGERPRINT_CMD =
  `printf '%s|%s|%s\\n' "$(git rev-parse --show-toplevel 2>/dev/null || echo NO_REPO)" ` +
  `"$(git rev-parse HEAD 2>/dev/null || echo NO_HEAD)" ` +
  `"$(git status --porcelain 2>/dev/null | git hash-object --stdin 2>/dev/null || echo NO_STATUS)"`;

// ── Schemas ──────────────────────────────────────────────────────────────────
const SCOUT_SCHEMA = {
  type: "object",
  required: ["complexity", "subsystems"],
  properties: {
    complexity: { enum: ["simple", "complex"] },
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
const EXPLORE_CACHE_PROBE = {
  type: "object",
  required: ["found", "fingerprint"],
  properties: {
    found: { type: "boolean" }, // cache file exists and carries all three header fields
    fingerprint: { type: "string" }, // stdout of FINGERPRINT_CMD, verbatim (current state)
    cachedFingerprint: { type: "string" }, // the file's FINGERPRINT field, verbatim
    areas: { type: "array", items: { type: "string" } }, // the file's AREAS field, split on '|'
    declaredLines: { type: "number" }, // the file's LINES field
    actualLines: { type: "number" }, // integer printed by `wc -l` on the cache file
  },
};
const OPEN_QUESTION = {
  type: "object",
  required: ["id", "question", "options", "whyItMatters"],
  properties: {
    id: { type: "string" },
    question: { type: "string" },
    options: { type: "array", items: { type: "string" } }, // 2-4; free text arrives via "Other"
    whyItMatters: { type: "string" }, // what in the design it changes
  },
};
const DESIGN_RESULT = {
  type: "object",
  required: ["status", "keypoints", "openQuestions"],
  properties: {
    status: { enum: ["done", "blocked"] },
    detail: { type: "string" },
    keypoints: { type: "string" }, // the Keypoints section verbatim
    openQuestions: { type: "array", items: OPEN_QUESTION },
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
const WRITE_RESULT = {
  type: "object",
  required: ["status"],
  properties: { status: { enum: ["done", "blocked"] }, detail: { type: "string" } },
};
const SPEC_REVIEW = {
  type: "object",
  required: ["approved", "findings"],
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
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 1 — EXPLORE  (scout → 1..N read-only explorers)
// ═════════════════════════════════════════════════════════════════════════════
phase("Explore");

// ── Explore cache: probe (only a RESUME round can have a prior cache) ────────
const cacheProbePrompt = `You are a read-only cache probe. Do exactly these two
things, then return structured output. Do not explore the codebase, do not read
anything else, and never create, modify, or delete a file.
1. Run exactly this command and report its stdout verbatim (a single line) as
   \`fingerprint\`:
${FINGERPRINT_CMD}
2. If ${EXPLORE_CACHE_PATH} exists, its first four lines are a header: an HTML
   comment, then \`FINGERPRINT: <value>\`, \`AREAS: <name> | <name>\`,
   \`LINES: <integer>\`. If the file is missing or unreadable, or any of those
   three fields is absent, return \`found: false\` and nothing else. Otherwise
   return \`found: true\`, \`cachedFingerprint\` = the FINGERPRINT value
   verbatim, \`areas\` = the AREAS value split on \`|\` and trimmed,
   \`declaredLines\` = the LINES integer, and \`actualLines\` = the integer
   printed by \`wc -l < ${EXPLORE_CACHE_PATH}\`.`;

const probe = RESUME ? await agent(cacheProbePrompt, { label: "explore-cache:probe", phase: "Explore", schema: EXPLORE_CACHE_PROBE, model: MODELS.cacheProbe }) : null;
const currentFingerprint = probe && typeof probe.fingerprint === "string" ? probe.fingerprint : "";
// parsedAreas is RAW probe output — it feeds the cacheHit decision and nothing
// else. Never read it below the cachedAreas line.
const parsedAreas = probe && Array.isArray(probe.areas) ? probe.areas.filter((a) => typeof a === "string" && a.trim() !== "") : [];
const cacheHit =
  probe != null &&
  probe.found === true &&
  currentFingerprint !== "" &&
  probe.cachedFingerprint === currentFingerprint &&
  parsedAreas.length > 0 &&
  probe.declaredLines > CACHE_HEADER_LINES &&
  probe.declaredLines === probe.actualLines;
// Single gate for every downstream use of cached data: on ANY miss (probe null,
// fingerprint mismatch, mangled cache, unparseable areas) this is empty, so an
// invalidated cache can never influence the full-exploration fallback.
const cachedAreas = cacheHit ? parsedAreas : [];
const budget = cacheHit ? Math.max(0, MAX_TOTAL_EXPLORE_AREAS - cachedAreas.length) : MAX_PARALLEL_EXPLORES;
if (RESUME) {
  log(cacheHit ? "Explore cache: hit — " + cachedAreas.length + " cached area(s) at " + EXPLORE_CACHE_PATH : "Explore cache: miss — full exploration");
}

const resumeNote = RESUME
  ? `\nRESUME RUN: a prior draft exists at ${DRAFT_PATH}. Read it first and scope
exploration to the areas its open questions and gaps actually touch — do not
re-explore what the draft already covers with evidence.`
  : "";
const coverageNote = cacheHit ? "\nAlready covered by valid cached reports (never repeat these): " + cachedAreas.join(", ") + "." : "";

const scoutPrompt = `You are a read-only scout. Task to be designed:\n${TASK}\n${resumeNote}\n
Survey the repository just enough to answer:
1. complexity — 'simple' (single subsystem, tightly-scoped, one clearly correct
   approach) or 'complex' (spans multiple independent files/subsystems, more
   than one genuinely competing approach, or scope still unclear).
2. subsystems — the 1-${MAX_PARALLEL_EXPLORES} areas an explorer should each dig
   into (name + one-line focus: what to find there). For 'simple', return
   exactly one subsystem covering the whole task.
Do not design anything. Structured output only.`;

const scoutTopUpPrompt = `You are a read-only top-up scout. Task being designed:\n${TASK}\n${resumeNote}\n
Valid exploration reports from an earlier round of THIS session already exist at
${EXPLORE_CACHE_PATH}, and the codebase has not changed since they were written.
Already covered — never propose any of these again: ${cachedAreas.join(", ")}.
Read that cache file first, then read the latest user input below and answer the
ONE question that matters: does it open an area the cached reports genuinely do
not cover?
## Latest user input
${USER_INPUT}
Return in \`subsystems\` ONLY genuinely new areas (name + one-line focus: what
to find there), at most ${budget}. An EMPTY subsystems array is the expected and
most common answer — return it whenever the cached coverage already suffices.
\`complexity\` is required by the schema but unused on this path; answer it
however you like. Do not design anything. Structured output only.`;

const scout = await agent(cacheHit ? scoutTopUpPrompt : scoutPrompt, { label: "scout", phase: "Explore", schema: SCOUT_SCHEMA, model: MODELS.scout, agentType: "explore" });
if (!scout && !cacheHit) return { status: "error", stage: "Explore", error: "scout returned no result" };

const proposed = scout && Array.isArray(scout.subsystems) ? scout.subsystems.filter((s) => s && typeof s.name === "string" && s.name.trim() !== "") : [];
const covered = cachedAreas.map((a) => a.trim().toLowerCase()); // [] on every miss
const subsystems = proposed.filter((s) => !covered.includes(s.name.trim().toLowerCase())).slice(0, Math.min(budget, MAX_PARALLEL_EXPLORES));
if (!cacheHit && subsystems.length === 0) subsystems.push({ name: "whole task", focus: TASK });
log(cacheHit ? "Explore cache: top-up — " + subsystems.length + " new area(s)" : "Scout: " + scout.complexity + ", " + subsystems.length + " exploration target(s)");

const explorerPrompt = (s) =>
  `You are a read-only codebase explorer (never edit anything). Task being
designed:\n${TASK}\n${resumeNote}${coverageNote}\n
Your assigned area: ${s.name} — ${s.focus}
Report for the designer: relevant files (exact paths), existing patterns and
conventions to follow, the real flow end to end, key signatures/interfaces the
design must match, recent related commits, constraints and pitfalls you can
see in the code. Dense and exact — file paths and symbol names, not prose
generalities. Structured output only.`;

const exploreOpts = (s) => ({ label: "explore:" + s.name, phase: "Explore", schema: EXPLORE_SCHEMA, model: MODELS.explorer, agentType: "explore" });
const exploreOuts =
  subsystems.length === 0
    ? []
    : subsystems.length > 1
      ? await parallel(subsystems.map((s) => () => agent(explorerPrompt(s), exploreOpts(s))))
      : [await agent(explorerPrompt(subsystems[0]), exploreOpts(subsystems[0]))];

const exploredAreas = [];
const sections = [];
for (let i = 0; i < exploreOuts.length; i++) {
  const r = exploreOuts[i];
  if (r && r.report) {
    exploredAreas.push(subsystems[i].name);
    sections.push("## " + subsystems[i].name + "\n" + r.report);
  }
}
const exploration = sections.join("\n\n");
if (!cacheHit && !exploration) return { status: "error", stage: "Explore", error: "all explorers returned null" };

// Persist: create on a fresh run or a miss, append on a top-up. Nothing new to
// write when a hit produced no new areas. Never fails the run.
const cacheWriterPrompt = (mode, totalLines, areaLine, fingerprintValue) => `You are the exploration-cache writer. This is a mechanical file
operation — no analysis, no summarizing, no commentary.
Mode: ${mode}. Target file: ${EXPLORE_CACHE_PATH}

In \`create\` mode write that file with exactly this layout:
line 1: <!-- taskflow explore cache (session-only, never commit) -->
line 2: \`FINGERPRINT: \` followed by the verbatim stdout of this command, which you run yourself:
${FINGERPRINT_CMD}
line 3: \`AREAS: ${areaLine}\`
line 4: \`LINES: ${totalLines}\`
line 5: empty
line 6 onwards: the block between BEGIN-BODY and END-BODY below, VERBATIM —
byte for byte, every line, nothing reordered, reformatted, summarized, added or
removed. Exactly one trailing newline at the end of the file.

In \`append\` mode the file already exists and holds earlier rounds' reports —
do not retype or alter its existing body. Append one empty line, then the
BEGIN-BODY block verbatim, then update the header in place:
\`FINGERPRINT: ${fingerprintValue}\`, \`AREAS: ${areaLine}\`, \`LINES: ${totalLines}\`.

Finally verify with \`wc -l < ${EXPLORE_CACHE_PATH}\`: it must print exactly
${totalLines}. If it does not, fix the file and re-check (at most twice); if it
still does not, return status \`blocked\` with the actual number in \`detail\`.

BEGIN-BODY
${exploration}
END-BODY`;

if (exploration) {
  const mode = cacheHit ? "append" : "create";
  const totalLines = (cacheHit ? probe.actualLines + 1 : CACHE_HEADER_LINES) + lineCount(exploration);
  const areaLine = cachedAreas.concat(exploredAreas).join(" | "); // cachedAreas is [] on a miss
  const w = await agent(cacheWriterPrompt(mode, totalLines, areaLine, cacheHit ? currentFingerprint : ""), {
    label: "explore-cache:write",
    phase: "Explore",
    schema: WRITE_RESULT,
    model: MODELS.cacheWriter,
  });
  if (!w || w.status !== "done") log("Explore cache: write failed — the next resume round will explore fully");
}

const explorationBlock =
  (cacheHit
    ? "Cached exploration reports from an earlier round of THIS session are at " +
      EXPLORE_CACHE_PATH +
      " — read that file now and treat every `## <area>` section in it as exploration input (ignore its 4-line header). The codebase is unchanged since those reports were written.\n" +
      (exploration ? "Additionally explored in this round:\n" : "")
    : "") + exploration;

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 2 — DESIGN  (write draft → review gate → optional 1 revision round)
// ═════════════════════════════════════════════════════════════════════════════
phase("Design");

const designerPrompt = (mode, extra) => `${mode}
Task:
${TASK}

Draft file to write (create/overwrite): ${DRAFT_PATH}
Open-question cap: ${MAX_OPEN_QUESTIONS} (2-4 options each).
Draft requirements, question bar, and self-review checklist per your agent
definition.
## Exploration reports
${explorationBlock}

${extra}
Return structured output: status, the Keypoints section verbatim, and
openQuestions (empty array when decision-complete).`;

const initialExtra = RESUME
  ? `## Prior draft\nRead the existing draft at ${DRAFT_PATH} — it is your
starting point, not a suggestion. Revise it in place.\n
## User answers (BINDING — record each under Decisions & assumptions as
'USER DECISION', remove the answered questions, and never reverse these
decisions later):\n${USER_INPUT}\n`
  : "";

const initialMode = RESUME ? "This is a RESUME run: continue a prior draft using the user's answers." : "This is a fresh run: produce the first complete draft.";

async function runDesigner(mode, extra, label) {
  const opts = { label, phase: "Design", schema: DESIGN_RESULT, model: MODELS.designer, agentType: AGENTS.designer };
  let d = await agent(designerPrompt(mode, extra), opts);
  if (d === null) d = await agent(designerPrompt(mode, extra), { ...opts, label: label + ":retry" });
  return d;
}

const designReviewerPrompt = `Design task:
${TASK}

Draft to review: ${DRAFT_PATH}
Apply your full checklist (agent definition) against the codebase where
needed. Structured output only.`;

async function reviewDesign(label) {
  const opts = { label, phase: "Design", schema: DESIGN_REVIEW, model: MODELS.designReview, agentType: AGENTS.reviewer };
  let r = await agent(designReviewerPrompt, opts);
  if (r === null) r = await agent(designReviewerPrompt, { ...opts, label: label + ":retry" });
  return r;
}

let design = await runDesigner(initialMode, initialExtra, "design");
if (!design || design.status === "blocked") {
  return { status: "error", stage: "Design", error: design ? design.detail : "designer returned null twice" };
}
let review = await reviewDesign("design-review");
if (!review) return { status: "error", stage: "Design", error: "design reviewer returned null twice", draftPath: DRAFT_PATH };

// Exactly one revision round: fix blocking findings + decide 'resolvable'
// questions ourselves (using the reviewer's resolution as a hint).
const blocking = review.findings.filter((f) => f.severity === "blocking");
const resolvable = (review.questionVerdicts || []).filter((v) => v.verdict === "resolvable");
if (blocking.length || resolvable.length) {
  log("Design review: " + blocking.length + " blocking, " + resolvable.length + " resolvable question(s) — one revision round");
  const revisionExtra =
    `## Revision input (from the design review)
Blocking findings to fix:\n${JSON.stringify(blocking)}\n
Questions judged RESOLVABLE — decide them yourself now (the reviewer's
suggested resolution is a hint, verify it against the code), record each under
Decisions & assumptions, and remove them from Open questions:\n${JSON.stringify(resolvable)}\n
User decisions already recorded in the draft remain binding.\n` + (RESUME ? initialExtra : "");
  design = await runDesigner("This is a REVISION round on the existing draft at " + DRAFT_PATH + " — revise it in place.", revisionExtra, "design:revise");
  if (!design || design.status === "blocked") {
    return { status: "error", stage: "Design", error: "designer failed during revision", draftPath: DRAFT_PATH };
  }
  review = await reviewDesign("design-recheck");
  if (!review) return { status: "error", stage: "Design", error: "design reviewer failed on recheck", draftPath: DRAFT_PATH };
  if (review.findings.some((f) => f.severity === "blocking")) {
    return {
      status: "error",
      stage: "Design",
      draftPath: DRAFT_PATH,
      error: "design still blocking after one revision: " + JSON.stringify(review.findings.filter((f) => f.severity === "blocking")),
    };
  }
}

// ── Exit gate: remaining GENUINE questions ⇒ Exit 2 (draft stays at DRAFT_PATH) ─
const verdictOf = {};
for (const v of review.questionVerdicts || []) verdictOf[v.id] = v.verdict;
const genuineQuestions = (design.openQuestions || [])
  .filter((q) => (verdictOf[q.id] || "genuine") === "genuine") // unrated questions are conservatively treated as genuine
  .slice(0, MAX_OPEN_QUESTIONS);

if (genuineQuestions.length > 0) {
  log("Exit: user input required — " + genuineQuestions.length + " open question(s); draft persisted at " + DRAFT_PATH);
  return {
    status: "user_input_required",
    draftPath: DRAFT_PATH,
    keypoints: design.keypoints,
    questions: genuineQuestions, // each {id, question, options[2-4], whyItMatters} → AskUserQuestion in the orchestrator
    resume: {
      how: "Re-run this workflow with RESUME=true, the same DRAFT_PATH, and the answers inlined as USER_INPUT (recommended: JSON [{id, answer}]).",
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 3 — SPEC  (draft → spec → review gate → optional 1 fix round)
// ═════════════════════════════════════════════════════════════════════════════
phase("Spec");

const specWriterPrompt = (revision) => `You are the spec writer. The design
draft at ${DRAFT_PATH} is approved and decision-complete (its Open-questions
section is empty or fully resolved). Transform it into the final spec at
${SPEC_PATH} (create/overwrite).
The spec is the single input a downstream planner turns into an implementation
plan — dense, exact, complete, zero placeholders. Write it ENTIRELY in
English regardless of the draft's language (translate faithfully if needed)
— this file is read only by other agents, never shown to the user directly:
- Carry over EVERY decision, interface, constraint, and acceptance criterion
  from the draft — nothing dropped, nothing newly invented, no re-opened
  decisions ('USER DECISION' entries are immutable).
- Sections: Keypoints; Goal; Non-goals; Chosen approach (alternatives + why
  they lost, condensed); Detailed design (architecture, components, data flow,
  exact interfaces); Error handling; Testing strategy; Acceptance criteria
  (checkable, exact commands); Risks; '## Global Constraints' (verbatim from
  the draft — one line each, exact values); '## Decisions & assumptions'.
- NO Open-questions section — a spec with open questions is invalid.
${revision ? "\nThis is a FIX round. Address exactly these findings, then rewrite " + SPEC_PATH + " in place:\n" + revision + "\n" : ""}
Return structured output: status (+ detail when blocked).`;

const specReviewerPrompt = `You are a read-only spec reviewer. Compare the spec
at ${SPEC_PATH} against the approved draft at ${DRAFT_PATH}:
1. Completeness — every draft decision, interface, constraint, and acceptance
   criterion appears in the spec; name anything dropped or altered.
2. No inventions — the spec adds no decision the draft does not contain.
3. Placeholders — no TBD/TODO/vague requirements; no Open-questions section.
4. Ambiguity — every requirement has exactly one reading.
5. Acceptance criteria — checkable, with exact commands where the draft had them.
6. '## Global Constraints' present and matching the draft verbatim.
Severity 'blocking' for anything that would mislead the downstream planner.
Structured output only.`;

async function writeSpec(revision, label) {
  const opts = { label, phase: "Spec", schema: WRITE_RESULT, model: MODELS.specWriter };
  let w = await agent(specWriterPrompt(revision), opts);
  if (w === null) w = await agent(specWriterPrompt(revision), { ...opts, label: label + ":retry" });
  return w;
}

async function reviewSpec(label) {
  const opts = { label, phase: "Spec", schema: SPEC_REVIEW, model: MODELS.specReview };
  let r = await agent(specReviewerPrompt, opts);
  if (r === null) r = await agent(specReviewerPrompt, { ...opts, label: label + ":retry" });
  return r;
}

let spec = await writeSpec(null, "spec-write");
if (!spec || spec.status === "blocked") {
  return { status: "error", stage: "Spec", error: spec ? spec.detail : "spec writer returned null twice", draftPath: DRAFT_PATH };
}
let specCheck = await reviewSpec("spec-review");
if (specCheck && !specCheck.approved) {
  const specBlocking = specCheck.findings.filter((f) => f.severity === "blocking");
  if (specBlocking.length) {
    log("Spec review: " + specBlocking.length + " blocking finding(s) — one fix round");
    spec = await writeSpec(JSON.stringify(specBlocking), "spec-fix");
    if (!spec || spec.status === "blocked") {
      return { status: "error", stage: "Spec", error: "spec writer failed during fix round", draftPath: DRAFT_PATH };
    }
    specCheck = await reviewSpec("spec-recheck");
    if (specCheck && !specCheck.approved && specCheck.findings.some((f) => f.severity === "blocking")) {
      return {
        status: "error",
        stage: "Spec",
        draftPath: DRAFT_PATH,
        error: "spec still blocking after one fix round: " + JSON.stringify(specCheck.findings.filter((f) => f.severity === "blocking")),
      };
    }
  }
}

log("Exit: spec complete at " + SPEC_PATH);
return {
  status: "complete",
  specPath: SPEC_PATH,
  draftPath: DRAFT_PATH, // left in place: context for the delivery workflow's review
  keypoints: design.keypoints, // verbatim for approval (AskUserQuestion) by the orchestrator
  specReviewed: specCheck != null, // false means the reviewer failed twice — spec shipped unreviewed
  minorFindings: {
    design: (review.findings || []).filter((f) => f.severity === "minor"),
    spec: specCheck ? (specCheck.findings || []).filter((f) => f.severity === "minor") : [],
  },
};
