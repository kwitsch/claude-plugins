// ─────────────────────────────────────────────────────────────────────────────
// review-task-stages.workflow.js — review-task's branch review in four stages
//
//   Simplify → Review (read-only jobs in parallel) → Organize (dedupe,
//   severity, spec check) → Fix (fixer commit + rereview, at most 2 rounds)
//
// Run by the review-task skill (skills/review-task/SKILL.md) as the plugin
// workflow `review-task-stages`, by name. MODE "full" runs all four stages;
// MODE "fix" runs only the Fix stage over FINDINGS (the spec-endangering
// findings the user chose to fix against the spec). The script never asks:
// spec conflicts are returned, and the skill decides them.
//
// Exits:
//   'complete' — { status, mode, simplify, reviews, organize, fix, specFindings, simplifySpecConflict }
//   'error'    — { status, stage: 'args' | 'review' | 'organize', error }
//
// Args: { MODE, BASE, BRANCH, LEVEL, SPEC_PATH, ENV, REPO_PATH, FINDINGS }
//   MODE      — "full" or "fix"
//   BASE      — base ref; the branch diff is `git diff BASE...HEAD`
//   BRANCH    — current branch (`git branch --show-current`)
//   LEVEL     — code-review level: medium | high | xhigh | max
//   SPEC_PATH — absolute spec path, or "" (no spec check)
//   ENV       — the get-environment object { jevApi, advisor, graphmind, ponytail, coderabbit }
//   REPO_PATH — absolute repository root (`git rev-parse --show-toplevel`)
//   FINDINGS  — MODE "fix" only: non-empty array of finding objects as a full run returned them
//
// Invocation contract: as the build-task scripts (by name with ONE JSON object
// as args; fallback `const args = { … }` after the meta block when decodeArgs
// reports "args global is undefined"). No clock reads, randomness or file
// writes; commits are the only side effect, never a reset, stash or checkout.
//
// Models: MODELS below (family aliases only).
// ─────────────────────────────────────────────────────────────────────────────

