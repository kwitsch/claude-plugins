// ─────────────────────────────────────────────────────────────────────────────
// build-task-review.workflow.js — build-task delivery pipeline, phase 3 of 4
//
//   Scope → finders (correctness angles + cleanup lenses) → independent
//   verification → optional gap sweep → synthesis → report-only lean pass →
//   fix application → persist the result file
//
// Reviews the accumulated branch diff (git diff BASE_BRANCH...HEAD) against
// the approved spec and the plan, applies the verified findings through the
// fix-applier plugin agent and writes the full result to REVIEW_PATH (read
// later by the pr-author of build-task-ship.workflow.js). Findings with reversesDecision
// are NEVER applied, only returned as escalatedToUser (no AskUserQuestion is
// possible inside a workflow script). The lean (ponytail) pass is report-only.
// The review engine is duplicated in the plugin's changes-review.workflow.js
// on purpose: Workflow scripts cannot import each other.
//
// Exits:
//   'complete' — { status, reviewPath, level, summary, stats, findingCount,
//                  applied, escalatedToUser, ponytailReview }
//   'error'    — { status, stage: 'args' | 'Review', error }; when only the
//                result file could not be written the error additionally
//                carries level, applied, escalatedToUser and ponytailReview
//                (the fixes are already committed).
//
// Args: { SPEC_PATH, PLAN_PATH, REVIEW_PATH, BRANCH_NAME, BASE_BRANCH?, LEVEL? }
//   SPEC_PATH   — absolute path of the approved spec file
//   PLAN_PATH   — absolute path of the plan file
//   REVIEW_PATH — absolute path of the JSON result file this script writes
//   BRANCH_NAME — current work branch (`git branch --show-current`)
//   BASE_BRANCH — branch the work branch was cut from (default 'main')
//   LEVEL       — 'high' (default) | 'max'; review depth, chosen by build-task
//                 from its SIZE — this script never derives it.
//
// Invocation contract:
//   - PRIMARY: the plugin workflow `build-task-review` (by name, namespaced by the plugin, args)
//     with ONE JSON object as args — the script reads it as the global `args`.
//   - FALLBACK (decodeArgs reports "args global is undefined"): prepend
//     EXACTLY ONE line right after the meta block: `const args = { … }`
//     (JSON literal) and submit the text via `script` without the tool-level
//     `args` parameter.
//   - No clock reads, randomness or FS in the script.
//   - Preconditions: work branch checked out, `git status --porcelain` empty.
//   - The taskflow plugin must be loaded: finder, verifier and fix application
//     are plugin agents (AGENTS below); an unknown type throws at dispatch.
// ─────────────────────────────────────────────────────────────────────────────

