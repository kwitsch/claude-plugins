// ─────────────────────────────────────────────────────────────────────────────
// build-task-implement.workflow.js — build-task delivery pipeline, phase 2 of 4
//
//   Load plan tasks → waves → per task: implement, review, at most one fix →
//   per-wave merge (multi-task waves only) → persist the result file
//
// Reads the plan written by build-task-plan.workflow.js (PLAN_PATH) through one loader
// agent and writes the result to IMPLEMENT_PATH (read later by the pr-author
// of build-task-ship.workflow.js). Wave rules:
//   - A wave with more than one task: every implementer runs in its own
//     worktree (isolation:'worktree') and a SEPARATE merge agent merges the
//     wave into the work branch (git merge --no-ff, task-id order).
//   - A wave with exactly one task: the implementer commits directly on the
//     work branch; no merge step.
//   - A failed task or a wave-merge conflict is a hard stop.
// Worktree isolation branches from the DEFAULT branch (worktree.baseRef), not
// the work branch → every isolated implementer hard-resets to BRANCH_NAME first
// thing (see the implementer prompt).
//
// Exits (every return after the args check carries tasks, waves, minorFindings):
//   'complete' — { status, implementPath, tasks, waves, minorFindings }
//   'error'    — { status, stage: 'args', error }
//              | { status, stage: 'Implement', error, tasks, waves, results, minorFindings }
//
// Args: { PLAN_PATH, IMPLEMENT_PATH, BRANCH_NAME, SCRATCH_DIR }
//   PLAN_PATH      — absolute path of the plan file (read by loader/implementers)
//   IMPLEMENT_PATH — absolute path of the JSON result file this script writes
//   BRANCH_NAME    — current work branch (`git branch --show-current`)
//   SCRATCH_DIR    — absolute session-scratch directory, trailing slash
//                    included; implementers write test-evidence-task-<id>.txt
//                    there for the per-task reviewer to read back.
//
// Invocation contract:
//   - PRIMARY: the plugin workflow `build-task-implement` (by name, namespaced by the plugin, args)
//     with ONE JSON object as args — the script reads it as the global `args`.
//   - FALLBACK (decodeArgs reports "args global is undefined"): prepend
//     EXACTLY ONE line right after the meta block: `const args = { … }`
//     (JSON literal) and submit the text via `script` without the tool-level
//     `args` parameter.
//   - No clock reads, randomness or FS in the script.
//
// Models: implementer/fixer haiku (opus for complex tasks), per-task reviewer
// haiku (sonnet for complex tasks), loader, merger and scribe haiku.
// ─────────────────────────────────────────────────────────────────────────────

