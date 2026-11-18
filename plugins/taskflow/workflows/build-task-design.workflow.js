// ─────────────────────────────────────────────────────────────────────────────
// build-task-design.workflow.js — build-task design pipeline, phase 2 of 3
//
//   Draft design → review gate → at most one revision round → recheck
//
// Reads the exploration file written by build-task-explore.workflow.js (EXPLORE_PATH);
// the designer writes the draft to DRAFT_PATH itself (persistent state between
// runs). Intent confirmation (human) stays OUTSIDE the workflow — workflow
// scripts have no AskUserQuestion. Exits:
//
//   'complete'            — draft decision-complete at DRAFT_PATH; keypoints
//                           and the design-review minor findings in the result.
//   'user_input_required' — questions remain that only the user can decide.
//                           The draft is fully persisted at DRAFT_PATH; the
//                           result carries the questions (AskUserQuestion-
//                           compatible: ≤4 questions, 2-4 options each). The
//                           orchestrator re-runs this script with RESUME=true,
//                           the same DRAFT_PATH and EXPLORE_PATH, and the
//                           answers in USER_INPUT. Restartable any number of
//                           times.
//   'error'               — { status, stage: 'args' | 'Design', error, draftPath? }
//
// Args: { TASK, EXPLORE_PATH, DRAFT_PATH, SIZE?, RESUME?, USER_INPUT? }
//   TASK         — design task / work description
//   EXPLORE_PATH — absolute path of the exploration file (read by the designer)
//   DRAFT_PATH   — absolute path of the draft file (persisted between runs)
//   SIZE         — optional; S | M | L | XL from build-task's size step; picks
//                  the designer model (DESIGN_MODEL), default opus.
//   RESUME       — false on the first run; true when restarting with answers
//   USER_INPUT   — '' on the first run; otherwise the answers to the open
//                  questions (recommended: JSON [{id, answer}]; BINDING)
//
// Invocation contract:
//   - PRIMARY: the plugin workflow `build-task-design` (by name, namespaced by the plugin, args)
//     with ONE JSON object as args — the script reads it as the global `args`.
//   - FALLBACK (decodeArgs reports "args global is undefined"): prepend
//     EXACTLY ONE line right after the meta block: `const args = { … }`
//     (JSON literal) and submit the text via `script` without the tool-level
//     `args` parameter.
//   - No clock reads, randomness or FS in the script.
//
// Models: designer sonnet | opus | fable (from SIZE, default opus; fable falls
// back to opus on a dispatch throw), design reviewer sonnet.
// ─────────────────────────────────────────────────────────────────────────────

