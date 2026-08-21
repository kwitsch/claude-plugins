// ─────────────────────────────────────────────────────────────────────────────
// spec-driven-delivery.workflow.js
//
// A workflow script that maps the Plan → Implement → Review steps of the
// `feature-development` skill (kwitsch/claude-plugins, coding-toolbox) into
// ONE workflow. Input is an already APPROVED spec file — design and intent
// confirmation are therefore out of scope; the workflow owns the full
// implementation and review process up to applied review fixes.
//
// Deviations from the original skill (deliberate, per requirement):
//   1. Implementers ALWAYS run in their own worktree (isolation:'worktree'),
//      even for wave size 1 — never a direct commit on the work branch.
//   2. Every wave is merged into the work branch at the end by a SEPARATE
//      merge agent (git merge --no-ff, task-id order).
//   3. Model assignment by difficulty: the planner assigns each task a
//      complexity ∈ trivial|standard|complex → haiku|sonnet|claude-opus-4-8;
//      roles with a fixed difficulty profile use the value from MODELS below
//      (bare aliases, except the pinned Opus tier — see CLAUDE.md
//      "Model assignment").
//   4. Review fixes are applied within the workflow by an apply agent;
//      findings with reversesDecision are NEVER applied, only reported (no
//      AskUserQuestion is possible inside a workflow script).
//
// Invocation contract (from the orchestrator/skill):
//   - PRIMARY: invoke as a saved/plugin workflow by name and pass inputs via
//     the `args` parameter — the script reads them as the global `args`
//     (officially documented; structured data, no escaping needed). Plugin
//     workflows run namespaced: /<plugin>:spec-driven-delivery.
//   - FALLBACK (ad-hoc `script` submission): prepend the script text with
//     EXACTLY ONE line right after the meta block: `const args = { … }`
//     (JSON literal). NEVER rely on the `args` parameter of an ad-hoc
//     {script, args} call — the global arrives as `undefined` there (twice
//     observed silent total failure; the docs scope `args` to saved
//     workflows). decodeArgs() below fails loudly in that case.
//   - No Date.now()/Math.random()/Node API in the script; no filesystem —
//     everything file-related runs through agent() workers.
//   - Preconditions: work branch checked out, `git status --porcelain`
//     empty, spec file exists and is readable by subagents.
//   - Worktree isolation branches from the DEFAULT branch (worktree.baseRef),
//     not the work branch → every implementer hard-resets to BRANCH_NAME
//     first thing (see the implementer prompt).
// ─────────────────────────────────────────────────────────────────────────────

export const meta = {
  name: "spec-driven-delivery",
  description: "Approved spec → plan → wave-parallel implementation in worktrees → wave merge by a dedicated agent → combined review → fix application",
  phases: [
    { title: "Plan", detail: "Spec → implementation plan + machine-readable tasks" },
    { title: "Implement", detail: "Waves, one worktree per task, review/fix per task, merge per wave" },
    { title: "Review", detail: "Correctness angles + cleanup lenses over the combined diff" },
    { title: "Apply", detail: "Apply verified findings, commit by category" },
    { title: "Ship", detail: "Push, create/update PR/MR, watch CI + bounded fix rounds" },
  ],
};

// ── Inputs via the `args` global (decoder with fail-fast guard) ─────────────
// Expected: { SPEC_PATH, PLAN_PATH, BRANCH_NAME, BASE_BRANCH?, PLUGIN_ROOT? }
//   SPEC_PATH   — absolute path of the approved spec file
//   PLAN_PATH   — absolute temp path for the plan (session scratch, never in the repo)
//   BRANCH_NAME — current work branch (`git branch --show-current`)
//   BASE_BRANCH — branch the work branch was cut from (default 'main')
//   PLUGIN_ROOT — absolute plugin root (build-task injects $CLAUDE_PLUGIN_ROOT);
//                 used to build the ship-ensure-mergeable.sh path handed to
//                 shipper. Absent → shipper skips remediation, reports
//                 mergeState 'unknown' (today's pre-fix loop behavior).
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
const A = decodeArgs(["SPEC_PATH", "PLAN_PATH", "BRANCH_NAME"], { BASE_BRANCH: "main", SHIP: true, PLUGIN_ROOT: "" });
if (A.__error) return { stage: "args", error: A.__error };
const { SPEC_PATH, PLAN_PATH, BRANCH_NAME, BASE_BRANCH, SHIP, PLUGIN_ROOT } = A;

// ── Model assignment by task difficulty ──────────────────────────────────────
// Role profiles:
//   PINNED_OPUS — high synthesis/judgment load (planning, final
//                 prioritization); pinned — see CLAUDE.md "Model assignment"
//   sonnet — writing/checking code with context understanding (default)
//   haiku  — mechanical/deterministic (gathering scope, git merge sequence)
// Per-task scaling: complexity from the plan → implModel().
const PINNED_OPUS = "claude-opus-4-8"; // single source for every Opus-tier pin in this file
const MODELS = {
  planner: PINNED_OPUS, // spec → complete plan; highest leverage in the process (pinned)
  planChecker: "sonnet", // coverage/consistency gate before Implement
  taskReviewer: "sonnet", // per-task diff review
  merger: "haiku", // pure git command sequence, no judgment load
  scope: "haiku", // list diff, collect CLAUDE.md
  finder: "sonnet", // review finder (angles + lenses)
  verifier: "sonnet", // independent per-finding verification
  synthesizer: PINNED_OPUS, // ranking, dedupe, reversesDecision judgment (pinned)
  applier: "sonnet", // apply pre-verified fixes — test gate as safety net
  prAuthor: "sonnet", // faithful writing from structured inputs + repo template
  shipper: "haiku", // pure git/gh/glab procedure (merger analogue)
  ciMonitor: "haiku", // bounded poll + classification, read-only
  ciFixer: "sonnet", // diagnose + fix: judgment/coding, CI as the only safety net
};
// ── Plugin agent types (namespace = plugin name; keep in sync on plugin
//    rename). Verified: agentType = "<plugin>:<agents/-name>"; an unknown
//    type throws hard ("agent type 'X' not found. Available agents: …") —
//    i.e. this script assumes the installed taskflow plugin agents; the
//    static role prompts live there.
const AGENTS = {
  planner: "taskflow:planner",
  merger: "taskflow:worktree-merger",
  finder: "taskflow:review-finder",
  verifier: "taskflow:review-verifier",
  applier: "taskflow:fix-applier",
  prAuthor: "taskflow:pr-author",
  shipper: "taskflow:shipper",
  ciMonitor: "taskflow:ci-monitor",
  ciFixer: "taskflow:ci-fixer",
};