export const meta = {
  name: "build-task-implement",
  description: "Plan file → wave-parallel implementation (worktrees + per-wave merge for multi-task waves, direct commits for single-task waves) → result file",
  phases: [
    { title: "Implement", detail: "Waves; multi-task waves use one worktree per task and a per-wave merge, single-task waves commit directly; review/fix per task" },
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
const A = decodeArgs(["PLAN_PATH", "IMPLEMENT_PATH", "BRANCH_NAME", "SCRATCH_DIR"], {});
if (A.__error) return { status: "error", stage: "args", error: A.__error };
const { PLAN_PATH, IMPLEMENT_PATH, BRANCH_NAME, SCRATCH_DIR } = A;
for (const [k, v] of [["PLAN_PATH", PLAN_PATH], ["IMPLEMENT_PATH", IMPLEMENT_PATH], ["SCRATCH_DIR", SCRATCH_DIR]]) {
  if (typeof v !== "string" || !v.startsWith("/")) return { status: "error", stage: "args", error: k + " must be an absolute path" };
}

// Fixed roles; the per-task implementer/reviewer scale with the task's complexity.
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

const MODELS = {
  loader: "haiku", // copies the task block out of the plan file through a schema
  merger: "haiku", // pure git command sequence, no judgment load
  scribe: "haiku", // writes the result file byte for byte
};
// Per-task diff review: sonnet only for complex tasks; depth comes from the combined Review phase.
const TASK_REVIEW_MODEL = { trivial: "haiku", standard: "haiku", complex: "sonnet" };
const reviewModel = (t) => TASK_REVIEW_MODEL[t.complexity] || "haiku";
const implModel = (t) => (t.complexity === "complex" ? "opus" : "haiku");

// Role file, read by the dispatched merger itself (never inlined here).

// Prepended to every prompt below: these agents run headless inside a
// Workflow, so any prose between tool calls is wasted tokens no one reads.
const NO_NARRATION = "No narrative text between tool calls — call tools silently and speak only in your final message (the report or structured output). Write that final message in English, whatever the language of the task or its inputs; commit messages are not covered.";

// Shared tail for every prompt that has an agent write a file verbatim via
// Bash redirection: the universal-format hook reformats anything written
// through Write/Edit, so content that must reach disk byte for byte cannot go
// through them.
const WRITE_VIA_BASH_NOT_WRITE_EDIT = "NEVER the Write or Edit tool; the universal-format hook reformats those";

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
    complexity: { enum: ["trivial", "standard", "complex"], description: "copied verbatim from the plan task; selects the implementing model" },
  },
};
const PLAN_STATE = {
  type: "object",
  required: ["constraints", "tasks", "taskHeadings"],
  properties: {
    constraints: { type: "string", description: "the plan's ## Global Constraints, verbatim" },
    tasks: { type: "array", items: TASK_ITEM },
    taskHeadings: { type: "number", description: "output of grep -c '^### Task ' on the plan file" },
  },
};
const IMPL_RESULT = {
  type: "object",
  required: ["status", "commitHash", "branch", "worktreePath", "testEvidencePath", "deviations"],
  properties: {
    status: { enum: ["done", "blocked"] },
    commitHash: { type: "string" },
    branch: { type: "string" }, // self-reported from its own worktree
    worktreePath: { type: "string" }, // ditto — never derived from tool side-channels
    testEvidencePath: { type: "string" },
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
const WRITE_RESULT = {
  type: "object",
  required: ["status"],
  properties: { status: { enum: ["written", "blocked"] }, detail: { type: "string" }, bytes: { type: "integer" } },
};

// ═════════════════════════════════════════════════════════════════════════════
// IMPLEMENT  (waves; worktree + merger only for multi-task waves)
// ═════════════════════════════════════════════════════════════════════════════
phase("Implement");

// ── Load the plan's constraints and task list (the script has no FS access) ──
const loadPlanPrompt = `${NO_NARRATION}

You are a read-only plan loader. Read the plan file at ${PLAN_PATH} and return
structured output only:
- constraints: the '## Global Constraints' section verbatim (the text under
  that heading, up to the next '## ' heading).
- tasks: the JSON array in the fenced block under the '## Machine-readable
  tasks' heading, verbatim — every object, every field, no edits, no reordering.
- taskHeadings: the number printed by \`grep -c '^### Task ' "${PLAN_PATH}"\`
  (run it with Bash).
Change nothing on disk.`;
// A mis-copied block is caught structurally: non-empty, numeric unique ids, and
// as many entries as the plan has '### Task ' headings.
const validPlan = (p) =>
  !!p
  && typeof p.constraints === "string"
  && Array.isArray(p.tasks)
  && p.tasks.length > 0
  && p.tasks.every((t) => t && typeof t.id === "number")
  && new Set(p.tasks.map((t) => t.id)).size === p.tasks.length
  && p.tasks.length === p.taskHeadings;
const loadOpts = { label: "load-plan", phase: "Implement", schema: PLAN_STATE, model: MODELS.loader };
let loaded = await agent(loadPlanPrompt, loadOpts);
if (!validPlan(loaded)) loaded = await agent(loadPlanPrompt, { ...loadOpts, label: "load-plan:retry" });
if (!validPlan(loaded)) {
  return { status: "error", stage: "Implement", error: "could not load the plan tasks from PLAN_PATH", tasks: [], waves: [], results: [], minorFindings: [] };
}
const tasks = loaded.tasks;
const constraints = loaded.constraints;
log("Plan loaded: " + tasks.length + " task(s) — " + tasks.map((t) => t.id + ":" + (t.complexity || "standard")).join(", "));

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
    if (ambiguous) { for (const other of sorted) if (Number(other.id) < Number(t.id)) deps.add(other.id); }
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

// Per-task test-evidence file: t.id in the name so parallel-wave tasks never
// collide (runTask runs concurrently via parallel()). Sanitize the interpolated
// id (schema-typed number, but be defensive) — never the whole path, which
// would mangle SCRATCH_DIR's separators.
const tevPathFor = (t) => SCRATCH_DIR + "test-evidence-task-" + String(t.id).replace(/[^A-Za-z0-9._-]/g, "_") + ".txt";
const GM_IMPL = (purpose) => gmHint(purpose, "<absolute path of your current checkout: `git rev-parse --show-toplevel`>");
const implementerPrompt = (t, isolated) =>
  `${NO_NARRATION}${GM_IMPL("to find the callers, signatures and related code of what you change")}

You are the implementer for exactly one plan
task, ${
    isolated
      ? `running in your own isolated git worktree.
FIRST, before anything else: run \`git reset --hard ${BRANCH_NAME}\`. Your
worktree was branched from the repo's default branch, not ${BRANCH_NAME} —
skipping this means working from a stale base missing every earlier wave's
merged work.`
      : `working directly on branch ${BRANCH_NAME} in the current checkout (single-task wave: no worktree, no merge step).
FIRST, before anything else: run \`git branch --show-current\` and \`git status --porcelain\`; if the branch is not ${BRANCH_NAME} or the status output is non-empty, change nothing and return status blocked with the reason in deviations. Never run \`git reset\`, \`git stash\`, \`git checkout\`/\`git switch\`, or create a branch or worktree. Commit onto ${BRANCH_NAME} and leave the working tree clean (\`git status --porcelain\` empty) before returning.`
  }
Plan file: ${PLAN_PATH} — Read it; execute ONLY task ${t.id} (${t.title}).
Global constraints (binding): ${constraints}
Work test-first: write the task's failing test, watch it fail, implement
minimally, watch it pass, run the task's verification commands. Commit the task
as ONE commit following the repo's commit conventions (no co-author trailers,
no generated-with footers). Touch nothing outside the task's scope.
Write every test/verification command you run and its full output to the
absolute file ${tevPathFor(t)} via Bash redirection (append with
\`{ echo "\$ <cmd>"; <cmd>; } 2>&1 | tee -a "<path>"\`, or a heredoc — ${WRITE_VIA_BASH_NOT_WRITE_EDIT}).
Before returning, run \`git branch --show-current\`,
\`git rev-parse --show-toplevel\`, and \`git rev-parse HEAD\` and report their
exact output, set testEvidencePath to that same absolute path, and report any
deviation from the plan inline in deviations. Return through the structured
output schema.`;

const reviewerPrompt = (t, implReport, isolated) =>
  `${NO_NARRATION}${GM_IMPL("to check callers and signatures of what the task touched")}

You are a read-only reviewer for one
plan task. Plan file: ${PLAN_PATH} — Read it; review ONLY task ${t.id}
(${t.title}).
Implementer report: ${implReport}
The commit lives on the branch named in the report — read it with
\`git show <branch>\` / \`git log <branch>\` (refs are shared across worktrees;
no checkout needed).${
    isolated
      ? ""
      : `
This task ran directly on the work branch: reject unless the report's branch is
exactly ${BRANCH_NAME}, the task's commit is on it (\`git log ${BRANCH_NAME}\`), and
\`git status --porcelain\` is empty.`
  }