export const meta = {
  name: "build-task-design",
  description: "Exploration file → design draft (reviewed); exits decision-complete or with open user questions (resumable)",
  phases: [
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
const A = decodeArgs(["TASK", "EXPLORE_PATH", "DRAFT_PATH"], { SIZE: "", RESUME: false, USER_INPUT: "" });
if (A.__error) return { status: "error", stage: "args", error: A.__error };
const { TASK, EXPLORE_PATH, DRAFT_PATH, SIZE, USER_INPUT: RAW_USER_INPUT } = A;
const RESUME = A.RESUME === true || A.RESUME === "true"; // string args: "false" is truthy
const USER_INPUT = typeof RAW_USER_INPUT === "string" ? RAW_USER_INPUT : RAW_USER_INPUT == null ? "" : JSON.stringify(RAW_USER_INPUT);
for (const [k, v] of [["EXPLORE_PATH", EXPLORE_PATH], ["DRAFT_PATH", DRAFT_PATH]]) {
  if (typeof v !== "string" || !v.startsWith("/")) return { status: "error", stage: "args", error: k + " must be an absolute path" };
}
if (RESUME && !USER_INPUT) return { status: "error", stage: "args", error: "RESUME=true requires USER_INPUT (the answers to the previously returned questions)" };

// Tool availability is detected once in build-task/SKILL.md and threaded in
// (.claude/rules/script-authoring.md §4); a hint is appended only when it was found.
const REPO = typeof A.REPO_PATH === "string" ? A.REPO_PATH.trim() : "";
const wantGraphmind = A.GRAPHMIND_AVAILABLE === true || A.GRAPHMIND_AVAILABLE === "true";
const USE_GRAPHMIND = wantGraphmind && REPO.startsWith("/");
if (wantGraphmind && !USE_GRAPHMIND) {
  return { status: "error", stage: "args", error: "GRAPHMIND_AVAILABLE=true requires a non-empty absolute REPO_PATH" };
}
const gmHint = (purpose, project) =>
  USE_GRAPHMIND
    ? `\n\nHint: graphmind indexes this repository. Optionally load its tools with ToolSearch(query: "select:mcp__graphmind__gm_search,mcp__graphmind__gm_outline,mcp__graphmind__gm_fn,mcp__graphmind__gm_deps") and use them ${purpose} rather than broad Grep/Read; pass project: ${project} on every call. Fall back to Read/Grep when a call errors or returns nothing.`
    : "";

const MODELS = { designReview: "sonnet" };
// Designer model is chosen per run from build-task's SIZE (S/M/L/XL).
const DESIGN_MODEL = { S: "sonnet", M: "opus", L: "opus", XL: "fable" };
const designerModel = (s) => DESIGN_MODEL[String(s).toUpperCase()] || "opus";
let DESIGNER_MODEL = designerModel(SIZE);

const MAX_OPEN_QUESTIONS = 4; // AskUserQuestion limit of the orchestrator

// ── Schemas ──────────────────────────────────────────────────────────────────
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
// DESIGN  (write draft → review gate → optional 1 revision round)
// ═════════════════════════════════════════════════════════════════════════════
phase("Design");
log("Size " + (SIZE || "unset") + " → designer: " + DESIGNER_MODEL);

const designerPrompt = (mode, extra) =>
  `${mode}
Task:
${TASK}

Draft file to write (create/overwrite): ${DRAFT_PATH}
Open-question cap: ${MAX_OPEN_QUESTIONS} (2-4 options each).${gmHint("to verify the files, symbols and signatures the exploration reports mention", JSON.stringify(REPO))}
Draft requirements, question bar, and self-review checklist per your role
definition.
## Exploration reports
Read the exploration file at ${EXPLORE_PATH} before designing (written by the Explore workflow for this task).

${extra}
Return structured output: status, the Keypoints section verbatim as the
\`keypoints\` STRING field, and \`openQuestions\` as its OWN top-level array
field (empty array when decision-complete) — never embedded as text/tags
inside \`keypoints\`.`;

const initialExtra = RESUME
  ? `## Prior draft\nRead the existing draft at ${DRAFT_PATH} — it is your
starting point, not a suggestion. Revise it in place.\n
## User answers (BINDING — record each under Decisions & assumptions as
'USER DECISION', remove the answered questions, and never reverse these
decisions later):\n${USER_INPUT}\n`
  : "";

const initialMode = RESUME ? "This is a RESUME run: continue a prior draft using the user's answers." : "This is a fresh run: produce the first complete draft.";

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

let design = await runDesigner(initialMode, initialExtra, "design");
if (!design || design.status === "blocked") {
  return { status: "error", stage: "Design", error: design ? design.detail : "designer returned null twice", draftPath: DRAFT_PATH };
}
let review = await reviewDesign("design-review");
if (!review) return { status: "error", stage: "Design", error: "design reviewer returned null twice", draftPath: DRAFT_PATH };

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

// ── Exit gate: remaining GENUINE questions ⇒ user_input_required (draft stays at DRAFT_PATH) ─
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
      how: "Re-run this workflow with RESUME=true, the same DRAFT_PATH and EXPLORE_PATH, and the answers as USER_INPUT (recommended: JSON [{id, answer}]).",
    },
  };
}

log("Exit: design complete at " + DRAFT_PATH);
return {
  status: "complete",
  draftPath: DRAFT_PATH,
  keypoints: design.keypoints, // verbatim for approval (AskUserQuestion) by the orchestrator
  minorFindings: (review.findings || []).filter((f) => f.severity === "minor"),
};
