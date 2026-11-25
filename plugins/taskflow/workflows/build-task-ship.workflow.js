// ─────────────────────────────────────────────────────────────────────────────
// build-task-ship.workflow.js — build-task delivery pipeline, phase 4 of 4
//
//   PR/MR text (pr-author) → push + create-or-update + mergeability (shipper)
//   → bounded CI watch (ci-monitor) with bounded fix rounds (ci-fixer)
//
// Needs no pipeline state in JS: the pr-author reads the implement and review
// result files (IMPLEMENT_PATH, REVIEW_PATH) itself and writes the PR/MR body
// to PR_BODY_PATH. Problems here are reportable ship states, NOT errors — the
// work is committed either way. build-task simply does not run this script
// when the user asked for no PR/MR. Exits:
//
//   'complete' — { status, ship } with ship.status in
//                blocked | shipped | ci_failed | ci_timeout | ci_unknown
//   'error'    — { status, stage: 'args', error }
//
// Args: { SPEC_PATH, PLAN_PATH, IMPLEMENT_PATH, REVIEW_PATH, PR_BODY_PATH,
//         BRANCH_NAME, BASE_BRANCH?, PLUGIN_ROOT? }
//   SPEC_PATH      — absolute path of the approved spec file (PR context)
//   PLAN_PATH      — absolute path of the plan file (PR context)
//   IMPLEMENT_PATH — absolute path of the implement result file (JSON)
//   REVIEW_PATH    — absolute path of the review result file (JSON)
//   PR_BODY_PATH   — absolute path the pr-author writes the PR/MR body to
//   BRANCH_NAME    — current work branch (`git branch --show-current`)
//   BASE_BRANCH    — branch the work branch was cut from (default 'main')
//   PLUGIN_ROOT    — absolute plugin root (build-task passes its substituted
//                    plugin root); used to build the ship-ensure-mergeable.mjs
//                    path handed to shipper. Absent → shipper skips
//                    remediation and reports mergeState 'unknown'.
//
// Invocation contract:
//   - PRIMARY: the plugin workflow `build-task-ship` (by name, namespaced by the plugin, args)
//     with ONE JSON object as args — the script reads it as the global `args`.
//   - FALLBACK (decodeArgs reports "args global is undefined"): prepend
//     EXACTLY ONE line right after the meta block: `const args = { … }`
//     (JSON literal) and submit the text via `script` without the tool-level
//     `args` parameter.
//   - No clock reads, randomness or FS in the script.
//
// Models: pr-author, shipper and ci-monitor haiku, ci-fixer sonnet.
// ─────────────────────────────────────────────────────────────────────────────