// Prepended to every inline prompt below that has no `agentType` (so no
// plugin agents/*.md system prompt already carries this rule) — same
// wording as the one baked into every agents/*.md file, so both classes of
// dispatch behave identically: these agents run headless inside a Workflow,
// so any prose between tool calls is wasted tokens no one reads.
const NO_NARRATION = "No narrative text between tool calls — call tools silently and speak only in your final message (the report or structured output).";

const IMPL_MODEL = { trivial: "haiku", standard: "sonnet", complex: PINNED_OPUS };
const implModel = (t) => IMPL_MODEL[t.complexity] || "sonnet";
const fixModel = (t) => (implModel(t) === "haiku" ? "sonnet" : implModel(t)); // fixing is never trivial; sonnet is enough for trivial tasks
// Per-task review gate follows task complexity: trivial → haiku, standard/complex → sonnet.
// Depth comes from the combined review phase, not this gate.
const reviewModel = (t) => (t.complexity === "trivial" ? "haiku" : t.complexity === "complex" ? MODELS.taskReviewer : "sonnet");

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
    complexity: { enum: ["trivial", "standard", "complex"] },
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
          severity: { enum: ["blocking", "minor"] },
          description: { type: "string" },
        },
      },
    },
  },
};
const IMPL_RESULT = {
  type: "object",
  required: ["status", "commitHash", "branch", "worktreePath", "testEvidence", "deviations"],
  properties: {
    status: { enum: ["done", "blocked"] },
    commitHash: { type: "string" },
    branch: { type: "string" }, // self-reported from its own worktree
    worktreePath: { type: "string" }, // ditto — never derived from tool side-channels
    testEvidence: { type: "string" },
    deviations: { type: "string" },
  },
};
const VERDICT = {
  type: "object",
  required: ["approved", "findings"],
  properties: {
    approved: { type: "boolean" },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "description", "file"],
        properties: {
          severity: { enum: ["critical", "important", "minor"] },
          description: { type: "string" },
          file: { type: "string" },
        },
      },
    },
  },
};
const MERGE_RESULT = {
  type: "object",
  required: ["results", "worktreeRoot"],
  properties: {
    worktreeRoot: { type: "string" }, // self-reported `git rev-parse --show-toplevel` — a wrong cwd surfaces loudly, not silently
    results: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "status"],
        properties: {
          id: {},
          status: { enum: ["merged", "conflict"] },
          detail: { type: "string" },
        },
      },
    },
  },
};
const SCOPE_SCHEMA = {
  type: "object",
  required: ["files", "summary"],
  properties: {
    files: { type: "array", items: { type: "string" } },
    claudeMdFiles: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    conventions: { type: "string" },
  },
};
const CANDIDATES_SCHEMA = {
  type: "object",
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        required: ["file", "summary", "failure_scenario"],
        properties: {
          file: { type: "string" },
          line: { type: "number" },
          summary: { type: "string" },
          failure_scenario: { type: "string" },
        },
      },
    },
  },
};
const GROUP_VERDICT_SCHEMA = {
  type: "object",
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        required: ["index", "verdict", "evidence"],
        properties: {
          index: { type: "number" },
          verdict: { enum: ["CONFIRMED", "PLAUSIBLE", "REFUTED"] },
          evidence: { type: "string" },
        },
      },
    },
  },
};
const REPORT_SCHEMA = {
  type: "object",
  required: ["summary", "decisions"],
  properties: {
    summary: { type: "string" },
    decisions: {
      type: "array",
      items: {
        type: "object",
        required: ["index"],
        properties: {
          index: { type: "number" },
          merge: { type: "array", items: { type: "number" } },
          reversesDecision: { type: "boolean" },
        },
      },
    },
  },
};
const APPLY_RESULT = {
  type: "object",
  required: ["applied", "skipped", "commits"],
  properties: {
    applied: { type: "array", items: { type: "number" } },
    skipped: {
      type: "array",
      items: {
        type: "object",
        required: ["index", "reason"],
        properties: { index: { type: "number" }, reason: { type: "string" } },
      },
    },
    commits: { type: "array", items: { type: "string" } },
  },
};

