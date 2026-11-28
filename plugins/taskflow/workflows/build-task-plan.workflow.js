// ─────────────────────────────────────────────────────────────────────────────
// build-task-plan.workflow.js — build-task delivery pipeline, phase 1 of 4
//
//   Approved spec → implementation plan (planner) → plan check → at most one
//   revision round → recheck
//
// The planner writes the plan to PLAN_PATH itself; that file (with its
// '## Global Constraints' section and '## Machine-readable tasks' JSON block)
// is this script's output and the input of build-task-implement.workflow.js.
// Run by the plan-task skill, which resumes it with USER_INPUT after a user
// decision. Exits:
//
//   'complete'            — { status, planPath, plannerModel }
//   'user_input_required' — { status, reason: 'conflict' | 'rounds_exhausted', findings, planPath, plannerModel }
//   'error'               — { status, stage: 'args' | 'Plan', error, planPath?, plannerModel? }
//
// Args: { SPEC_PATH, PLAN_PATH, SIZE?, GRAPHMIND_AVAILABLE?, REPO_PATH?, JEV_AVAILABLE?, USER_INPUT? }
//   SPEC_PATH — absolute path of the user-approved spec file
//   PLAN_PATH — absolute path the planner writes the plan to (session scratch)
//   SIZE      — optional; S | M | L | XL from the size step; picks the
//               planner model (PLAN_MODEL), default opus.
//   GRAPHMIND_AVAILABLE — optional; true ⇒ the planner prompt tells it to confirm
//               paths/signatures via the graphmind MCP tools. Requires a
//               non-empty absolute REPO_PATH.
//   REPO_PATH — optional; absolute checkout root, passed as graphmind's project.
//   JEV_AVAILABLE — optional; true ⇒ the planner gets the jev-api complexity hint.
//   USER_INPUT — optional, default ''; non-empty means resume: the JSON string
//               {"decisions": [{id, question, answer}], "findings": [...]} with every
//               decision so far, binding for planner and plan checker.
//
// Invocation contract:
//   - PRIMARY: the plugin workflow `build-task-plan` (by name, namespaced by the plugin, args)
//     with ONE JSON object as args — the script reads it as the global `args`.
//   - FALLBACK (decodeArgs reports "args global is undefined"): prepend
//     EXACTLY ONE line right after the meta block: `const args = { … }`
//     (JSON literal) and submit the text via `script` without the tool-level
//     `args` parameter.
//   - No clock reads, randomness or FS in the script.
//
// Models: planner sonnet | opus | fable (from SIZE, default opus; fable falls
// back to opus on a dispatch throw or a null result), plan checker sonnet.
// ─────────────────────────────────────────────────────────────────────────────