export const meta = {
  name: "build-task-ship",
  description: "Result files → PR/MR text → push, PR/MR create-or-update, mergeability → CI watch with bounded fix rounds",
  phases: [
    { title: "Ship", detail: "Push, create/update PR/MR, watch CI + bounded fix rounds" },
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
const A = decodeArgs(["SPEC_PATH", "PLAN_PATH", "IMPLEMENT_PATH", "REVIEW_PATH", "PR_BODY_PATH", "BRANCH_NAME"], { BASE_BRANCH: "main", PLUGIN_ROOT: "" });
if (A.__error) return { status: "error", stage: "args", error: A.__error };
const { SPEC_PATH, PLAN_PATH, IMPLEMENT_PATH, REVIEW_PATH, PR_BODY_PATH, BRANCH_NAME } = A;
const BASE_BRANCH = A.BASE_BRANCH || "main"; // empty/null counts as missing
for (const [k, v] of [["SPEC_PATH", SPEC_PATH], ["PLAN_PATH", PLAN_PATH], ["IMPLEMENT_PATH", IMPLEMENT_PATH], ["REVIEW_PATH", REVIEW_PATH], ["PR_BODY_PATH", PR_BODY_PATH]]) {
  if (typeof v !== "string" || !v.startsWith("/")) return { status: "error", stage: "args", error: k + " must be an absolute path" };
}
// An unresolved substitution token (e.g. build-task read its own SKILL.md as
// plain text instead of through the Skill tool) is a non-empty string that
// would otherwise pass a bare truthiness check — treat it as absent, same as "".
const PLUGIN_ROOT = A.PLUGIN_ROOT && !A.PLUGIN_ROOT.includes("${") ? A.PLUGIN_ROOT : "";

// Tool availability is detected once in build-task/SKILL.md and threaded in
// (.claude/rules/script-authoring.md §4); a hint is appended only when it was found.
const REPO = typeof A.REPO_PATH === "string" ? A.REPO_PATH.trim() : "";
const wantGraphmind = A.GRAPHMIND_AVAILABLE === true || A.GRAPHMIND_AVAILABLE === "true";
const USE_GRAPHMIND = wantGraphmind && REPO.startsWith("/");
if (wantGraphmind && !USE_GRAPHMIND) {
  return { status: "error", stage: "args", error: "GRAPHMIND_AVAILABLE=true requires a non-empty absolute REPO_PATH" };
}
const USE_JEV = A.JEV_AVAILABLE === true || A.JEV_AVAILABLE === "true";
const jevHint = USE_JEV
  ? ` Hint: jev-api is available. To sort a failing job into flaky/infra, code-caused or base-broken, load it with ToolSearch(query: "select:mcp__jev-api__request") and call mcp__jev-api__request with state = the failure log excerpt and questions = [{"type": "choice", "instructions": "What caused this failing job?", "criteria": {"flaky-infra": "transient or infrastructure failure, a rerun may pass", "code-caused": "the branch's change breaks it", "base-broken": "already red on the base branch"}}]. The result is an array; use the choice of its first element only when confidence >= 0.6; otherwise decide yourself.`
  : "";
const gmHint = (purpose, project) =>
  USE_GRAPHMIND
    ? `\n\nHint: graphmind indexes this repository. Optionally load its tools with ToolSearch(query: "select:mcp__graphmind__gm_search,mcp__graphmind__gm_outline,mcp__graphmind__gm_fn,mcp__graphmind__gm_deps") and use them ${purpose} rather than broad Grep/Read; pass project: ${project} on every call. Fall back to Read/Grep when a call errors or returns nothing.`
    : "";

const MODELS = {
  prAuthor: "haiku", // faithful writing from structured inputs + repo template
  shipper: "haiku", // pure git/gh/glab procedure (merger analogue)
  ciMonitor: "haiku", // bounded poll + classification, read-only
  ciFixer: "sonnet", // diagnose + fix: judgment/coding, CI as the only safety net
};

// Prepended to the inline (non-agent) prompts below: these agents run headless inside a
// Workflow, so any prose between tool calls is wasted tokens no one reads.
const NO_NARRATION = "No narrative text between tool calls — call tools silently and speak only in your final message (the report or structured output). Write that final message in English, whatever the language of the task or its inputs; commit messages are not covered.";

// Shared tail for the PR-body prompts: the universal-format hook reformats
// anything written through Write/Edit, so content that must reach disk
// verbatim cannot go through them. Same wording as roles/pr-author.md.
const WRITE_VIA_BASH_NOT_WRITE_EDIT = "NEVER the Write or Edit tool; the universal-format hook reformats those";

// ── Schemas ──────────────────────────────────────────────────────────────────
const PR_TEXT = {
  type: "object",
  required: ["title", "bodyPath"],
  properties: { title: { type: "string" }, bodyPath: { type: "string" } },
};
const FILES_CHECK = {
  type: "object",
  required: ["ok"],
  properties: { ok: { type: "boolean" }, detail: { type: "string" } },
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
// SHIP  (push, PR/MR, CI watch; problems here are reportable states, NOT a
// pipeline abort — the work is committed either way)
// ═════════════════════════════════════════════════════════════════════════════
phase("Ship");

const MAX_CI_MONITOR_ROUNDS = 6; // the monitor waits internally, ~5 min bounded per round
const MAX_CI_FIX_ROUNDS = 2;
let ship;

// The pr-author reads both result files itself — no pipeline state is inlined.
const RESULT_FILES = "Pipeline result files (faithful source of truth — Read both): implement result "
  + IMPLEMENT_PATH
  + " (tasks, waves, per-task minor findings), review result "
  + REVIEW_PATH
  + " (level, summary, applied/skipped, escalated open items, fix commits, lean-review findings)";
const CONTEXT_FILES = "Spec (context): " + SPEC_PATH + " — Plan (context): " + PLAN_PATH;
// Fail closed: a missing or empty result file would silently drop open items from the PR/MR body.
const filesCheck = await agent(
  NO_NARRATION
    + "\n\nFor each absolute path below run `test -s \"<path>\"` with the Bash tool. Return ok=true only when every file exists and is non-empty, else ok=false with the failing paths in detail. Do not read or change anything.\n"
    + IMPLEMENT_PATH
    + "\n"
    + REVIEW_PATH
    + "\nStructured output only.",
  { label: "result-files-check", phase: "Ship", schema: FILES_CHECK, model: MODELS.prAuthor },
);
const filesOk = !!(filesCheck && filesCheck.ok === true);
const prOpts = { label: "pr-author", phase: "Ship", schema: PR_TEXT, model: MODELS.prAuthor, agentType: "taskflow:pr-author" };
let prText = !filesOk ? null : await agent(
  "Write the PR/MR title and body for branch "
    + BRANCH_NAME
    + " → "
    + BASE_BRANCH
    + ".\n"
    + RESULT_FILES
    + "\n"
    + CONTEXT_FILES
    + "\n"
    + "Template discovery, structure, title/language conventions per your role\n"
    + "definition.\n"
    + "Write the complete PR/MR body to this absolute file using Bash redirection\n"
    + "(a `cat > \"<path>\" <<'EOF' … EOF` heredoc — "
    + WRITE_VIA_BASH_NOT_WRITE_EDIT
    + "): "
    + PR_BODY_PATH
    + "\n"
    + "Return the title inline and bodyPath set to exactly that path (do not return\n"
    + "the body text). Structured output only.",
  prOpts,
);
if (prText === null && filesOk) {
  prText = await agent(
    "Retry. Write the PR/MR title and body for branch "
      + BRANCH_NAME
      + " → "
      + BASE_BRANCH
      + " per your role definition.\n"
      + RESULT_FILES
      + "\n"
      + CONTEXT_FILES
      + "\nWrite the body to "
      + PR_BODY_PATH
      + " via Bash redirection (heredoc — "
      + WRITE_VIA_BASH_NOT_WRITE_EDIT
      + "), then return bodyPath = that path with the title inline.",
    { ...prOpts, label: "pr-author:retry" },
  );
}

if (!prText) {
  ship = { status: "blocked", detail: filesOk ? "pr-author returned null twice" : "implement/review result file missing or empty" + (filesCheck && filesCheck.detail ? ": " + filesCheck.detail : "") };
} else {
  const created = await agent(
    "Ship branch "
      + BRANCH_NAME
      + " to base "
      + BASE_BRANCH
      + " (procedure, platform\n"
      + "detection, create-or-update, mergeability check, and hard limits per your role definition).\n"
      + "PR/MR title: "
      + prText.title
      + "\n"
      + "PR/MR body file (absolute path, already written): "
      + prText.bodyPath
      + "\n"
      + "Mergeability script (absolute path): "
      + (PLUGIN_ROOT ? PLUGIN_ROOT + "/bin/ship-ensure-mergeable.mjs" : "(none — skip the mergeability step and report mergeState 'unknown')")
      + "\n"
      + "Structured output only.",
    { label: "ship", phase: "Ship", schema: SHIP_RESULT, model: MODELS.shipper, agentType: "taskflow:shipper" },
  );
  if (!created || created.status === "blocked") {
    ship = { status: "blocked", detail: created ? created.detail : "shipper returned null" };
  } else {
    ship = { status: "shipped", url: created.url, platform: created.platform, prAction: created.status, mergeState: created.mergeState, ci: { status: "unknown", monitorRounds: 0, fixRounds: 0 } };
    let rerunTried = false;
    for (let round = 1; round <= MAX_CI_MONITOR_ROUNDS; round++) {
      ship.ci.monitorRounds = round;
      const ci = await agent(
        "Watch CI for branch "
          + BRANCH_NAME
          + " (platform: "
          + created.platform
          + ", PR/MR: "
          + created.url
          + ").\n"
          + "Bounded wait, classification, and failing-log collection per your role\n"
          + "definition."
          + jevHint
          + " Structured output only.",
        { label: "ci-monitor:" + round, phase: "Ship", schema: CI_RESULT, model: MODELS.ciMonitor, agentType: "taskflow:ci-monitor" },
      );
      if (!ci) {
        delete ship.ci.failedJobs; // superseded by a fix pushed after the last watch
        break;
      }
      ship.ci.status = ci.status;
      if (ci.status === "failed" && ci.failedJobs && ci.failedJobs.length) ship.ci.failedJobs = ci.failedJobs;
      else delete ship.ci.failedJobs;
      if (ci.status === "passed" || ci.status === "none") break;
      if (ci.status === "running") continue;
      // failed:
      if (ship.ci.fixRounds >= MAX_CI_FIX_ROUNDS) break;
      ship.ci.fixRounds++;
      const fix = await agent(
        "CI is red for branch "
          + BRANCH_NAME
          + " (platform: "
          + created.platform
          + ", PR/MR: "
          + created.url
          + ").\n"
          + (rerunTried ? "A rerun was ALREADY tried for this failure — treat flaky-looking failures as code-caused now.\n" : "")
          + "Failing jobs with log excerpts:\n"
          + JSON.stringify(ci.failedJobs || [])
          + "\n"
          + "Classification, fix scope, and hard limits per your role definition.\n"
          + jevHint
          + gmHint("to find the failing code and its callers", JSON.stringify(REPO))
          + "\nStructured output only.",
        { label: "ci-fix:" + ship.ci.fixRounds, phase: "Ship", schema: CI_FIX_RESULT, model: MODELS.ciFixer, agentType: "taskflow:ci-fixer" },
      );
      if (!fix || fix.status === "blocked") {
        ship.ci.fixDetail = fix ? fix.detail : "ci-fixer returned null";
        break;
      }
      if (fix.status === "rerun") rerunTried = true;
      // The fix/rerun has not been watched yet: never report the superseded red run as current.
      ship.ci.status = "running";
      delete ship.ci.failedJobs;
      // 'done' (commit pushed) or 'rerun' → keep watching
    }
    if (ship.ci.status === "failed") ship.status = "ci_failed";
    else if (ship.ci.status === "running") ship.status = "ci_timeout";
    else if (ship.ci.status === "unknown") ship.status = "ci_unknown";
    log("Ship: " + ship.status + " (" + (ship.url || "-") + ", CI " + ship.ci.status + " after " + ship.ci.monitorRounds + " monitor / " + ship.ci.fixRounds + " fix round(s))");
  }
}

// ship: {status: blocked|shipped|ci_failed|ci_timeout|ci_unknown, url?, platform?, prAction?, mergeState?, ci?, detail?}
return { status: "complete", ship };