const PR_TEXT = {
  type: "object",
  required: ["title", "body"],
  properties: { title: { type: "string" }, body: { type: "string" } },
};
const SHIP_RESULT = {
  type: "object",
  required: ["status"],
  properties: {
    status: { enum: ["created", "updated", "blocked"] },
    url: { type: "string" },
    platform: { enum: ["github", "gitlab"] },
    mergeState: { enum: ["clean", "rebased", "resolved", "unknown"] },
    detail: { type: "string" },
  },
};
const CI_RESULT = {
  type: "object",
  required: ["status"],
  properties: {
    status: { enum: ["passed", "failed", "running", "none"] },
    failedJobs: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" }, reason: { type: "string" }, logExcerpt: { type: "string" }, rerunId: { type: "string" } },
      },
    },
    detail: { type: "string" },
  },
};
const CI_FIX_RESULT = {
  type: "object",
  required: ["status"],
  properties: {
    status: { enum: ["done", "rerun", "blocked"] },
    commitHash: { type: "string" },
    detail: { type: "string" },
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 1 — PLAN  (spec → plan file + machine-readable tasks)
// ═════════════════════════════════════════════════════════════════════════════
phase("Plan");

const plannerPrompt = (revision) => `Spec to plan: ${SPEC_PATH}
Plan file to write (create/overwrite): ${PLAN_PATH}
Explore the codebase as needed to confirm exact current file paths, existing
signatures your Interfaces entries must match, and established patterns. Your
agent definition carries the full plan requirements and self-review checklist.
${
  revision
    ? `
This is a REVISION. Fix exactly these findings from the plan check, then rewrite ${PLAN_PATH} in place:
${revision}
`
    : ""
}
Return structured output: status, the '## Global Constraints' section verbatim
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
Severity 'blocking' for anything that would mislead an implementer or corrupt
wave scheduling; 'minor' otherwise. Structured output only.`;

async function makePlan() {
  let plan = await agent(plannerPrompt(null), { label: "plan", phase: "Plan", schema: PLAN_RESULT, model: MODELS.planner, agentType: AGENTS.planner });
  if (plan === null) plan = await agent(plannerPrompt(null), { label: "plan:retry", phase: "Plan", schema: PLAN_RESULT, model: MODELS.planner, agentType: AGENTS.planner });
  if (plan === null || plan.status === "blocked") return { plan: null, reason: plan ? plan.detail : "planner returned null twice" };

  let check = await agent(planCheckerPrompt, { label: "plan-check", phase: "Plan", schema: CHECK_VERDICT, model: MODELS.planChecker });
  if (check && !check.approved) {
    const blocking = check.findings.filter((f) => f.severity === "blocking");
    if (blocking.length) {
      log("Plan check: " + blocking.length + " blocking finding(s) — one revision round");
      plan = await agent(plannerPrompt(JSON.stringify(blocking)), { label: "plan:revise", phase: "Plan", schema: PLAN_RESULT, model: MODELS.planner, agentType: AGENTS.planner });
      if (plan === null || plan.status === "blocked") return { plan: null, reason: "planner failed during revision" };
      check = await agent(planCheckerPrompt, { label: "plan-recheck", phase: "Plan", schema: CHECK_VERDICT, model: MODELS.planChecker });
      if (check && !check.approved && check.findings.some((f) => f.severity === "blocking")) {
        return { plan: null, reason: "plan still blocking after one revision: " + JSON.stringify(check.findings) };
      }
    }
  }
  return { plan };
}

const planned = await makePlan();
if (!planned.plan) return { stage: "Plan", error: planned.reason };
const tasks = planned.plan.tasks;
const constraints = planned.plan.constraints;
log("Plan approved: " + tasks.length + " task(s) — " + tasks.map((t) => t.id + ":" + (t.complexity || "standard")).join(", "));

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 2 — IMPLEMENT  (waves; always worktree; merge per wave by the merger)
// ═════════════════════════════════════════════════════════════════════════════
phase("Implement");

// Deterministic wave assignment — identical algorithm to the skill: file
// overlap ∪ consumes→produces ∪ conservative fallback for empty/unresolvable
// entries (serialize, never guess independence).
function normalizeFile(entry) {
  return entry.replace(/\s*\([^)]*\)\s*$/, "").trim();
}
function computeWaves(tasksIn) {
  const sorted = [...tasksIn].sort((a, b) => Number(a.id) - Number(b.id));
  const waveOf = {};
  const filesOf = {};
  const producesOf = {};
  const waves = [];
  for (const t of sorted) {
    filesOf[t.id] = new Set((t.files || []).map(normalizeFile));
    producesOf[t.id] = new Set(t.produces || []);
  }
  for (const t of sorted) {
    const consumes = new Set(t.consumes || []);
    let ambiguous = !t.files || !t.files.length || t.consumes == null || t.produces == null;
    const deps = new Set();
    for (const other of sorted) {
      if (Number(other.id) >= Number(t.id)) continue; // backward-only invariant
      let edge = false;
      for (const f of filesOf[other.id]) if (filesOf[t.id].has(f)) edge = true;
      for (const c of consumes) if (producesOf[other.id].has(c)) edge = true;
      if (edge) deps.add(other.id);
    }
    for (const c of consumes) {
      const matched = sorted.some((o) => Number(o.id) < Number(t.id) && producesOf[o.id].has(c));
      if (!matched) ambiguous = true;
    }
    if (ambiguous) for (const other of sorted) if (Number(other.id) < Number(t.id)) deps.add(other.id);
    let w = 1;
    for (const d of deps) w = Math.max(w, waveOf[d] + 1);
    waveOf[t.id] = w;
    waves[w - 1] = waves[w - 1] || [];
    waves[w - 1].push(t.id);
  }
  return waves;
}
const waves = computeWaves(tasks);
log("Wave plan: " + waves.map((w, i) => i + 1 + ":[" + w.join(",") + "]").join(" "));

const implementerPrompt = (t) => `${NO_NARRATION}

You are the implementer for exactly one plan
task, running in your own isolated git worktree.
FIRST, before anything else: run \`git reset --hard ${BRANCH_NAME}\`. Your
worktree was branched from the repo's default branch, not ${BRANCH_NAME} —
skipping this means working from a stale base missing every earlier wave's
merged work.
Plan file: ${PLAN_PATH} — Read it; execute ONLY task ${t.id} (${t.title}).
Global constraints (binding): ${constraints}
Work test-first: write the task's failing test, watch it fail, implement
minimally, watch it pass, run the task's verification commands. Commit the task
as ONE commit following the repo's commit conventions (no co-author trailers,
no generated-with footers). Touch nothing outside the task's scope.
Before returning, run \`git branch --show-current\`,
\`git rev-parse --show-toplevel\`, and \`git rev-parse HEAD\` and report their
exact output, plus test evidence (commands + output) and any deviation from
the plan. Return through the structured output schema.`;

const reviewerPrompt = (t, implReport) => `${NO_NARRATION}

You are a read-only reviewer for one
plan task. Plan file: ${PLAN_PATH} — Read it; review ONLY task ${t.id}
(${t.title}).
Implementer report: ${implReport}
The commit lives on the branch named in the report — read it with
\`git show <branch>\` / \`git log <branch>\` (refs are shared across worktrees;
no checkout needed). Check spec/plan compliance against the task text and these
global constraints, then correctness: ${constraints}
Do not re-run tests the implementer already ran — the report carries the
evidence. Return your verdict through the structured output schema.`;

const fixerPrompt = (t, findings, worktreePath, branch) => `${NO_NARRATION}

You are the fixer
for one reviewed plan task. You are on branch ${branch} at ${worktreePath} — an
isolated worktree; run your commands there, do not create a new one. A
standalone \`cd\` does NOT persist to your next Bash call — chain
\`cd "${worktreePath}" && ...\` into every single command, or every command
after the first silently runs in your default checkout.
Plan file: ${PLAN_PATH}, task ${t.id} (${t.title}).
Apply exactly these findings — nothing else — then commit (repo conventions,
no co-author trailers): ${JSON.stringify(findings)}
Return: STATUS: done|blocked, commit hash, what changed.`;

const mergerPrompt = (approved) => `Merge target branch: ${BRANCH_NAME}
Approved task branches — merge in exactly this order, one at a time:
${JSON.stringify(approved)}
(each entry is {id, branch, worktreePath}). Procedure, cleanup order, conflict
protocol, and toplevel self-report per your agent definition.
Return through the structured output schema — one entry per task attempted.`;

// Per-task loop: implement (isolated) → review → at most one fix → re-review.
async function runTask(t) {
  const model = implModel(t);
  const implOpts = { label: "task:" + t.id + ":" + model, phase: "Implement", isolation: "worktree", schema: IMPL_RESULT, model };
  let impl = await agent(implementerPrompt(t), implOpts);
  if (impl === null) impl = await agent(implementerPrompt(t), { ...implOpts, label: implOpts.label + ":retry" });
  if (impl === null) return { id: t.id, status: "failed", reason: "implementer returned null twice" };
  if (impl.status === "blocked") {
    return { id: t.id, status: "failed", reason: "implementer blocked: " + impl.deviations, branch: impl.branch, worktreePath: impl.worktreePath };
  }
  const implReport = JSON.stringify(impl);
  const revOpts = { label: "review:" + t.id, phase: "Implement", schema: VERDICT, model: reviewModel(t) };
  let review = await agent(reviewerPrompt(t, implReport), revOpts);
  if (review === null) review = await agent(reviewerPrompt(t, implReport), { ...revOpts, label: "review:" + t.id + ":retry" });
  if (review && !review.approved) {
    const blocking = review.findings.filter((f) => f.severity !== "minor");
    if (blocking.length) {
      const fix = await agent(fixerPrompt(t, blocking, impl.worktreePath, impl.branch), { label: "fix:" + t.id, phase: "Implement", model: fixModel(t) });
      const reReport =
        "Post-fix re-review. Branch: " +
        impl.branch +
        " — the fix commit is the LATEST commit on that branch (run `git log " +
        impl.branch +
        " -1`); diff that too, not only the original commit. " +
        "Original report: " +
        implReport +
        ". Fix report: " +
        fix;
      review = await agent(reviewerPrompt(t, reReport), { label: "re-review:" + t.id, phase: "Implement", schema: VERDICT, model: reviewModel(t) });
    }
  }
  const blockingLeft = !review || (!review.approved && review.findings.some((f) => f.severity !== "minor"));
  if (blockingLeft) return { id: t.id, status: "failed", review, branch: impl.branch, worktreePath: impl.worktreePath };
  return {
    id: t.id,
    status: "done",
    branch: impl.branch,
    worktreePath: impl.worktreePath,
    minor: (review.findings || []).filter((f) => f.severity === "minor"),
  };
}

const results = [];
const minorLedger = [];
let implementFailed = false;

for (let i = 0; i < waves.length; i++) {
  const waveIds = waves[i];
  const waveTasks = waveIds.map((id) => tasks.find((t) => Number(t.id) === Number(id)));
  log(
    "Wave " +
      (i + 1) +
      "/" +
      waves.length +
      ": dispatching " +
      waveTasks.length +
      " task(s) in isolated worktrees (ids " +
      waveIds.join(", ") +
      "; models " +
      waveTasks.map((t) => implModel(t)).join(", ") +
      ")",
  );

  // Always isolated; parallel() only when >1 (barrier, thunks — never started promises).
  const waveResults = waveTasks.length > 1 ? await parallel(waveTasks.map((t) => () => runTask(t))) : [await runTask(waveTasks[0])];
  results.push(...waveResults);

  // Merge-back: ALWAYS through the separate merge agent, even for wave size 1.
  const approved = waveResults.filter((r) => r && r.status === "done").map((r) => ({ id: r.id, branch: r.branch, worktreePath: r.worktreePath }));
  for (const r of waveResults) if (r && r.minor && r.minor.length) minorLedger.push({ id: r.id, minor: r.minor });

  if (approved.length) {
    const mOpts = { label: "merge:wave" + (i + 1), phase: "Implement", schema: MERGE_RESULT, model: MODELS.merger, agentType: AGENTS.merger };
    let merge = await agent(mergerPrompt(approved), mOpts);
    if (merge === null) merge = await agent(mergerPrompt(approved), { ...mOpts, label: mOpts.label + ":retry" });
    if (merge === null) {
      results.push({ id: "merge:wave" + (i + 1), status: "failed", reason: "merger returned null twice" });
      implementFailed = true;
    } else {
      log("Wave " + (i + 1) + " merge ran in: " + merge.worktreeRoot);
      const conflicts = (merge.results || []).filter((r) => r.status === "conflict");
      if (conflicts.length) {
        // Hard stop: a conflict means the wave analysis missed a real
        // dependency — never resolve it, never continue.
        results.push({ id: "merge:wave" + (i + 1), status: "failed", reason: JSON.stringify(conflicts) });
        implementFailed = true;
      }
    }
  }
  // Partial wave: approved siblings were already merged above; stop after that.
  if (implementFailed || waveResults.some((r) => !r || r.status === "failed")) {
    implementFailed = true;
    break;
  }
}

if (implementFailed) {
  return {
    stage: "Implement",
    error: "task failure or wave-merge conflict — pipeline stopped before Review; do not open a PR on a half-implemented plan",
    results,
    minorFindings: minorLedger,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 3 — REVIEW  (combined review over the accumulated branch diff)
// ═════════════════════════════════════════════════════════════════════════════
phase("Review");

// Derive review depth from plan reality: complex tasks or >4 tasks → max.
const LEVEL = tasks.some((t) => t.complexity === "complex") || tasks.length > 4 ? "max" : "high";
const DIFF_CMD = "git diff " + BASE_BRANCH + "...HEAD";
const P = LEVEL === "max" ? { correctnessAngles: 5, perAngle: 8, maxFindings: 15, sweep: true } : { correctnessAngles: 3, perAngle: 6, maxFindings: 10, sweep: false };
const SWEEP_MAX = 8;

// ── Lens catalog, verdict ladder & sweep focus live in the plugin agents
//    'review-finder' and 'review-verifier'; only the labels stay here. ──
const CORRECTNESS_LABELS = ["angle-A", "angle-B", "angle-C", "angle-D", "angle-E"];
const CLEANUP_LABELS = ["cleanup:reuse", "cleanup:simplification", "cleanup:efficiency", "cleanup:altitude", "cleanup:conventions"];

// ── Scope ──
const scope = await agent(
  NO_NARRATION +
    "\n\n" +
    "Establish the scope of a code review of the current branch's accumulated diff.\n\n" +
    "Run this exact diff command: " +
    DIFF_CMD +
    "\n\n" +
    "0. First confirm `git status --porcelain` is empty — stray working-tree state\n" +
    "   means Implement did not finish cleanly; report it instead of reviewing.\n" +
    "1. Confirm the diff command produces a non-empty diff.\n" +
    "2. List the changed files (repo-relative).\n" +
    "3. Summarize what changed in one paragraph.\n" +
    "4. List the CLAUDE.md files that apply to the changed files (user-level,\n" +
    "   repo-root, plus any CLAUDE.md/CLAUDE.local.md in an ancestor directory of\n" +
    "   a changed file). Read each one that exists and note conventions a reviewer\n" +
    "   should know.\n\nStructured output only.",
  { label: "scope", phase: "Review", schema: SCOPE_SCHEMA, model: MODELS.scope },
);
if (!scope) return { stage: "Review", error: "scope agent returned no result", results, minorFindings: minorLedger };
if (!scope.files || scope.files.length === 0) {
  return { stage: "Review", error: "no changes found to review — unexpected after a merged implement phase", results, minorFindings: minorLedger };
}
log(LEVEL + " review: " + scope.files.length + " changed files");

const claudeMdFiles = scope.claudeMdFiles || [];
const SCOPE_BLOCK =
  "## Review scope\n" +
  "Diff command: " +
  DIFF_CMD +
  "\n" +
  "Changed files (" +
  scope.files.length +
  "):\n" +
  scope.files.map((f) => "  - " + f).join("\n") +
  "\n" +
  "Applicable CLAUDE.md files (" +
  claudeMdFiles.length +
  "):\n" +
  (claudeMdFiles.length > 0 ? claudeMdFiles.map((f) => "  - " + f).join("\n") : "  (none)") +
  "\n\n" +
  "## What changed\n" +
  scope.summary +
  "\n\n" +
  "## Conventions\n" +
  (scope.conventions || "(none noted)") +
  "\n";

const FINDER_PROMPT = (f) =>
  "## Review finder — assigned lens: " +
  f.label +
  "\n\n" +
  SCOPE_BLOCK +
  "\n" +
  "Run the diff command above and review ONLY through your assigned lens; the\n" +
  "full lens catalog, candidate rules, and cleanup precedence are in your\n" +
  "agent definition. Candidate cap for this run: " +
  f.cap +
  ".\n\n" +
  "Structured output only.";

const canonFile = (raw) => {
  if (!raw) return "";
  const p = raw.replace(/\\/g, "/");
  let best = "";
  for (const sf of scope.files) {
    if ((p === sf || p.endsWith("/" + sf)) && sf.length > best.length) best = sf;
  }
  return best;
};
const ingest = (cs, cap, kind) =>
  cs
    .slice(0, cap)
    .map((c) => ({ ...c, file: canonFile(c.file), kind }))
    .filter((c) => c.file);
const loc = (c) => c.file + (c.line != null ? ":" + c.line : "");
const inBounds = (i, n) => Number.isInteger(i) && i >= 0 && i < n;

const GROUP_VERIFIER_PROMPT = (group) =>
  "## Review verifier\n\n" +
  SCOPE_BLOCK +
  "\n" +
  "## Candidate findings at " +
  loc(group[0]) +
  "\n" +
  group.map((c, i) => "[" + i + "] Summary: " + c.summary + "\n    Failure scenario: " + c.failure_scenario).join("\n") +
  "\n\n" +
  "Run the diff command above, read the relevant file(s), and return one\n" +
  "verdict per candidate by its [i] index — verdict ladder and recall rules\n" +
  "per your agent definition. Structured output only.";

let verifierAgents = 0;
async function verifyGroups(candidates) {
  const byLoc = Object.create(null);
  for (const c of candidates) (byLoc[loc(c)] ||= []).push(c);
  const groups = Object.values(byLoc);
  verifierAgents += groups.length;
  const out = await parallel(
    groups.map((g) => async () => {
      const short = g[0].file.split("/").pop();
      const r = await agent(GROUP_VERIFIER_PROMPT(g), {
        label: "verify:" + short + "(" + g.length + ")",
        phase: "Review",
        schema: GROUP_VERDICT_SCHEMA,
        model: MODELS.verifier,
        agentType: AGENTS.verifier,
      });
      if (!r) return [];
      const byIdx = {};
      for (const v of r.verdicts || []) if (inBounds(v.index, g.length)) byIdx[v.index] = v;
      return g.flatMap((c, i) => (byIdx[i] ? [{ ...c, verdict: byIdx[i].verdict, evidence: byIdx[i].evidence }] : []));
    }),
  );
  return out.filter(Boolean).flat();
}

const FINDERS = CORRECTNESS_LABELS.slice(0, P.correctnessAngles)
  .map((label) => ({ label, kind: "correctness", cap: P.perAngle }))
  .concat(CLEANUP_LABELS.map((label) => ({ label, kind: "cleanup", cap: P.perAngle })));

const finderOuts = await parallel(
  FINDERS.map(
    (f) => () =>
      agent(FINDER_PROMPT(f), { label: f.label, phase: "Review", schema: CANDIDATES_SCHEMA, model: MODELS.finder, agentType: AGENTS.finder }).then((r) => {
        if (!r || !Array.isArray(r.candidates)) return [];
        log(f.label + ": " + r.candidates.length + " candidates");
        return ingest(r.candidates, f.cap, f.kind);
      }),
  ),
);
const allCandidates = finderOuts.filter(Boolean).flat();
let candidatesSeen = allCandidates.length;
let verified = await verifyGroups(allCandidates);

if (P.sweep) {
  const knownBlock = verified.length > 0 ? verified.map((c) => "- " + loc(c) + " — " + c.summary).join("\n") : "(none)";
  const sweep = await agent(
    "## Review finder — assigned lens: sweep\n\n" +
      SCOPE_BLOCK +
      "\n" +
      "## Already-found candidates (do NOT re-derive or re-confirm these)\n" +
      knownBlock +
      "\n\n" +
      "Gap focus and rules per your agent definition. Candidate cap for this\n" +
      "run: " +
      SWEEP_MAX +
      ". If nothing new, return an empty list — do not pad.\n\n" +
      "Structured output only.",
    { label: "sweep", phase: "Review", schema: CANDIDATES_SCHEMA, model: MODELS.finder, agentType: AGENTS.finder },
  );
  if (sweep && Array.isArray(sweep.candidates) && sweep.candidates.length > 0) {
    const sliced = ingest(sweep.candidates, SWEEP_MAX, "correctness");
    candidatesSeen += sliced.length;
    log("sweep: " + sliced.length + " candidates");
    verified = verified.concat(await verifyGroups(sliced));
  }
}

const surviving = verified.filter((c) => c.verdict !== "REFUTED");
const refuted = verified.filter((c) => c.verdict === "REFUTED");
log("Verify done: " + verified.length + " verified → " + surviving.length + " kept, " + refuted.length + " refuted");
const reviewStats = { level: LEVEL, finders: FINDERS.length, candidates: candidatesSeen, verifierAgents, verified: verified.length, refuted: refuted.length };

let findings = [];
let reviewSummary = "No findings survived verification.";
if (surviving.length > 0) {
  const rank = (c) => (c.kind === "cleanup" ? 2 : 0) + (c.verdict === "PLAUSIBLE" ? 1 : 0);
  const ranked = surviving.slice().sort((a, b) => rank(a) - rank(b));
  const block = ranked
    .map(
      (c, i) =>
        "### [" +
        i +
        "] " +
        loc(c) +
        " (" +
        c.verdict +
        (c.kind === "cleanup" ? ", cleanup" : "") +
        ")\n" +
        c.summary +
        "\nFailure scenario: " +
        c.failure_scenario +
        "\nVerifier evidence: " +
        c.evidence +
        "\n",
    )
    .join("\n");

  const report = await agent(
    NO_NARRATION +
      "\n\n" +
      "## Synthesis: final review report\n\n" +
      ranked.length +
      " findings survived independent verification (" +
      LEVEL +
      "-effort review). " +
      "They are numbered [0]-[" +
      (ranked.length - 1) +
      "] below.\n\n" +
      block +
      "\n" +
      "## Design/plan context\nRead these files before deciding: " +
      SPEC_PATH +
      ", " +
      PLAN_PATH +
      "\n" +
      "For each decision, set reversesDecision: true when applying the finding's fix would " +
      "reverse a decision those documents record (an approach, interface, or scope choice) " +
      "rather than merely polishing its execution. The spec is USER-APPROVED — anything " +
      "reversing it must never be auto-applied. Default false.\n\n" +
      "## Instructions\n" +
      "Return decisions about findings BY INDEX — never re-emit finding text.\n" +
      "1. One decision per distinct defect; fold same-root-cause findings into its merge array.\n" +
      "2. Order decisions most-severe first. Correctness bugs always outrank cleanup findings.\n" +
      "3. Keep at most " +
      P.maxFindings +
      " decisions; omit the least severe beyond the cap.\n" +
      "4. Set reversesDecision per the design/plan context above.\n" +
      "5. Write a 2-3 sentence summary of the review.\n\nStructured output only.",
    { label: "synthesize", phase: "Review", schema: REPORT_SCHEMA, model: MODELS.synthesizer },
  );

  // Assembler invariants same as the skill: no silent drop while there is
  // still room; backfills carry no synthesizer judgment → reversesDecision:
  // false, but the apply agent re-checks spec reversal for EVERY finding
  // (below).
  const decisions = report && Array.isArray(report.decisions) ? report.decisions : [];
  const seen = new Set();
  const claim = (i) => (inBounds(i, ranked.length) && !seen.has(i) ? (seen.add(i), true) : false);
  for (const d of decisions) {
    if (findings.length >= P.maxFindings) break;
    if (!claim(d.index)) continue;
    const c = ranked[d.index];
    const merged = (Array.isArray(d.merge) ? d.merge : []).filter(claim).map((i) => ranked[i]);
    const verdict = merged.some((m) => m.verdict === "CONFIRMED") ? "CONFIRMED" : c.verdict;
    const also = merged.length > 0 ? " [same root cause also at: " + merged.map(loc).join(", ") + "]" : "";
    findings.push({ file: c.file, line: c.line, summary: c.summary + also, failure_scenario: c.failure_scenario, category: c.kind, verdict, reversesDecision: d.reversesDecision === true });
  }
  const usedDecisions = findings.length > 0;
  let backfilled = 0;
  for (let i = 0; i < ranked.length && findings.length < P.maxFindings; i++) {
    if (seen.has(i)) continue;
    const c = ranked[i];
    findings.push({ file: c.file, line: c.line, summary: c.summary, failure_scenario: c.failure_scenario, category: c.kind, verdict: c.verdict, reversesDecision: false });
    backfilled++;
  }
  reviewSummary =
    usedDecisions && report
      ? report.summary + (backfilled > 0 ? " (" + backfilled + " additional verified finding" + (backfilled === 1 ? "" : "s") + " appended unmerged.)" : "")
      : "Synthesis skipped or unusable — verified findings returned ranked, unmerged.";
}

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 4 — APPLY  (apply fixes; NEVER apply reversesDecision)
// ═════════════════════════════════════════════════════════════════════════════
phase("Apply");

const escalated = findings.filter((f) => f.reversesDecision);
const applicable = findings.filter((f) => !f.reversesDecision);
let applyReport = { applied: [], skipped: [], commits: [] };

if (applicable.length > 0) {
  const numbered = applicable.map((f, i) => ({ index: i, ...f }));
  const applier = await agent(
    "Fix-application run.\n" +
      "Work branch: " +
      BRANCH_NAME +
      "\n" +
      "Approved spec (skip-rule reference): " +
      SPEC_PATH +
      "\n" +
      "Findings to apply, numbered, most-severe first:\n" +
      JSON.stringify(numbered) +
      "\n" +
      "Locate-by-content, skip rule, commit-by-category, and test gate per your\n" +
      "agent definition. Return through the structured output schema: applied\n" +
      "indexes, skipped {index, reason}, and the commit hash(es).",
    { label: "apply-fixes", phase: "Apply", schema: APPLY_RESULT, model: MODELS.applier, agentType: AGENTS.applier },
  );
  if (applier) applyReport = applier;
  else applyReport = { applied: [], skipped: numbered.map((f) => ({ index: f.index, reason: "applier returned null" })), commits: [] };
}

log("Apply: " + applyReport.applied.length + " applied, " + applyReport.skipped.length + " skipped, " + escalated.length + " escalated (spec-reversing, not applied)");

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 5 — SHIP  (push, PR/MR, CI watch; problems here are reportable
// states, NOT a pipeline abort — the work is committed either way)
// ═════════════════════════════════════════════════════════════════════════════
phase("Ship");

const MAX_CI_MONITOR_ROUNDS = 6; // the monitor waits internally, ~5 min bounded per round
const MAX_CI_FIX_ROUNDS = 2;
let ship = { status: "skipped" };

if (SHIP) {
  const pipelineSummary = {
    spec: SPEC_PATH,
    plan: PLAN_PATH,
    branch: BRANCH_NAME,
    base: BASE_BRANCH,
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, complexity: t.complexity })),
    waves,
    review: { level: LEVEL, summary: reviewSummary, applied: applyReport.applied.length, skipped: applyReport.skipped.length, escalated: escalated.length },
    escalatedOpenItems: escalated.map((f) => f.summary),
    fixCommits: applyReport.commits,
    minorFindings: minorLedger.length,
  };
  const prOpts = { label: "pr-author", phase: "Ship", schema: PR_TEXT, model: MODELS.prAuthor, agentType: AGENTS.prAuthor };
  let prText = await agent(
    "Write the PR/MR title and body for branch " +
      BRANCH_NAME +
      " → " +
      BASE_BRANCH +
      ".\n" +
      "Pipeline summary (faithful source of truth):\n" +
      JSON.stringify(pipelineSummary) +
      "\n" +
      "Spec (context): " +
      SPEC_PATH +
      " — Plan (context): " +
      PLAN_PATH +
      "\n" +
      "Template discovery, structure, title/language conventions per your agent\n" +
      "definition. Structured output only.",
    prOpts,
  );
  if (prText === null)
    prText = await agent(
      "Retry. Write the PR/MR title and body for branch " + BRANCH_NAME + " → " + BASE_BRANCH + " from this summary per your agent definition:\n" + JSON.stringify(pipelineSummary),
      { ...prOpts, label: "pr-author:retry" },
    );

  if (!prText) {
    ship = { status: "blocked", detail: "pr-author returned null twice" };
  } else {
    const created = await agent(
      "Ship branch " +
        BRANCH_NAME +
        " to base " +
        BASE_BRANCH +
        " (procedure, platform\n" +
        "detection, create-or-update, mergeability check, and hard limits per your agent definition).\n" +
        "PR/MR title: " +
        prText.title +
        "\n" +
        "PR/MR body:\n<<<BODY\n" +
        prText.body +
        "\nBODY\n" +
        "Mergeability script (absolute path): " +
        (PLUGIN_ROOT ? PLUGIN_ROOT + "/bin/ship-ensure-mergeable.sh" : "(none — skip the mergeability step and report mergeState 'unknown')") +
        "\n" +
        "Structured output only.",
      { label: "ship", phase: "Ship", schema: SHIP_RESULT, model: MODELS.shipper, agentType: AGENTS.shipper },
    );
    if (!created || created.status === "blocked") {
      ship = { status: "blocked", detail: created ? created.detail : "shipper returned null" };
    } else {
      ship = { status: "shipped", url: created.url, platform: created.platform, prAction: created.status, mergeState: created.mergeState, ci: { status: "unknown", monitorRounds: 0, fixRounds: 0 } };
      let rerunTried = false;
      for (let round = 1; round <= MAX_CI_MONITOR_ROUNDS; round++) {
        ship.ci.monitorRounds = round;
        const ci = await agent(
          "Watch CI for branch " +
            BRANCH_NAME +
            " (platform: " +
            created.platform +
            ", PR/MR: " +
            created.url +
            ").\n" +
            "Bounded wait, classification, and failing-log collection per your agent\n" +
            "definition. Structured output only.",
          { label: "ci-monitor:" + round, phase: "Ship", schema: CI_RESULT, model: MODELS.ciMonitor, agentType: AGENTS.ciMonitor },
        );
        if (!ci) break;
        ship.ci.status = ci.status;
        if (ci.failedJobs && ci.failedJobs.length) ship.ci.failedJobs = ci.failedJobs;
        if (ci.status === "passed" || ci.status === "none") {
          delete ship.ci.failedJobs;
          break;
        }
        if (ci.status === "running") continue;
        // failed:
        if (ship.ci.fixRounds >= MAX_CI_FIX_ROUNDS) break;
        ship.ci.fixRounds++;
        const fix = await agent(
          "CI is red for branch " +
            BRANCH_NAME +
            " (platform: " +
            created.platform +
            ", PR/MR: " +
            created.url +
            ").\n" +
            (rerunTried ? "A rerun was ALREADY tried for this failure — treat flaky-looking failures as code-caused now.\n" : "") +
            "Failing jobs with log excerpts:\n" +
            JSON.stringify(ci.failedJobs || []) +
            "\n" +
            "Classification, fix scope, and hard limits per your agent definition.\n" +
            "Structured output only.",
          { label: "ci-fix:" + ship.ci.fixRounds, phase: "Ship", schema: CI_FIX_RESULT, model: MODELS.ciFixer, agentType: AGENTS.ciFixer },
        );
        if (!fix || fix.status === "blocked") {
          ship.ci.fixDetail = fix ? fix.detail : "ci-fixer returned null";
          break;
        }
        if (fix.status === "rerun") rerunTried = true;
        // 'done' (commit pushed) or 'rerun' → keep watching
      }
      if (ship.ci.status === "failed") ship.status = "ci_failed";
      else if (ship.ci.status === "running") ship.status = "ci_timeout";
      else if (ship.ci.status === "unknown") ship.status = "ci_unknown";
      log("Ship: " + ship.status + " (" + (ship.url || "-") + ", CI " + ship.ci.status + " after " + ship.ci.monitorRounds + " monitor / " + ship.ci.fixRounds + " fix round(s))");
    }
  }
}

// ── Final report to the orchestrator ─────────────────────────────────────────
return {
  stage: "done",
  plan: { path: PLAN_PATH, tasks: tasks.map((t) => ({ id: t.id, title: t.title, complexity: t.complexity, model: implModel(t) })) },
  waves,
  taskResults: results,
  implementMinorFindings: minorLedger, // passed through unchanged to the PR step
  review: { ...reviewStats, summary: reviewSummary, findings },
  refuted: refuted.map((c) => ({ file: c.file, line: c.line, summary: c.summary })),
  applied: applyReport,
  escalatedToUser: escalated, // reversesDecision → the human decides after the workflow ends
  ship, // {status: skipped|blocked|shipped|ci_failed|ci_timeout|ci_unknown, url?, platform?, mergeState?, ci?}
};