export const meta = {
  name: "review-task-stages",
  description: "Branch review: simplify → parallel read-only review jobs → organize (dedupe, severity, spec check) → fix with rereview (at most 2 rounds)",
  phases: [
    { title: "Simplify", detail: "Bundled simplify skill, one commit" },
    { title: "Review", detail: "Read-only jobs in parallel: code-review always, ponytail-review and CodeRabbit when available" },
    { title: "Organize", detail: "Dedupe, severity, dismissals; with a spec, every fix and the simplify commit checked against it" },
    { title: "Fix", detail: "Fixer commit and rereview; at most 2 rounds" },
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
const A = decodeArgs(["MODE", "BASE", "BRANCH", "LEVEL", "ENV", "REPO_PATH"], { SPEC_PATH: "", FINDINGS: [] });
if (A.__error) return { status: "error", stage: "args", error: A.__error };
const { MODE, BASE, BRANCH, LEVEL, REPO_PATH, ENV, FINDINGS } = A;
if (MODE !== "full" && MODE !== "fix") return { status: "error", stage: "args", error: "MODE must be \"full\" or \"fix\"" };
if (!["medium", "high", "xhigh", "max"].includes(LEVEL)) return { status: "error", stage: "args", error: "LEVEL must be one of medium, high, xhigh, max" };
if (typeof ENV !== "object" || ENV === null || Array.isArray(ENV)) return { status: "error", stage: "args", error: "ENV must be an object" };
if (typeof REPO_PATH !== "string" || !REPO_PATH.startsWith("/")) return { status: "error", stage: "args", error: "REPO_PATH must be an absolute path" };
if (MODE === "fix" && (!Array.isArray(FINDINGS) || FINDINGS.length === 0)) return { status: "error", stage: "args", error: "MODE \"fix\" requires a non-empty FINDINGS array" };
const SPEC_PATH = typeof A.SPEC_PATH === "string" ? A.SPEC_PATH.trim() : "";
const flag = (k) => ENV[k] === true || ENV[k] === "true";

const MODELS = {
  simplifier: "sonnet", // runs the bundled simplify skill and commits
  codeReviewer: "opus", // runs the bundled code-review skill, findings only
  ponytail: "sonnet", // runs the ponytail-review skill, findings only
  coderabbitReviewer: "haiku", // runs the CodeRabbit CLI and maps its NDJSON
  organizer: "opus", // dedupe, verification, severity
  specChecker: "sonnet", // compares fixes with the spec
  fixer: "sonnet", // applies the findings and commits
  rereviewer: "opus", // checks the fix commit
};
const MAX_FIX_ROUNDS = 2;
const SPEC_BATCH = 8;

// Prepended to every prompt below: these agents run headless inside a
// Workflow, so any prose between tool calls is wasted tokens no one reads.
const NO_NARRATION = "No narrative text between tool calls — call tools silently and speak only in your final message (the report or structured output). Write that final message in English, whatever the language of the task or its inputs; commit messages are not covered.";

// Appended to every prompt that runs git: the worktree-isolation guard refuses
// these Bash shapes, and a refused command fails again on repeat.
const BASH_SHAPE_HINT = "Bash commands: the worktree-isolation guard refuses $(...), ${!var}, git -C and a cd to a computed path before git, and repeating a refused command fails the same way. Run plain commands with literal absolute paths.";

// Every review, organize, spec-check and rereview prompt carries this.
const READ_ONLY = "You are read-only: report findings only; apply no fix, spend no CodeRabbit credits. Never edit a file, never run a git command that changes the index, the working tree, refs or the stash, and never ask the user.";

// Tool availability comes from review-task's get-environment call (ENV).
const USE_GRAPHMIND = flag("graphmind");
const gmHint = (purpose) =>
  USE_GRAPHMIND
    ? `\n\nHint: graphmind indexes this repository. Optionally load its tools with ToolSearch(query: "select:mcp__graphmind__gm_search,mcp__graphmind__gm_outline,mcp__graphmind__gm_fn,mcp__graphmind__gm_deps") and use them ${purpose} rather than broad Grep/Read; pass project: ${REPO_PATH} on every call. Fall back to Read/Grep when a call errors or returns nothing.`
    : "";

// ── Schemas ──────────────────────────────────────────────────────────────────
const RAW_FINDING = {
  type: "object",
  required: ["file", "line", "title", "detail", "fix"],
  properties: { file: { type: "string" }, line: { type: "number" }, title: { type: "string" }, detail: { type: "string" }, fix: { type: "string" } },
};
const FINDING_PROPS = {
  id: { type: "string" },
  sources: { type: "array", items: { type: "string" } },
  file: { type: "string" },
  line: { type: "number" },
  title: { type: "string" },
  detail: { type: "string" },
  fix: { type: "string" },
  severity: { enum: ["critical", "major", "minor", "trivial"] },
};
const SIMPLIFY_RESULT = {
  type: "object",
  required: ["status", "commit", "summary", "error"],
  properties: { status: { enum: ["committed", "unchanged", "failed"] }, commit: { type: "string" }, summary: { type: "string" }, error: { type: "string" }, dirty: { type: "array", items: { type: "string" } } },
};
const REVIEW_RESULT = {
  type: "object",
  required: ["status", "reason", "findings"],
  properties: { status: { enum: ["ok", "failed", "skipped"] }, reason: { type: "string" }, findings: { type: "array", items: RAW_FINDING } },
};
const ORGANIZED = {
  type: "object",
  required: ["treeClean", "paths", "findings"],
  properties: {
    treeClean: { type: "boolean" },
    paths: { type: "array", items: { type: "string" } },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "sources", "file", "line", "title", "detail", "fix", "severity", "verdict", "reason"],
        properties: { ...FINDING_PROPS, verdict: { enum: ["fix", "dismiss"] }, reason: { type: "string" } },
      },
    },
  },
};
const SPEC_CHECK = {
  type: "object",
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "specConflict", "decision", "reason"],
        properties: { id: { type: "string" }, specConflict: { type: "boolean" }, decision: { type: "string" }, reason: { type: "string" } },
      },
    },
    simplify: {
      type: "object",
      properties: { specConflict: { type: "boolean" }, decision: { type: "string" }, reason: { type: "string" } },
    },
  },
};
const ID_REASON = { type: "object", required: ["id", "reason"], properties: { id: { type: "string" }, reason: { type: "string" } } };
const FIX_RESULT = {
  type: "object",
  required: ["pre", "commit", "applied", "skipped", "error"],
  properties: { pre: { type: "string" }, commit: { type: "string" }, applied: { type: "array", items: { type: "string" } }, skipped: { type: "array", items: ID_REASON }, error: { type: "string" } },
};
const REREVIEW = {
  type: "object",
  required: ["resolved", "unresolved", "newFindings"],
  properties: { resolved: { type: "array", items: { type: "string" } }, unresolved: { type: "array", items: ID_REASON }, newFindings: { type: "array", items: RAW_FINDING } },
};