export const meta = {
  name: "build-task-review",
  description: "Combined review over the branch diff (correctness angles + cleanup lenses, verified, plus a report-only lean pass) → fix application → result file",
  phases: [
    { title: "Review", detail: "Correctness angles + cleanup lenses over the combined diff" },
    { title: "Apply", detail: "Apply verified findings, commit by category" },
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
const A = decodeArgs(["SPEC_PATH", "PLAN_PATH", "REVIEW_PATH", "BRANCH_NAME"], { BASE_BRANCH: "main", LEVEL: "high" });
if (A.__error) return { status: "error", stage: "args", error: A.__error };
const { SPEC_PATH, PLAN_PATH, REVIEW_PATH, BRANCH_NAME, LEVEL } = A;
const BASE_BRANCH = A.BASE_BRANCH || "main"; // empty/null counts as missing
for (const [k, v] of [["SPEC_PATH", SPEC_PATH], ["PLAN_PATH", PLAN_PATH], ["REVIEW_PATH", REVIEW_PATH]]) {
  if (typeof v !== "string" || !v.startsWith("/")) return { status: "error", stage: "args", error: k + " must be an absolute path" };
}
if (LEVEL !== "high" && LEVEL !== "max") return { status: "error", stage: "args", error: "LEVEL must be \"high\" or \"max\"" };

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
  scope: "haiku", // list diff, collect CLAUDE.md
  finder: "sonnet", // review finder (angles + lenses)
  verifier: "sonnet", // independent per-finding verification
  synthesizer: "opus", // ranking, dedupe, reversesDecision judgment
  applier: "sonnet", // apply pre-verified fixes — test gate as safety net
  ponytailReviewer: "sonnet", // over-engineering-only pass over the combined diff (report-only)
  scribe: "haiku", // writes the result file byte for byte
};
// ── Plugin agent types (namespace = plugin name; keep in sync on plugin
//    rename). An unknown type throws hard at dispatch, so this script needs
//    the installed taskflow plugin agents; the static role prompts live there.
const AGENTS = {
  finder: "taskflow:review-finder",
  verifier: "taskflow:review-verifier",
  applier: "taskflow:fix-applier",
};

// Prepended to every inline prompt below that has no `agentType` (so no
// plugin agents/*.md system prompt already carries this rule): these agents
// run headless inside a Workflow, so any prose between tool calls is wasted
// tokens no one reads.
const NO_NARRATION = "No narrative text between tool calls — call tools silently and speak only in your final message (the report or structured output). Write that final message in English, whatever the language of the task or its inputs; commit messages are not covered.";

// Shared tail for the scribe prompt: the universal-format hook reformats
// anything written through Write/Edit, so content that must reach disk byte
// for byte cannot go through them.
const WRITE_VIA_BASH_NOT_WRITE_EDIT = "NEVER the Write or Edit tool; the universal-format hook reformats those";

// ── Schemas ──────────────────────────────────────────────────────────────────
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
          reversesDecision: { type: "boolean", description: "true only when applying the fix would reverse a decision of the approved spec; such findings are never auto-applied" },
        },
      },
    },
  },
};
const PONYTAIL_REVIEW_SCHEMA = {
  type: "object",
  required: ["findings", "verdict"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["file", "tag", "what", "replacement"],
        properties: {
          file: { type: "string" },
          line: { type: "number" },
          tag: { enum: ["delete", "stdlib", "native", "yagni", "shrink"] },
          what: { type: "string" }, // what to cut
          replacement: { type: "string" }, // what replaces it (or "" for delete)
        },
      },
    },
    verdict: { type: "string" }, // "net: -<N> lines possible." OR "Lean already. Ship."
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
const WRITE_RESULT = {
  type: "object",
  required: ["status"],
  properties: { status: { enum: ["written", "blocked"] }, detail: { type: "string" }, bytes: { type: "integer" } },
};

// ═════════════════════════════════════════════════════════════════════════════
// REVIEW  (combined review over the accumulated branch diff)
// ═════════════════════════════════════════════════════════════════════════════
phase("Review");

// Review depth is an input: build-task maps its SIZE to LEVEL.
const DIFF_CMD = "git diff " + BASE_BRANCH + "...HEAD";
const P = LEVEL === "max" ? { correctnessAngles: 5, perAngle: 8, maxFindings: 15, sweep: true } : { correctnessAngles: 3, perAngle: 6, maxFindings: 10, sweep: false };
const SWEEP_MAX = 8;
const PONYTAIL_MAX = 8;

// ── Lens catalog, verdict ladder & sweep focus live in the plugin agents
//    'review-finder' and 'review-verifier'; only the labels stay here. ──
const CORRECTNESS_LABELS = ["angle-A", "angle-B", "angle-C", "angle-D", "angle-E"];
const CLEANUP_LABELS = ["cleanup:reuse", "cleanup:simplification", "cleanup:efficiency", "cleanup:altitude", "cleanup:conventions"];

// ── Scope ──
const scope = await agent(
  NO_NARRATION
    + "\n\n"
    + "Establish the scope of a code review of the current branch's accumulated diff.\n\n"
    + "Run this exact diff command: "
    + DIFF_CMD
    + "\n\n"
    + "0. First confirm `git status --porcelain` is empty — stray working-tree state\n"
    + "   means Implement did not finish cleanly; report it instead of reviewing.\n"
    + "1. Confirm the diff command produces a non-empty diff.\n"
    + "2. List the changed files (repo-relative).\n"
    + "3. Summarize what changed in one paragraph.\n"
    + "4. List the CLAUDE.md files that apply to the changed files (user-level,\n"
    + "   repo-root, plus any CLAUDE.md/CLAUDE.local.md in an ancestor directory of\n"
    + "   a changed file). Read each one that exists and note conventions a reviewer\n"
    + "   should know.\n\nStructured output only.",
  { label: "scope", phase: "Review", schema: SCOPE_SCHEMA, model: MODELS.scope },
);
if (!scope) return { status: "error", stage: "Review", error: "scope agent returned no result" };
if (!scope.files || scope.files.length === 0) {
  return { status: "error", stage: "Review", error: "no changes found to review — unexpected after a merged implement phase" };
}
log(LEVEL + " review: " + scope.files.length + " changed files");