export const meta = {
  name: "build-task-plan",
  description: "Approved spec → implementation plan with machine-readable tasks (checked, at most one revision round)",
  phases: [
    { title: "Plan", detail: "Spec → implementation plan + machine-readable tasks, plan check gate" },
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
const A = decodeArgs(["SPEC_PATH", "PLAN_PATH"], { SIZE: "", GRAPHMIND_AVAILABLE: false, REPO_PATH: "", USER_INPUT: "" });
if (A.__error) return { status: "error", stage: "args", error: A.__error };
const { SPEC_PATH, PLAN_PATH, SIZE, GRAPHMIND_AVAILABLE, REPO_PATH } = A;
for (const [k, v] of [["SPEC_PATH", SPEC_PATH], ["PLAN_PATH", PLAN_PATH]]) {
  if (typeof v !== "string" || !v.startsWith("/")) return { status: "error", stage: "args", error: k + " must be an absolute path" };
}
// Availability is decided once in plan-task/SKILL.md and threaded in
// (.claude/rules/script-authoring.md §4); "true" string accepted for JSON-string args.
const REPO = typeof REPO_PATH === "string" ? REPO_PATH.trim() : "";
const wantGraphmind = GRAPHMIND_AVAILABLE === true || GRAPHMIND_AVAILABLE === "true";
const USE_GRAPHMIND = wantGraphmind && REPO.startsWith("/");
if (wantGraphmind && !USE_GRAPHMIND) {
  return { status: "error", stage: "args", error: "GRAPHMIND_AVAILABLE=true requires a non-empty absolute REPO_PATH" };
}

const USE_JEV = A.JEV_AVAILABLE === true || A.JEV_AVAILABLE === "true";
// A non-empty USER_INPUT is the resume signal; an object is accepted and re-serialized.
const USER_INPUT = typeof A.USER_INPUT === "string" ? A.USER_INPUT : A.USER_INPUT == null ? "" : JSON.stringify(A.USER_INPUT);
const MODELS = { planChecker: "sonnet" }; // coverage/consistency gate before Implement
// Planner model is chosen per run from the SIZE arg (S/M/L/XL).
const PLAN_MODEL = { S: "sonnet", M: "opus", L: "opus", XL: "fable" };
const plannerModel = (s) => PLAN_MODEL[String(s).toUpperCase()] || "opus";
let PLANNER_MODEL = plannerModel(SIZE);

// Prepended to every prompt below: these agents run headless inside a
// Workflow, so any prose between tool calls is wasted tokens no one reads.
const NO_NARRATION = "No narrative text between tool calls — call tools silently and speak only in your final message (the report or structured output). Write that final message in English, whatever the language of the task or its inputs; commit messages are not covered.";

// ── Schemas ──────────────────────────────────────────────────────────────────
const TASK_ITEM = {
  type: "object",
  required: ["id", "title", "files", "consumes", "produces", "complexity"],
  properties: {
    id: { type: "number" },
    title: { type: "string" },
    files: { type: "array", items: { type: "string" } },
    consumes: { type: "array", items: { type: "string" } },
    produces: { type: "array", items: { type: "string" } },
    complexity: { enum: ["trivial", "standard", "complex"], description: "trivial = single small mechanical edit; standard = default; complex = cross-cutting, tricky logic or subtle invariants. Selects the implementing model." },
  },
};
const PLAN_RESULT = {
  type: "object",
  required: ["status", "constraints", "tasks"],
  properties: {
    status: { enum: ["done", "blocked"] },
    detail: { type: "string" },
    constraints: { type: "string", description: "the plan's ## Global Constraints, verbatim" },
    tasks: { type: "array", items: TASK_ITEM },
  },
};
const CHECK_VERDICT = {
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
          severity: { enum: ["blocking", "minor", "conflict"] },
          description: { type: "string" },
          options: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// PLAN  (spec → plan file + machine-readable tasks)
// ═════════════════════════════════════════════════════════════════════════════
phase("Plan");
log("Size " + (SIZE || "unset") + " → planner: " + PLANNER_MODEL);

const plannerPrompt = (revision) =>
  `Spec to plan: ${SPEC_PATH}
Plan file to write (create/overwrite): ${PLAN_PATH}
Explore the codebase as needed to confirm exact current file paths, existing
signatures your Interfaces entries must match, and established patterns. Your
role definition carries the full plan requirements and self-review checklist.
${
    USE_GRAPHMIND
      ? `graphmind indexes this repository: load its tools with
ToolSearch(query: "select:mcp__graphmind__gm_search,mcp__graphmind__gm_outline,mcp__graphmind__gm_fn")
and prefer them for that confirmation — mcp__graphmind__gm_search to locate symbols
and files, mcp__graphmind__gm_outline for a file's structure with line numbers,
mcp__graphmind__gm_fn (file= to disambiguate) for an exact signature and its callers.
Pass project: "${REPO}" on every graphmind call. Use Read/Grep for string
literals, config values and unindexed files, and fall back to them when a graphmind
call errors or returns nothing.
`
      : ""
  }${
    revision
      ? `
This is a REVISION. Apply exactly these findings and binding user decisions, then rewrite ${PLAN_PATH} in place (a binding user decision overrides the spec and your role's rule not to re-open design decisions wherever they differ):
${revision}
`
      : ""
  }
${
    USE_JEV
      ? `\nHint: jev-api is available. To rate a task's complexity (trivial / standard / complex), load it with ToolSearch(query: "select:mcp__jev-api__request") and call mcp__jev-api__request with state = the task's title, files and interfaces and questions = [{"type": "score", "instructions": "How complex is the task?", "criteria": ["trivial: one small mechanical edit", "standard: a self-contained change", "complex: cross-cutting or judgment-heavy"]}]. The result is an array; take the rounded score of its first element only when confidence >= 0.6; otherwise judge it yourself.\n`
      : ""
  }Return structured output: status, the '## Global Constraints' section verbatim
as 'constraints', and the machine-readable tasks array as 'tasks'.`;

const planCheckerPrompt = `${NO_NARRATION}

You are a read-only plan checker. Read the approved
spec at ${SPEC_PATH} and the plan at ${PLAN_PATH}. Verify:
1. Coverage — every spec requirement maps to a task; name any gap.
2. Placeholders — hunt 'TBD', 'TODO', 'similar to Task N', steps that say what
   without showing how, names defined in no task.
3. Consistency — Consumes entries name exact Produces values of strictly
   earlier tasks; identifiers match across tasks.
4. Machine-readable block — present, valid JSON, one entry per prose task,
   unique numeric ids, files/consumes/produces matching prose exactly,
   complexity present on every task.
5. Conflicts — spec requirements that cannot all hold, so the plan would need
   mutually exclusive tasks or steps. Severity 'conflict'; 'description' names
   the clashing requirements; 'options' lists 2-3 mutually exclusive
   resolutions, one short sentence each.
Severity 'blocking' for anything that would mislead an implementer or corrupt
wave scheduling; 'minor' otherwise.
${USER_INPUT ? "\nBinding user decisions (JSON below) override the input document where they differ. Never flag an output point that follows them, and never re-raise a conflict they resolve: " + USER_INPUT + "\n" : ""}Structured output only.`;

// PLANNER_MODEL can be downgraded permanently for the rest of this run: an
// account/session without Fable access throws on dispatch rather than
// returning null, so an XL task must not be stuck retrying 'fable'.
async function callPlanner(prompt, label) {
  const opts = () => ({ label, phase: "Plan", schema: PLAN_RESULT, model: PLANNER_MODEL, agentType: "taskflow:planner" });
  try {
    return await agent(prompt, opts());
  } catch (e) {
    if (PLANNER_MODEL !== "fable") throw e;
    log("planner dispatch on fable failed (" + e.message + ") — falling back to opus for the rest of this run");
    PLANNER_MODEL = "opus";
    return await agent(prompt, { ...opts(), label: label + ":fable-fallback" });
  }
}

// Revision text: the findings, plus every binding decision on a resumed run.
const withDecisions = (findings) => JSON.stringify(findings) + (USER_INPUT ? "\nBinding user decisions: " + USER_INPUT : "");
const hasConflict = (check) => (check.findings || []).some((f) => f.severity === "conflict");
const conflictFindings = (check) => (check.findings || []).filter((f) => f.severity === "conflict" || f.severity === "blocking");
const blockingFindings = (check) => (check.findings || []).filter((f) => f.severity === "blocking");

async function makePlan() {
  let plan = await callPlanner(plannerPrompt(USER_INPUT || null), "plan");
  if (plan === null) {
    if (PLANNER_MODEL === "fable") {
      log("planner on fable returned null (usage limit?) — retrying on opus");
      PLANNER_MODEL = "opus";
    }
    plan = await callPlanner(plannerPrompt(USER_INPUT || null), "plan:retry");
  }
  if (plan === null || plan.status === "blocked") return { plan: null, reason: plan ? plan.detail : "planner returned null twice" };

  let check = await agent(planCheckerPrompt, { label: "plan-check", phase: "Plan", schema: CHECK_VERDICT, model: MODELS.planChecker });
  if (check === null) return { plan: null, reason: "plan-check returned null" };
  // Conflicts skip the revision round: only a user decision resolves them.
  if (hasConflict(check)) return { plan: null, ask: { reason: "conflict", findings: conflictFindings(check) } };
  if (!check.approved) {
    const blocking = blockingFindings(check);
    if (blocking.length) {
      log("Plan check: " + blocking.length + " blocking finding(s) — one revision round");
      plan = await callPlanner(plannerPrompt(withDecisions(blocking)), "plan:revise");
      if (plan === null || plan.status === "blocked") return { plan: null, reason: "planner failed during revision" };
      check = await agent(planCheckerPrompt, { label: "plan-recheck", phase: "Plan", schema: CHECK_VERDICT, model: MODELS.planChecker });
      if (check === null) return { plan: null, reason: "plan-recheck returned null" };
      if (hasConflict(check)) return { plan: null, ask: { reason: "conflict", findings: conflictFindings(check) } };
      const stillBlocking = blockingFindings(check);
      if (!check.approved && stillBlocking.length) return { plan: null, ask: { reason: "rounds_exhausted", findings: stillBlocking } };
    }
  }
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) return { plan: null, reason: "planner returned no tasks" };
  return { plan };
}

const planned = await makePlan();
if (planned.ask) {
  log("Plan needs a user decision: " + planned.ask.reason);
  return { status: "user_input_required", reason: planned.ask.reason, findings: planned.ask.findings, planPath: PLAN_PATH, plannerModel: PLANNER_MODEL };
}
if (!planned.plan) return { status: "error", stage: "Plan", error: planned.reason, planPath: PLAN_PATH, plannerModel: PLANNER_MODEL };
log("Plan approved: " + planned.plan.tasks.length + " task(s) — " + planned.plan.tasks.map((t) => t.id + ":" + (t.complexity || "standard")).join(", "));
return { status: "complete", planPath: PLAN_PATH, plannerModel: PLANNER_MODEL };