// ── Prompts ──────────────────────────────────────────────────────────────────
const simplifyPrompt = () =>
  `${NO_NARRATION}

You run the Simplify stage of a branch review on branch ${BRANCH} in ${REPO_PATH}.
1. Run Skill(skill: "simplify", args: "the changes of git diff ${BASE}...HEAD on branch ${BRANCH}") and follow it to its end. Never ask the user: where it would ask, take the conservative choice (change less) and say so in summary.
2. Run \`git status --porcelain\`. Non-empty → \`git add -A\`, then \`git commit -m "Simplify branch changes"\` (no Co-Authored-By trailer, no "Generated with" footer). Never reset, stash or check out anything.
3. Answer status "committed" with commit = the output of \`git log -1 --format="%h %s"\`; "unchanged" when there was nothing to commit (commit ""); "failed" when the skill was unavailable or errored or the commit failed (error = the reason, or git's output verbatim). summary: what simplify changed, at most two sentences. error is "" unless failed.
4. dirty: the paths \`git status --porcelain\` still lists after step 2 ([] when the tree is clean). Leave a failed run's edits in the tree.
${BASH_SHAPE_HINT}`;

const codeReviewPrompt = () =>
  `${NO_NARRATION}${gmHint("to check callers and signatures of the changed code")}

You run the review job "code-review" on branch ${BRANCH} (base ${BASE}) in ${REPO_PATH}.
Run Skill(skill: "code-review", args: "${LEVEL} ${BRANCH}") and follow it to its end, without any option that makes it apply fixes. Collect every finding it reports.
${READ_ONLY}
Answer status "ok" with every finding as {file (repo-relative), line (0 when it names none), title, detail, fix (the concrete change it proposes)}, reason "". The skill unavailable or erroring → status "failed" with the reason, findings [].
${BASH_SHAPE_HINT}`;

const ponytailPrompt = () =>
  `${NO_NARRATION}${gmHint("to find existing code the changes could reuse")}

You run the review job "ponytail-review" on branch ${BRANCH} (base ${BASE}) in ${REPO_PATH}.
Run Skill(skill: "ponytail:ponytail-review", args: "the changes of git diff ${BASE}...HEAD") and follow it to its end. Collect every finding it reports (over-engineering, missed reuse, needless code).
${READ_ONLY}
Answer status "ok" with every finding as {file (repo-relative), line (0 when it names none), title, detail, fix (the concrete change it proposes)}, reason "". The skill unavailable or erroring → status "failed" with the reason, findings [].
${BASH_SHAPE_HINT}`;

