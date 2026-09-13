// ─────────────────────────────────────────────────────────────────────────────
// changes-review.workflow.js
//
// Standalone combined review over a branch diff. A leaner, self-contained copy
// of spec-driven-delivery.workflow.js's Review phase: correctness angles +
// cleanup lenses over the diff, each finding independently verified, plus a
// report-only lean (ponytail) pass. No plan, no spec, no apply, no ship.
//
// Duplication is deliberate and precedented: the Workflow runtime forbids one
// *.workflow.js importing or calling another (no import/require; only
// agent()/parallel()/phase()/log()), so the review engine cannot be shared — it
// is copied here the same way skills/dispatch-task forks its dispatch mechanics
// and NO_NARRATION is copied across every workflow and agent file. This copy is
// intentionally smaller than the phase it mirrors: no spec-path or plan-path
// plumbing, no reversesDecision/escalation, no Apply phase (the changes-audit
// skill owns apply by re-dispatching fix-applier).
//
// Invocation contract (from the changes-audit skill):
//   - PRIMARY: invoke as a plugin workflow by name and pass inputs via the
//     `args` parameter — the script reads them as the global `args`. Plugin
//     workflows run namespaced: /<plugin>:changes-review.
//   - FALLBACK (ad-hoc `script` submission): prepend the script text with
//     EXACTLY ONE line right after the meta block: `const args = { … }` (JSON
//     literal). NEVER rely on the `args` parameter of an ad-hoc {script, args}
//     call — the global arrives as `undefined` there.
//   - No Date.now()/Math.random()/Node API; no filesystem — everything
//     file-related runs through agent() workers.
//   - Preconditions: work branch checked out, `git status --porcelain` empty
//     (the scope agent asserts this itself), committed changes to review
//     against BASE_BRANCH.
// ─────────────────────────────────────────────────────────────────────────────

export const meta = {
  name: "changes-review",
  description: "Standalone combined review over a branch diff — correctness angles + cleanup lenses, independently verified, plus a report-only lean pass. No plan/spec/ship.",
  phases: [
    {
      title: "Review",
      detail: "Correctness angles + cleanup lenses over the branch diff, independently verified",
    },
  ],
};