const claudeMdFiles = scope.claudeMdFiles || [];
const SCOPE_BLOCK = "## Review scope\n"
  + "Diff command: "
  + DIFF_CMD
  + "\n"
  + "Changed files ("
  + scope.files.length
  + "):\n"
  + scope.files.map((f) => "  - " + f).join("\n")
  + "\n"
  + "Applicable CLAUDE.md files ("
  + claudeMdFiles.length
  + "):\n"
  + (claudeMdFiles.length > 0 ? claudeMdFiles.map((f) => "  - " + f).join("\n") : "  (none)")
  + "\n\n"
  + "## What changed\n"
  + scope.summary
  + "\n\n"
  + "## Conventions\n"
  + (scope.conventions || "(none noted)")
  + "\n";

// ── Lean review (ponytail): over-engineering ONLY, report-only, not applied,
//    not escalated. Kicked off now (only SCOPE_BLOCK/SPEC_PATH needed) so its
//    latency overlaps the finder/verify/sweep/synthesis pipeline below
//    instead of serializing after it. Its raw claims are independently
//    checked through the same group-verifier step as every other candidate,
//    and deduped against the combined review's surviving findings, before
//    being awaited/used below (see ponytailReview assembly). ──
const ponytailReviewPrompt = NO_NARRATION
  + "\n\n## Lean review — over-engineering only\n\n"
  + SCOPE_BLOCK
  + "\n"
  + "Run the diff command above and review the CHANGE for over-engineering ONLY.\n"
  + "Correctness bugs, security holes, and performance are OUT of scope — the\n"
  + "combined review already covered those; do NOT re-report them here.\n\n"
  + "The reuse ladder, in order: (1) is this piece needed at all; (2) a helper/\n"
  + "util/type/pattern already in this codebase; (3) the stdlib; (4) a native\n"
  + "platform feature; (5) an already-installed dependency — before any new code.\n"
  + "Flag: reinvented stdlib, a dependency doing what the platform does, an\n"
  + "abstraction/config/layer with one caller, dead flexibility, or code that\n"
  + "could be shorter.\n\n"
  + "The spec ("
  + SPEC_PATH
  + ") is USER-APPROVED: review HOW the change was\n"
  + "built, never WHETHER an approved feature should exist — do not propose\n"
  + "deleting spec-required functionality. Never flag input validation at trust\n"
  + "boundaries, error handling that prevents data loss, security, accessibility,\n"
  + "or a single smoke/assert self-check.\n\n"
  + "One finding per object: {file, line?, tag, what, replacement}. Tags: delete\n"
  + "(dead/speculative code, replacement \"\"), stdlib, native, yagni (one-caller\n"
  + "abstraction/config), shrink (same logic, fewer lines). verdict: \"net: -<N>\n"
  + "lines possible.\" or, if nothing to cut, \"Lean already. Ship.\"\n\n"
  + "Structured output only.";

const ponyOpts = {
  label: "lean-review",
  phase: "Review",
  schema: PONYTAIL_REVIEW_SCHEMA,
  model: MODELS.ponytailReviewer,
};
const ponytailPromise = Promise.resolve(agent(ponytailReviewPrompt, ponyOpts)).catch(() => null); // a throw degrades to the null-retry path

const FINDER_PROMPT = (f) =>
  "## Review finder — assigned lens: "
  + f.label
  + "\n\n"
  + SCOPE_BLOCK
  + "\n"
  + "Run the diff command above and review ONLY through your assigned lens; the\n"
  + "full lens catalog, candidate rules, and cleanup precedence are in your\n"
  + "agent definition. Candidate cap for this run: "
  + f.cap
  + ".\n\n"
  + "Structured output only.";

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
  "## Review verifier\n\n"
  + SCOPE_BLOCK
  + "\n"
  + "## Candidate findings at "
  + loc(group[0])
  + "\n"
  + group.map((c, i) => "[" + i + "] Summary: " + c.summary + "\n    Failure scenario: " + c.failure_scenario).join("\n")
  + "\n\n"
  + "Run the diff command above, read the relevant file(s), and return one\n"
  + "verdict per candidate by its [i] index — verdict ladder and recall rules\n"
  + "per your agent definition. Structured output only.";

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
    "## Review finder — assigned lens: sweep\n\n"
      + SCOPE_BLOCK
      + "\n"
      + "## Already-found candidates (do NOT re-derive or re-confirm these)\n"
      + knownBlock
      + "\n\n"
      + "Gap focus and rules per your agent definition. Candidate cap for this\n"
      + "run: "
      + SWEEP_MAX
      + ". If nothing new, return an empty list — do not pad.\n\n"
      + "Structured output only.",
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