const coderabbitPrompt = () =>
  `${NO_NARRATION}

You run the review job "coderabbit" on branch ${BRANCH} (base ${BASE}) in ${REPO_PATH}.
Run with Bash, from the current checkout: \`coderabbit review --agent --committed --base ${BASE}\`. Its output is NDJSON: one JSON object per line. When the shell does not find \`coderabbit\` on its PATH, run the same command through \`~/.local/bin/coderabbit\` (the environment check also looks there).
- Keep every finding whose severity is critical, major, minor or trivial, as {file (repo-relative), line (0 when it names none), title, detail, fix}; drop info and none items. Answer status "ok", reason "".
- An answer that reports a rate limit, a used-up review allowance, missing authentication, or action_required / awaiting_confirmation → status "skipped" with that reason, findings []. Never retry and never add a flag.
- Any other failure → status "failed" with the reason, findings [].
${READ_ONLY}
${BASH_SHAPE_HINT}`;

const organizePrompt = (raw) =>
  `${NO_NARRATION}${gmHint("to verify each finding against the code")}

You run the organize job of a branch review on branch ${BRANCH} in ${REPO_PATH} (changes: \`git diff ${BASE}...HEAD\`).
1. Run \`git status --porcelain\` first. Leave out these paths, which the Simplify stage left uncommitted before any review job ran: ${JSON.stringify(simplifyDirty)}. Any other path listed → treeClean false, paths = those paths, findings [], and stop. Otherwise treeClean true, paths [].
2. Merge findings on the same defect (same file and an overlapping cause) into one; sources lists every job (the "source" field) that reported it.
3. Verify each finding against the code. Set verdict "dismiss" with the reason when it is not a real defect or lies outside the changes of \`git diff ${BASE}...HEAD\`; otherwise verdict "fix" and reason "".
4. Set severity: critical (breaks behaviour, security or data), major (a real bug or a broken contract), minor (a small defect or a maintainability problem), trivial (style or naming).
5. id: any string; the script numbers the findings itself.
${READ_ONLY}
Findings (JSON): ${JSON.stringify(raw)}
${BASH_SHAPE_HINT}`;

const specCheckPrompt = (batch, simplifyCommit) =>
  `${NO_NARRATION}

You run a spec-check job of a branch review on branch ${BRANCH} in ${REPO_PATH}. Read the spec at ${SPEC_PATH}.
For each finding below decide: would applying its fix change behaviour, an interface or a structure that the spec decided? Answer one results entry per id: {id, specConflict, decision (the spec decision, quoted; "" when none), reason}.${
    simplifyCommit
      ? `
Also check the simplify commit ${simplifyCommit}: read it with \`git show ${simplifyCommit.split(" ")[0]}\` and answer in simplify {specConflict, decision, reason} whether it reverses a spec decision.`
      : ""
  }
${READ_ONLY}
Findings (JSON): ${JSON.stringify(batch)}
${BASH_SHAPE_HINT}`;

const fixerPrompt = (findings) =>
  `${NO_NARRATION}${gmHint("to find the code the findings point at and its callers")}

You are the fixer for review findings on branch ${BRANCH} in ${REPO_PATH}.
1. Run \`git rev-parse HEAD\`; its output is pre.
2. Apply the fix of every finding below, touching only what each fix needs. A finding you cannot apply safely → skip it with the reason. A decision or reason field naming the spec is a conflict the user already decided to override: apply the fix anyway. Never ask the user.
3. Run \`git status --porcelain\`. Non-empty → \`git add -A\`, then \`git commit -m "Apply review fixes"\` (no Co-Authored-By trailer, no "Generated with" footer); commit = the output of \`git log -1 --format="%h %s"\`. Nothing to commit → commit "". A failing commit → error = git's output verbatim. Never reset, stash or check out anything.
4. Answer pre, commit, applied (the ids you fixed), skipped ([{id, reason}]) and error ("" when none).
Findings (JSON): ${JSON.stringify(findings)}
${BASH_SHAPE_HINT}`;