Check spec/plan compliance against the task text and these
global constraints, then correctness: ${constraints}
The test evidence is in the file named by testEvidencePath in the report — use
the Read tool on it if you need it; do not re-run the tests the implementer
already ran. Return your verdict through the structured output schema.`;

const fixerPrompt = (t, findings, worktreePath, branch) =>
  `${NO_NARRATION}${GM_IMPL("to find the code the findings point at and its callers")}

You are the fixer
for one reviewed plan task. You are on branch ${branch} at ${worktreePath} — run
your commands there; do not create a new worktree or branch, and do not switch
branches. A
standalone \`cd\` does NOT persist to your next Bash call — chain
\`cd "${worktreePath}" && ...\` into every single command, or every command
after the first silently runs in your default checkout.
Plan file: ${PLAN_PATH}, task ${t.id} (${t.title}).
Apply exactly these findings — nothing else — then commit (repo conventions,
no co-author trailers): ${JSON.stringify(findings)}
Return: STATUS: done|blocked, commit hash, what changed.`;

const mergerPrompt = (approved) =>
  `Merge target branch: ${BRANCH_NAME}
Approved task branches — merge in exactly this order, one at a time:
${JSON.stringify(approved)}
(each entry is {id, branch, worktreePath}). Procedure, cleanup order, conflict
protocol, and toplevel self-report per your role definition.
Return through the structured output schema — one entry per task attempted.`;