let findings = [];
let reviewSummary = "No findings survived verification.";
if (surviving.length > 0) {
  const rank = (c) => (c.kind === "cleanup" ? 2 : 0) + (c.verdict === "PLAUSIBLE" ? 1 : 0);
  const ranked = surviving.slice().sort((a, b) => rank(a) - rank(b));
  const block = ranked
    .map(
      (c, i) =>
        "### ["
        + i
        + "] "
        + loc(c)
        + " ("
        + c.verdict
        + (c.kind === "cleanup" ? ", cleanup" : "")
        + ")\n"
        + c.summary
        + "\nFailure scenario: "
        + c.failure_scenario
        + "\nVerifier evidence: "
        + c.evidence
        + "\n",
    )
    .join("\n");

  const report = await agent(
    NO_NARRATION
      + "\n\n"
      + "## Synthesis: final review report\n\n"
      + ranked.length
      + " findings survived independent verification ("
      + LEVEL
      + "-effort review). "
      + "They are numbered [0]-["
      + (ranked.length - 1)
      + "] below.\n\n"
      + block
      + "\n"
      + "## Design/plan context\nRead these files before deciding: "
      + SPEC_PATH
      + ", "
      + PLAN_PATH
      + "\n"
      + "For each decision, set reversesDecision: true when applying the finding's fix would "
      + "reverse a decision those documents record (an approach, interface, or scope choice) "
      + "rather than merely polishing its execution. The spec is USER-APPROVED — anything "
      + "reversing it must never be auto-applied. Default false.\n\n"
      + "## Instructions\n"
      + "Return decisions about findings BY INDEX — never re-emit finding text.\n"
      + "1. One decision per distinct defect; fold same-root-cause findings into its merge array.\n"
      + "2. Order decisions most-severe first. Correctness bugs always outrank cleanup findings.\n"
      + "3. Keep at most "
      + P.maxFindings
      + " decisions; omit the least severe beyond the cap.\n"
      + "4. Set reversesDecision per the design/plan context above.\n"
      + "5. Write a 2-3 sentence summary of the review.\n\nStructured output only.",
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
  reviewSummary = usedDecisions && report
    ? report.summary + (backfilled > 0 ? " (" + backfilled + " additional verified finding" + (backfilled === 1 ? "" : "s") + " appended unmerged.)" : "")
    : "Synthesis skipped or unusable — verified findings returned ranked, unmerged.";
}

// ── Lean review (ponytail) result: kicked off right after SCOPE_BLOCK was
//    built (above), overlapping its latency with the finder/verify/sweep/
//    synthesis pipeline; awaited here where the result is actually used. ──
let ponytail = await ponytailPromise;
if (ponytail === null) {
  ponytail = await agent(ponytailReviewPrompt, {
    ...ponyOpts,
    label: "lean-review:retry",
  });
}
const ponytailRaw = ponytail && Array.isArray(ponytail.findings) ? ponytail.findings : [];

// Every raw claim goes through the same group verifier as every other review
// candidate — no single-pass claim reaches the PR unchecked — then anything
// at a location the combined review already covers is dropped, so the PR
// never shows an unverified claim contradicting a verified one at the same spot.
const ponytailCandidates = ingest(
  ponytailRaw.map((f) => ({
    ...f,
    summary: "[" + f.tag + "] " + f.what + (f.replacement ? " -> " + f.replacement : ""),
    failure_scenario: "Lean-review over-engineering claim — confirm the code is genuinely unused/replaceable as described.",
  })),
  PONYTAIL_MAX,
  "ponytail",
);
const ponytailVerified = ponytailCandidates.length > 0 ? await verifyGroups(ponytailCandidates) : [];
const combinedLocs = new Set(surviving.map(loc));
const ponytailFindings = ponytailVerified
  .filter((c) => c.verdict !== "REFUTED" && !combinedLocs.has(loc(c)))
  .map((c) => ({ file: c.file, line: c.line, tag: c.tag, what: c.what, replacement: c.replacement }));
const ponytailReview = { findings: ponytailFindings, verdict: ponytail ? ponytail.verdict || "" : "not run" };
log("Lean review: " + ponytailRaw.length + " raw → " + ponytailFindings.length + " verified & non-duplicate over-engineering finding(s) — " + (ponytailReview.verdict || "n/a"));

// Built here (not right after the main verify pass) so verifierAgents also
// counts the lean-review pass's own verifyGroups(ponytailCandidates) call above.
const reviewStats = { level: LEVEL, finders: FINDERS.length, candidates: candidatesSeen, verifierAgents, verified: verified.length, refuted: refuted.length };

// ═════════════════════════════════════════════════════════════════════════════
// APPLY  (apply fixes; NEVER apply reversesDecision)
// ═════════════════════════════════════════════════════════════════════════════
phase("Apply");

const escalated = findings.filter((f) => f.reversesDecision);
const applicable = findings.filter((f) => !f.reversesDecision);
let applyReport = { applied: [], skipped: [], commits: [] };

if (applicable.length > 0) {
  const numbered = applicable.map((f, i) => ({ index: i, ...f }));
  const applier = await agent(
    "Fix-application run.\n"
      + "Work branch: "
      + BRANCH_NAME
      + "\n"
      + "Approved spec (skip-rule reference): "
      + SPEC_PATH
      + "\n"
      + "Findings to apply, numbered, most-severe first:\n"
      + JSON.stringify(numbered)
      + "\n"
      + "Locate-by-content, skip rule, commit-by-category, and test gate per your\n"
      + "agent definition. Return through the structured output schema: applied\n"
      + "indexes, skipped {index, reason}, and the commit hash(es)."
      + gmHint("to locate the symbols the findings point at", JSON.stringify(REPO)),
    { label: "apply-fixes", phase: "Apply", schema: APPLY_RESULT, model: MODELS.applier, agentType: AGENTS.applier },
  );
  if (applier) applyReport = applier;
  else applyReport = { applied: [], skipped: numbered.map((f) => ({ index: f.index, reason: "applier returned null" })), commits: [] };
}

log("Apply: " + applyReport.applied.length + " applied, " + applyReport.skipped.length + " skipped, " + escalated.length + " escalated (spec-reversing, not applied)");

// ── Persist the result (read later by the pr-author of the ship script) ─────
// The text reaches disk through a Bash heredoc, then its reported size must
// equal the expected UTF-8 byte count (or that plus the heredoc's newline):
// a truncated JSON file would break the pr-author's read, so no tolerance here.
async function persist(path, obj) {
  const text = JSON.stringify(obj, null, 2);
  const expectedBytes = encodeURIComponent(text).replace(/%[0-9A-F]{2}/g, "x").length;
  const prompt = `${NO_NARRATION}\n\nWrite the text between the BEGIN/END markers below to ${path} (create/overwrite), byte for byte — no edits, no summary, markers excluded — with a Bash heredoc: \`cat > "${path}" <<'TASKFLOW_JSON_EOF'\`, then the text, then a line holding only TASKFLOW_JSON_EOF (${WRITE_VIA_BASH_NOT_WRITE_EDIT}). Then run \`wc -c < "${path}"\` and return structured output: status "written" plus bytes (that number), or "blocked" + detail if the write failed.\n<<<BEGIN>>>\n${text}\n<<<END>>>`;
  const isIntact = (w) => w && w.status === "written" && (w.bytes === expectedBytes || w.bytes === expectedBytes + 1);
  const opts = { label: "persist", phase: "Apply", schema: WRITE_RESULT, model: MODELS.scribe };
  let written = await agent(prompt, opts);
  if (!isIntact(written)) written = await agent(prompt, { ...opts, label: "persist:retry" });
  return !!isIntact(written);
}

// `findings` keeps reversesDecision on each entry; applied.applied and
// applied.skipped[].index index into findings.filter((f) => !f.reversesDecision).
const persisted = await persist(REVIEW_PATH, {
  level: LEVEL,
  summary: reviewSummary,
  stats: reviewStats,
  findings,
  refuted: refuted.map((c) => ({ file: c.file, line: c.line, summary: c.summary })),
  ponytailReview,
  applied: applyReport,
  escalated,
});
if (!persisted) {
  return { status: "error", stage: "Review", error: "could not write REVIEW_PATH", level: LEVEL, applied: applyReport, escalatedToUser: escalated, ponytailReview };
}
log("Exit: review result written to " + REVIEW_PATH);
return {
  status: "complete",
  reviewPath: REVIEW_PATH,
  level: LEVEL,
  summary: reviewSummary,
  stats: reviewStats,
  findingCount: findings.length,
  applied: applyReport,
  escalatedToUser: escalated, // reversesDecision → the human decides after the script ends
  ponytailReview, // {findings:[{file,line?,tag,what,replacement}], verdict} — verified + deduped, report-only, NOT applied
};