const rereviewPrompt = (findings, pre) =>
  `${NO_NARRATION}${gmHint("to check callers of what the fix commit changed")}

You run the rereview job of a branch review on branch ${BRANCH} in ${REPO_PATH}. Read \`git diff ${pre}..HEAD\` and check it against the findings below.
- resolved: the ids whose defect the diff removes.
- unresolved: [{id, reason}] for every other id.
- newFindings: only defects the diff itself introduced, each {file, line, title, detail, fix}; nothing that existed before ${pre}.
${READ_ONLY}
Findings (JSON): ${JSON.stringify(findings)}
${BASH_SHAPE_HINT}`;

// ── Helpers ──────────────────────────────────────────────────────────────────
// One agent call with one retry when it returns null. Not for the jobs that commit (simplify, fixer, `retry` false):
// a retry would find the first attempt's commit already in place, report "nothing to commit" and lose it.
async function run(prompt, opts, retry = true) {
  const first = await agent(prompt, opts);
  return first != null || !retry ? first : agent(prompt, { ...opts, label: opts.label + ":retry" });
}
const reviewerOpts = (label, phaseName, schema, model) => ({ label, phase: phaseName, agentType: "taskflow:branch-reviewer", schema, model });
const unresolvedOf = (f, reason) => ({ id: f.id, severity: f.severity, file: f.file, line: f.line, title: f.title, reason });

const counts = { total: 0, merged: 0, dismissed: 0, fixable: 0, spec: 0 };
// Paths a failed simplify commit left dirty: the organize job's clean-tree check must not blame a review job for them.
let simplifyDirty = [];
let nextId = 1;
const specFindings = [];

// Dedupe + severity over raw findings; returns { fixable } or { stage, error }.
async function organize(raw, label) {
  const r = await run(organizePrompt(raw), reviewerOpts(label, "Organize", ORGANIZED, MODELS.organizer));
  if (r == null) return { stage: "organize", error: "the organize job returned null twice" };
  if (!r.treeClean) return { stage: "review", error: "a review job modified the working tree: " + (r.paths || []).join(", ") };
  const all = (r.findings || []).map((f) => ({ ...f, id: "F" + nextId++ }));
  const fixable = all.filter((f) => f.verdict === "fix").map(({ verdict, reason, ...f }) => f);
  counts.total += raw.length;
  counts.merged += Math.max(0, raw.length - all.length);
  counts.dismissed += all.length - fixable.length;
  counts.fixable += fixable.length;
  return { fixable };
}

// Spec check in batches of SPEC_BATCH; a failed or silent job counts as a conflict (ask, never override the spec).
async function specCheck(fixable, simplifyCommit) {
  const batches = [];
  for (let i = 0; i < fixable.length; i += SPEC_BATCH) batches.push(fixable.slice(i, i + SPEC_BATCH));
  if (batches.length === 0 && simplifyCommit) batches.push([]);
  const outs = await parallel(batches.map((b, i) => () => run(specCheckPrompt(b, i === 0 ? simplifyCommit : ""), reviewerOpts("spec-check:" + (i + 1), "Organize", SPEC_CHECK, MODELS.specChecker))));
  const conflicts = [];
  const clean = [];
  let simplifyConflict = null;
  batches.forEach((batch, i) => {
    const r = outs[i];
    for (const f of batch) {
      const hit = r ? (r.results || []).find((x) => x.id === f.id) : null;
      if (!hit) conflicts.push({ ...f, decision: "", reason: r ? "the spec check gave no answer for this finding" : "spec check failed" });
      else if (hit.specConflict) conflicts.push({ ...f, decision: hit.decision || "", reason: hit.reason || "" });
      else clean.push(f);
    }
    if (i === 0 && simplifyCommit) {
      const s = r ? r.simplify : null;
      if (!r) simplifyConflict = { commit: simplifyCommit, decision: "", reason: "spec check failed" };
      else if (!s) simplifyConflict = { commit: simplifyCommit, decision: "", reason: "the spec check gave no answer for the simplify commit" };
      else if (s.specConflict) simplifyConflict = { commit: simplifyCommit, decision: s.decision || "", reason: s.reason || "" };
    }
  });
  counts.spec += conflicts.length;
  return { conflicts, clean, simplifyConflict };
}