// ── Inputs via the `args` global (decoder with fail-fast guard) ─────────────
// Expected: { BASE_BRANCH?, LEVEL? }
//   BASE_BRANCH — branch to diff against (default 'main'); drives
//                 `git diff <base>...HEAD`.
//   LEVEL       — optional "high"|"max" override; empty → auto-derive from the
//                 changed-file count after scope.
function decodeArgs(required, defaults) {
  let a = typeof args === "undefined" ? null : args;
  // The runtime delivers args as a JSON STRING instead of an object depending
  // on the invocation path — parse tolerantly, including double-encoded; only
  // genuinely unusable input fails hard.
  for (let i = 0; typeof a === "string" && i < 2; i++) {
    try {
      a = JSON.parse(a);
    } catch (e) {
      return {
        __error: 'args arrived as a non-JSON string ("' + a.slice(0, 120) + '") — pass ONE JSON object with keys: ' + required.join(", "),
      };
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
  if (missing.length)
    return {
      __error: "missing required args: " + missing.join(", ") + " (got keys: " + Object.keys(a).join(", ") + ")",
    };
  return { ...defaults, ...a };
}
const A = decodeArgs([], { BASE_BRANCH: "main", LEVEL: "" });
if (A.__error) return { stage: "args", error: A.__error };
const { BASE_BRANCH } = A;

// ── Model assignment ─────────────────────────────────────────────────────────
// Bare aliases except the pinned Opus tier — see plugins/taskflow/CLAUDE.md
// "Model assignment". Only the Review-phase roles are needed here; fix-applier
// is NOT dispatched from this script (the changes-audit skill owns apply), so
// there is no applier entry.
const PINNED_OPUS = "claude-opus-4-8"; // single source for every Opus-tier pin in this file
const MODELS = {
  scope: "haiku", // list diff, collect CLAUDE.md
  finder: "sonnet", // review finder (angles + lenses)
  verifier: "sonnet", // independent per-finding verification
  synthesizer: PINNED_OPUS, // ranking, dedupe (pinned) — see CLAUDE.md Opus-pin list
  ponytailReviewer: "sonnet", // over-engineering-only pass over the diff (report-only)
};
// Plugin agent types (namespace = plugin name; keep in sync on plugin rename).
const AGENTS = {
  finder: "taskflow:review-finder",
  verifier: "taskflow:review-verifier",
};

// Prepended to every inline prompt below that has no `agentType` (so no plugin
// agents/*.md system prompt already carries this rule) — identical wording to
// every agents/*.md file and to spec-driven-delivery.workflow.js: these agents
// run headless inside a Workflow, so any prose between tool calls is wasted
// tokens no one reads.
const NO_NARRATION = "No narrative text between tool calls — call tools silently and speak only in your final message (the report or structured output).";

// ── Schemas (duplicated verbatim from spec-driven-delivery.workflow.js) ───────
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

// ═════════════════════════════════════════════════════════════════════════════
// REVIEW — combined review over the branch diff (no plan/spec/apply/ship)
// ═════════════════════════════════════════════════════════════════════════════
phase("Review");

const DIFF_CMD = "git diff " + BASE_BRANCH + "...HEAD";

// ── Lens catalog labels live in the plugin agents 'review-finder' and
//    'review-verifier'; only the labels stay here. ──
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
    "   means there are uncommitted changes; report it instead of reviewing.\n" +
    "1. Confirm the diff command produces a non-empty diff.\n" +
    "2. List the changed files (repo-relative).\n" +
    "3. Summarize what changed in one paragraph.\n" +
    "4. List the CLAUDE.md files that apply to the changed files (user-level,\n" +
    "   repo-root, plus any CLAUDE.md/CLAUDE.local.md in an ancestor directory of\n" +
    "   a changed file). Read each one that exists and note conventions a reviewer\n" +
    "   should know.\n\nStructured output only.",
  {
    label: "scope",
    phase: "Review",
    schema: SCOPE_SCHEMA,
    model: MODELS.scope,
  },
);
if (!scope) return { stage: "Review", error: "scope agent returned no result" };
if (!scope.files || scope.files.length === 0) {
  return {
    stage: "Review",
    error: "no changes found to review — clean diff against " + BASE_BRANCH,
  };
}

// ── Derive review depth AFTER scope: changed-file count substitutes for the
//    plan's task array the delivery pipeline uses. P is first read only at
//    finder construction below, so deriving it here is behavior-neutral. ──
const LEVEL = A.LEVEL === "high" || A.LEVEL === "max" ? A.LEVEL : scope.files.length > 4 ? "max" : "high";
const P = LEVEL === "max" ? { correctnessAngles: 5, perAngle: 8, maxFindings: 15, sweep: true } : { correctnessAngles: 3, perAngle: 6, maxFindings: 10, sweep: false };
const SWEEP_MAX = 8;
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

// ── Lean review (ponytail): over-engineering ONLY, report-only, not applied.
//    Kicked off now so its latency overlaps the finder/verify/sweep/synthesis
//    pipeline below. Its raw claims are independently checked through the same
//    group-verifier step as every other candidate, and deduped against the
//    combined review's surviving findings, before being awaited/used below.
//    Unlike spec-driven-delivery this prompt has no USER-APPROVED-spec
//    paragraph — a bare audit has no spec. ──
const ponytailReviewPrompt =
  NO_NARRATION +
  "\n\n## Lean review — over-engineering only\n\n" +
  SCOPE_BLOCK +
  "\n" +
  "Run the diff command above and review the CHANGE for over-engineering ONLY.\n" +
  "Correctness bugs, security holes, and performance are OUT of scope — the\n" +
  "combined review already covered those; do NOT re-report them here.\n\n" +
  "The reuse ladder, in order: (1) is this piece needed at all; (2) a helper/\n" +
  "util/type/pattern already in this codebase; (3) the stdlib; (4) a native\n" +
  "platform feature; (5) an already-installed dependency — before any new code.\n" +
  "Flag: reinvented stdlib, a dependency doing what the platform does, an\n" +
  "abstraction/config/layer with one caller, dead flexibility, or code that\n" +
  "could be shorter.\n\n" +
  "Review HOW the change was built, never propose deleting requested\n" +
  "functionality. Never flag input validation at trust boundaries, error\n" +
  "handling that prevents data loss, security, accessibility, or a single\n" +
  "smoke/assert self-check.\n\n" +
  "One finding per object: {file, line?, tag, what, replacement}. Tags: delete\n" +
  '(dead/speculative code, replacement ""), stdlib, native, yagni (one-caller\n' +
  'abstraction/config), shrink (same logic, fewer lines). verdict: "net: -<N>\n' +
  'lines possible." or, if nothing to cut, "Lean already. Ship."\n\n' +
  "Structured output only.";

const ponyOpts = {
  label: "lean-review",
  phase: "Review",
  schema: PONYTAIL_REVIEW_SCHEMA,
  model: MODELS.ponytailReviewer,
};
const ponytailPromise = agent(ponytailReviewPrompt, ponyOpts);

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
  .concat(
    CLEANUP_LABELS.map((label) => ({
      label,
      kind: "cleanup",
      cap: P.perAngle,
    })),
  );

const finderOuts = await parallel(
  FINDERS.map(
    (f) => () =>
      agent(FINDER_PROMPT(f), {
        label: f.label,
        phase: "Review",
        schema: CANDIDATES_SCHEMA,
        model: MODELS.finder,
        agentType: AGENTS.finder,
      }).then((r) => {
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
    {
      label: "sweep",
      phase: "Review",
      schema: CANDIDATES_SCHEMA,
      model: MODELS.finder,
      agentType: AGENTS.finder,
    },
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
const reviewStats = {
  level: LEVEL,
  finders: FINDERS.length,
  candidates: candidatesSeen,
  verifierAgents,
  verified: verified.length,
  refuted: refuted.length,
};

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
      "## Instructions\n" +
      "Return decisions about findings BY INDEX — never re-emit finding text.\n" +
      "1. One decision per distinct defect; fold same-root-cause findings into its merge array.\n" +
      "2. Order decisions most-severe first. Correctness bugs always outrank cleanup findings.\n" +
      "3. Keep at most " +
      P.maxFindings +
      " decisions; omit the least severe beyond the cap.\n" +
      "4. Write a 2-3 sentence summary of the review.\n\nStructured output only.",
    {
      label: "synthesize",
      phase: "Review",
      schema: REPORT_SCHEMA,
      model: MODELS.synthesizer,
    },
  );

  // Assembler invariants: no silent drop while there is still room. A bare
  // audit has no spec to reverse, so findings carry no reversesDecision.
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
    findings.push({
      file: c.file,
      line: c.line,
      summary: c.summary + also,
      failure_scenario: c.failure_scenario,
      category: c.kind,
      verdict,
    });
  }
  const usedDecisions = findings.length > 0;
  let backfilled = 0;
  for (let i = 0; i < ranked.length && findings.length < P.maxFindings; i++) {
    if (seen.has(i)) continue;
    const c = ranked[i];
    findings.push({
      file: c.file,
      line: c.line,
      summary: c.summary,
      failure_scenario: c.failure_scenario,
      category: c.kind,
      verdict: c.verdict,
    });
    backfilled++;
  }
  reviewSummary =
    usedDecisions && report
      ? report.summary + (backfilled > 0 ? " (" + backfilled + " additional verified finding" + (backfilled === 1 ? "" : "s") + " appended unmerged.)" : "")
      : "Synthesis skipped or unusable — verified findings returned ranked, unmerged.";
}

// ── Lean review (ponytail) result: awaited here where it is used; every raw
//    claim goes through the same group verifier as every other candidate, then
//    anything at a location the combined review already covers is dropped. ──
let ponytail = await ponytailPromise;
if (ponytail === null)
  ponytail = await agent(ponytailReviewPrompt, {
    ...ponyOpts,
    label: "lean-review:retry",
  });
const ponytailRaw = ponytail && Array.isArray(ponytail.findings) ? ponytail.findings : [];
const ponytailCandidates = ingest(
  ponytailRaw.map((f) => ({
    ...f,
    summary: "[" + f.tag + "] " + f.what + (f.replacement ? " -> " + f.replacement : ""),
    failure_scenario: "Lean-review over-engineering claim — confirm the code is genuinely unused/replaceable as described.",
  })),
  ponytailRaw.length,
  "ponytail",
);
const ponytailVerified = ponytailCandidates.length > 0 ? await verifyGroups(ponytailCandidates) : [];
const combinedLocs = new Set(findings.map(loc));
const ponytailFindings = ponytailVerified
  .filter((c) => c.verdict !== "REFUTED" && !combinedLocs.has(loc(c)))
  .map((c) => ({
    file: c.file,
    line: c.line,
    tag: c.tag,
    what: c.what,
    replacement: c.replacement,
  }));
const ponytailReview = {
  findings: ponytailFindings,
  verdict: ponytail ? ponytail.verdict || "" : "not run",
};
log("Lean review: " + ponytailRaw.length + " raw → " + ponytailFindings.length + " verified & non-duplicate over-engineering finding(s) — " + (ponytailReview.verdict || "n/a"));

// ── Final report to the caller (no Apply, no Ship, no escalation) ─────────────
return {
  stage: "done",
  review: { ...reviewStats, summary: reviewSummary, findings }, // findings: [{file, line, summary, failure_scenario, category, verdict}]
  ponytailReview, // {findings:[{file,line?,tag,what,replacement}], verdict} — independently verified + deduped, report-only
  refuted, // verified-but-REFUTED candidate objects, for transparency
};