// Per-task loop: implement (isolated only in multi-task waves) → review → at most one fix → re-review.
async function runTask(t, isolated) {
  const model = implModel(t);
  const implOpts = { label: "task:" + t.id + ":" + model, phase: "Implement", ...(isolated ? { isolation: "worktree" } : {}), schema: IMPL_RESULT, model };
  let impl = await agent(implementerPrompt(t, isolated), implOpts);
  if (impl === null) impl = await agent(implementerPrompt(t, isolated), { ...implOpts, label: implOpts.label + ":retry" });
  if (impl === null) return { id: t.id, status: "failed", reason: "implementer returned null twice" };
  if (impl.status === "blocked") {
    return { id: t.id, status: "failed", reason: "implementer blocked: " + impl.deviations, branch: impl.branch, worktreePath: impl.worktreePath };
  }
  const implReport = JSON.stringify(impl);
  const revOpts = { label: "review:" + t.id, phase: "Implement", schema: VERDICT, model: reviewModel(t) };
  let review = await agent(reviewerPrompt(t, implReport, isolated), revOpts);
  if (review === null) review = await agent(reviewerPrompt(t, implReport, isolated), { ...revOpts, label: "review:" + t.id + ":retry" });
  if (review && !review.approved) {
    const blocking = review.findings.filter((f) => f.severity !== "minor");
    if (blocking.length) {
      const fix = await agent(fixerPrompt(t, blocking, impl.worktreePath, impl.branch), { label: "fix:" + t.id, phase: "Implement", model });
      const reReport = "Post-fix re-review. Branch: "
        + impl.branch
        + " — the fix commit is the LATEST commit on that branch (run `git log "
        + impl.branch
        + " -1`); diff that too, not only the original commit. "
        + "Original report: "
        + implReport
        + ". Fix report: "
        + fix;
      const reOpts = { ...revOpts, label: "re-review:" + t.id };
      review = await agent(reviewerPrompt(t, reReport, isolated), reOpts);
      if (review === null) review = await agent(reviewerPrompt(t, reReport, isolated), { ...reOpts, label: reOpts.label + ":retry" });
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
  const isolated = waveTasks.length > 1;
  log(
    "Wave "
      + (i + 1)
      + "/"
      + waves.length
      + ": dispatching "
      + waveTasks.length
      + " task(s) "
      + (isolated ? "in isolated worktrees" : "directly on " + BRANCH_NAME)
      + " (ids "
      + waveIds.join(", ")
      + "; models "
      + waveTasks.map((t) => implModel(t)).join(", ")
      + ")",
  );

  // Isolated + parallel() only when >1 (barrier, thunks — never started promises); a single task commits directly on BRANCH_NAME.
  const waveResults = isolated ? await parallel(waveTasks.map((t) => () => runTask(t, true))) : [await runTask(waveTasks[0], false)];
  results.push(...waveResults);

  // Merge-back only for multi-task waves, through the separate merge agent; a single-task wave already committed on BRANCH_NAME.
  const approved = waveResults.filter((r) => r && r.status === "done").map((r) => ({ id: r.id, branch: r.branch, worktreePath: r.worktreePath }));
  for (const r of waveResults) if (r && r.minor && r.minor.length) minorLedger.push({ id: r.id, minor: r.minor });

  if (isolated && approved.length) {
    const mOpts = { label: "merge:wave" + (i + 1), phase: "Implement", schema: MERGE_RESULT, model: MODELS.merger, agentType: "taskflow:worktree-merger" };
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

// Per-task view for the skill's report and the result file; a task that never
// started (pipeline stopped in an earlier wave) stays 'pending'.
const statusOf = (id) => {
  const r = results.find((x) => x && Number(x.id) === Number(id));
  return r ? r.status : "pending";
};
const taskList = tasks.map((t) => ({ id: t.id, title: t.title, complexity: t.complexity, model: implModel(t), status: statusOf(t.id) }));

if (implementFailed) {
  return { status: "error", stage: "Implement", error: "task failure or wave-merge conflict — pipeline stopped before Review; do not open a PR on a half-implemented plan", tasks: taskList, waves, results, minorFindings: minorLedger };
}

// ── Persist the result (read later by the pr-author of the ship script) ─────
// The text reaches disk through a Bash heredoc, then its reported size must
// equal the expected UTF-8 byte count (or that plus the heredoc's newline):
// a truncated JSON file would break the pr-author's read, so no tolerance here.
async function persist(path, obj) {
  const text = JSON.stringify(obj, null, 2);
  const expectedBytes = encodeURIComponent(text).replace(/%[0-9A-F]{2}/g, "x").length;
  const prompt = `${NO_NARRATION}\n\nWrite the text between the BEGIN/END markers below to ${path} (create/overwrite), byte for byte — no edits, no summary, markers excluded — with a Bash heredoc: \`cat > "${path}" <<'TASKFLOW_JSON_EOF'\`, then the text, then a line holding only TASKFLOW_JSON_EOF (${WRITE_VIA_BASH_NOT_WRITE_EDIT}). Then run \`wc -c < "${path}"\` and return structured output: status "written" plus bytes (that number), or "blocked" + detail if the write failed.\n<<<BEGIN>>>\n${text}\n<<<END>>>`;
  const isIntact = (w) => w && w.status === "written" && (w.bytes === expectedBytes || w.bytes === expectedBytes + 1);
  const opts = { label: "persist", phase: "Implement", schema: WRITE_RESULT, model: MODELS.scribe };
  let written = await agent(prompt, opts);
  if (!isIntact(written)) written = await agent(prompt, { ...opts, label: "persist:retry" });
  return !!isIntact(written);
}

const persisted = await persist(IMPLEMENT_PATH, { branch: BRANCH_NAME, plan: PLAN_PATH, tasks: taskList, waves, taskResults: results, minorFindings: minorLedger });
if (!persisted) {
  return { status: "error", stage: "Implement", error: "could not write IMPLEMENT_PATH — all tasks are committed on " + BRANCH_NAME, tasks: taskList, waves, results, minorFindings: minorLedger };
}
log("Exit: implement result written to " + IMPLEMENT_PATH);
return { status: "complete", implementPath: IMPLEMENT_PATH, tasks: taskList, waves, minorFindings: minorLedger };