// Fixer + rereview, at most MAX_FIX_ROUNDS rounds; returns { fix } or { error: { stage, error } }.
async function fixStage(initial) {
  const commits = [];
  const fixed = [];
  const unresolved = [];
  let toFix = initial;
  let rounds = 0;
  for (let round = 1; round <= MAX_FIX_ROUNDS && toFix.length > 0; round++) {
    rounds = round;
    const fx = await run(fixerPrompt(toFix), { label: "fix:" + round, phase: "Fix", schema: FIX_RESULT, model: MODELS.fixer }, false);
    if (fx == null) {
      unresolved.push(...toFix.map((f) => unresolvedOf(f, "the fixer returned no result (it may have committed: check git log)")));
      toFix = [];
      break;
    }
    if (fx.commit) commits.push(fx.commit);
    const skipped = new Map((fx.skipped || []).map((s) => [s.id, s.reason]));
    unresolved.push(...toFix.filter((f) => skipped.has(f.id)).map((f) => unresolvedOf(f, "the fixer skipped it: " + skipped.get(f.id))));
    const attempted = toFix.filter((f) => !skipped.has(f.id));
    if (fx.error || !fx.commit) {
      const reason = fx.error ? "the fix commit failed: " + fx.error : "the fixer committed nothing";
      unresolved.push(...attempted.map((f) => unresolvedOf(f, reason)));
      toFix = [];
      break;
    }
    const rr = await run(rereviewPrompt(attempted, fx.pre), reviewerOpts("rereview:" + round, "Fix", REREVIEW, MODELS.rereviewer));
    if (rr == null) {
      unresolved.push(...attempted.map((f) => unresolvedOf(f, "not verified: the rereview returned null twice")));
      toFix = [];
      break;
    }
    const resolved = new Set(rr.resolved || []);
    const open = new Map((rr.unresolved || []).map((u) => [u.id, u.reason]));
    fixed.push(...attempted.filter((f) => resolved.has(f.id) && !open.has(f.id)).map((f) => f.id));
    let next = attempted.filter((f) => !resolved.has(f.id) || open.has(f.id)).map((f) => ({ ...f, reason: open.get(f.id) || "the rereview did not confirm it" }));
    const fresh = (rr.newFindings || []).map((f) => ({ ...f, source: "rereview" }));
    if (fresh.length > 0) {
      const org = await organize(fresh, "organize:" + round);
      if (org.stage === "review") return { error: org };
      if (org.error) {
        unresolved.push(...fresh.map((f) => ({ id: "F" + nextId++, severity: "unrated", file: f.file, line: f.line, title: f.title, reason: "not organized: " + org.error })));
      } else {
        let found = org.fixable;
        if (SPEC_PATH && found.length > 0) {
          const sc = await specCheck(found, "");
          found = sc.clean;
          if (MODE === "full") specFindings.push(...sc.conflicts);
          else unresolved.push(...sc.conflicts.map((f) => unresolvedOf(f, "endangers the spec: " + (f.decision || f.reason))));
        }
        next = next.concat(found);
      }
    }
    toFix = next;
  }
  unresolved.push(...toFix.map((f) => unresolvedOf(f, f.reason || "still open after " + MAX_FIX_ROUNDS + " fix rounds")));
  return { fix: { rounds, commits, fixed, unresolved } };
}

// ═════════════════════════════════════════════════════════════════════════════
// STAGES
// ═════════════════════════════════════════════════════════════════════════════
let simplify = { status: "skipped", commit: "", summary: "MODE fix: no simplify run", error: "" };
let simplifySpecConflict = null;
const reviews = [];
let toFix = [];

if (MODE === "full") {
  phase("Simplify");
  const s = await run(simplifyPrompt(), { label: "simplify", phase: "Simplify", schema: SIMPLIFY_RESULT, model: MODELS.simplifier }, false);
  simplify = s != null ? s : { status: "failed", commit: "", summary: "", error: "the simplify job returned no result (it may have committed: check git log)" };
  simplifyDirty = Array.isArray(simplify.dirty) ? simplify.dirty.filter((p) => typeof p === "string") : [];
  log("Simplify: " + simplify.status + (simplify.commit ? " " + simplify.commit : "") + (simplify.error ? " (" + simplify.error + ")" : ""));

  phase("Review");
  const jobs = [
    { source: "code-review", model: MODELS.codeReviewer, prompt: codeReviewPrompt() },
    ...(flag("ponytail") ? [{ source: "ponytail-review", model: MODELS.ponytail, prompt: ponytailPrompt() }] : []),
    ...(flag("coderabbit") ? [{ source: "coderabbit", model: MODELS.coderabbitReviewer, prompt: coderabbitPrompt() }] : []),
  ];
  const outs = await parallel(jobs.map((j) => () => run(j.prompt, reviewerOpts(j.source, "Review", REVIEW_RESULT, j.model))));
  const raw = [];
  jobs.forEach((j, i) => {
    const r = outs[i] || { status: "failed", reason: "the job returned null twice", findings: [] };
    const found = r.status === "ok" ? r.findings || [] : [];
    reviews.push({ source: j.source, status: r.status, reason: r.reason || "", count: found.length });
    raw.push(...found.map((f) => ({ ...f, source: j.source })));
  });
  if (!flag("ponytail")) reviews.push({ source: "ponytail-review", status: "skipped", reason: "not available (get-environment)", count: 0 });
  if (!flag("coderabbit")) reviews.push({ source: "coderabbit", status: "skipped", reason: "not available (get-environment)", count: 0 });
  log("Review: " + reviews.map((r) => r.source + " " + r.status + " (" + r.count + ")").join(", "));
  if (reviews[0].status !== "ok") return { status: "error", stage: "review", error: "the code-review job " + reviews[0].status + ": " + reviews[0].reason };

  phase("Organize");
  const org = await organize(raw, "organize");
  if (org.error) return { status: "error", stage: org.stage, error: org.error };
  toFix = org.fixable;
  const simplifyCommit = simplify.status === "committed" ? simplify.commit : "";
  if (SPEC_PATH && (toFix.length > 0 || simplifyCommit)) {
    const sc = await specCheck(toFix, simplifyCommit);
    toFix = sc.clean;
    specFindings.push(...sc.conflicts);
    simplifySpecConflict = sc.simplifyConflict;
  }
  log("Organize: " + JSON.stringify(counts));
} else {
  toFix = FINDINGS;
  nextId = 1 + Math.max(0, ...FINDINGS.map((f) => Number(String(f.id).replace(/^F/, "")) || 0));
}

let fix = { rounds: 0, commits: [], fixed: [], unresolved: [] };
if (toFix.length > 0) {
  phase("Fix");
  const out = await fixStage(toFix);
  if (out.error) return { status: "error", stage: out.error.stage, error: out.error.error };
  fix = out.fix;
  log("Fix: " + fix.fixed.length + " fixed, " + fix.unresolved.length + " unresolved in " + fix.rounds + " round(s)");
}

return {
  status: "complete",
  mode: MODE,
  simplify: { status: simplify.status, commit: simplify.commit || "", summary: simplify.summary || "", error: simplify.error || "" },
  reviews,
  organize: counts,
  fix,
  specFindings,
  simplifySpecConflict,
};
