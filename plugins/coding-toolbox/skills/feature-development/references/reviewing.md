# Reviewing (feature-development phase)

Run the branch's whole-diff quality/correctness pass after Implement, before PR.
One combined review workflow replaces the former `simplify` + `code-review --fix`
built-in-skill pair: correctness angles and per-lens cleanup finders run once
over the accumulated diff, every candidate is independently verified, and the
orchestrator applies the surviving fixes afterward. Prompt texts (correctness
angles A–E, the five cleanup lenses, verdict ladder) are vendored verbatim from
the built-in `/code-review` workflow and `/simplify` skill. Nothing here consumes this skill's own step 4 (Implement)'s minor-findings
list — carry it forward unchanged to `fresh-work`'s PR step (invoked after
this skill returns).

## Process

1. **Judge complexity** against this skill's own complexity heuristic — re-read the
   accumulated diff itself, not just the plan's own complexity guess; a plan
   that looked Simple can still produce a Complex diff once every task is in.
   Simple → `high`, Complex → `max`. (`high`/`max` scale finder count, sweep,
   and the findings cap — see `LEVEL` in the script.)
2. **Resolve the inputs** the script template inlines as literals:
   - `LEVEL` — `'high'` or `'max'` from step 1.
   - `DIFF_CMD` — the exact accumulated-diff command (typically
     `git diff <base>...HEAD` with the base branch `fresh-branch` cut from).
     Implement commits everything, so first confirm `git status --porcelain`
     is empty — stray working-tree state means Implement did not finish
     cleanly; stop and report instead of reviewing a mixed diff.
   - `PLAN_PATH` / `SPEC_PATH` — the plan/spec temp paths from the owning
     step task's metadata, or `''` when unavailable.
3. **Engine selection.** Probe once: `ToolSearch(query: "select:Workflow")`.
   Available → Workflow engine (this reference instructing the call is the
   documented opt-in for using it). Absent, or the tool rejects the script
   (meta/API validation error) → Agent engine fallback; do not fight API
   drift.
4. **Run the review** (engine sections below) → verified, ranked findings.
5. **Escalate, apply, commit** per "After the review returns".

## Workflow engine (canonical)

Build the script from the template below, replacing the four `/* … */`
placeholders with JS literals — never via the Workflow tool's `args`
parameter, and no `Date.now()`/`Math.random()` inside the script (both
constraints and their observed failures are documented in
`references/implementing.md`'s Workflow-engine section). The workflow is
read-only: finders, verifiers, and the synthesizer never edit files — fixes
are applied by the orchestrator afterward, where the `AskUserQuestion`
escalation gate lives. Every agent runs `model: 'sonnet'` (deliberate cost
pin; override only on explicit user request).

```js
export const meta = {
  name: 'feature-development-review',
  description: 'Combined quality+correctness review over the accumulated branch diff',
  phases: [
    { title: 'Scope', detail: 'changed files, summary, conventions', model: 'sonnet' },
    { title: 'Find', detail: 'correctness angles + per-lens cleanup finders', model: 'sonnet' },
    { title: 'Verify', detail: 'one verifier per (file, line) location', model: 'sonnet' },
    { title: 'Sweep', detail: 'gap hunt — max effort only', model: 'sonnet' },
    { title: 'Synthesize', detail: 'merge, rank, cap, flag decision-reversals', model: 'sonnet' },
  ],
}
// Inlined by the caller — NOT sourced from `args` (unreliable; see implementing.md):
const LEVEL = /* 'high' or 'max', as a JS string literal */
const DIFF_CMD = /* the exact accumulated-diff command, as a JS string literal */
const PLAN_PATH = /* absolute plan temp path as a JS string literal, or '' */
const SPEC_PATH = /* absolute spec temp path as a JS string literal, or '' */

const MODEL = 'sonnet'
const P = LEVEL === 'max'
  ? { correctnessAngles: 5, perAngle: 8, maxFindings: 15, sweep: true }
  : { correctnessAngles: 3, perAngle: 6, maxFindings: 10, sweep: false }
const SWEEP_MAX = 8

// ── Prompt texts vendored verbatim from the built-in /code-review workflow
//    (angles A–E, verdict ladder, precedence, sweep focus) and /simplify
//    (the first four cleanup lenses; conventions is /code-review's fifth) ──
const CORRECTNESS_ANGLES = [
  { label: "angle-A", text: "### Angle A — line-by-line diff scan\n\nRead every hunk in the diff, line by line. Then Read the enclosing function for\neach hunk — bugs in unchanged lines of a touched function are in scope (the PR\nre-exposes or fails to fix them). For every line ask: what input, state, timing,\nor platform makes this line wrong? Look for inverted/wrong conditions,\noff-by-one, null/undefined deref, missing `await`, falsy-zero checks,\nwrong-variable copy-paste, error swallowed in catch, unescaped regex metachars.\n" },
  { label: "angle-B", text: "### Angle B — removed-behavior auditor\n\nFor every line the diff DELETES or replaces, name the invariant or behavior it\nenforced, then search the new code for where that invariant is re-established.\nIf you can't find it, that's a candidate: a removed guard, a dropped error\npath, a narrowed validation, a deleted test that was covering a real case.\n" },
  { label: "angle-C", text: "### Angle C — cross-file tracer\n\nFor each function the diff changes, find its callers (Grep for the symbol) and\ncheck whether the change breaks any call site: a new precondition, a changed\nreturn shape, a new exception, a timing/ordering dependency. Also check callees:\ndoes a parallel change in the same PR make a call unsafe?\n" },
  { label: "angle-D", text: "### Angle D — language-pitfall specialist\n\nScan for the classic pitfalls of the diff's language/framework — for example:\nJS falsy-zero, `==` coercion, closure-captured loop var; Python mutable default\nargs, late-binding closures; Go nil-map write, range-var capture; SQL injection;\ntimezone/DST drift; float equality. Flag any instance the diff introduces.\n" },
  { label: "angle-E", text: "### Angle E — wrapper/proxy correctness\n\nWhen the PR adds or modifies a type that wraps another (cache, proxy, decorator,\nadapter): check that every method routes to the wrapped instance and not back\nthrough a registry/session/global — e.g. a caching provider holding a\n`delegate` field that resolves IDs via `session.get(...)` instead of\n`delegate.get(...)` will re-enter the cache or recurse. Also check that the\nwrapper forwards all the methods the callers actually use.\n" },
]
// One finder PER cleanup lens (unlike the built-in's single merged cleanup
// finder) — deliberately keeps /simplify's per-lens attention; same total
// cleanup-candidate budget (5 × perAngle).
const CLEANUP_LENSES = [
  { label: "reuse", text: "### Reuse\n\nFlag new code that re-implements something the codebase\nalready has — Grep shared/utility modules and files adjacent to the change,\nand name the existing helper to call instead.\n" },
  { label: "simplification", text: "### Simplification\n\nFlag unnecessary complexity the diff adds: redundant or derivable state,\ncopy-paste with slight variation, deep nesting, dead code left behind. Name\nthe simpler form that does the same job.\n" },
  { label: "efficiency", text: "### Efficiency\n\nFlag wasted work the diff introduces: redundant computation or repeated I/O,\nindependent operations run sequentially, blocking work added to startup or\nhot paths. Also flag long-lived objects built from closures or captured\nenvironments — they keep the entire enclosing scope alive for the object's\nlifetime (a memory leak when that scope holds large values); prefer a\nclass/struct that copies only the fields it needs. Name the cheaper\nalternative.\n" },
  { label: "altitude", text: "### Altitude\n\nCheck that each change is implemented at the right depth, not as a fragile\nbandaid. Special cases layered on shared infrastructure are a sign the fix\nisn't deep enough — prefer generalizing the underlying mechanism over adding\nspecial cases.\n" },
  { label: "conventions", text: "### Conventions (CLAUDE.md)\n\nFind the CLAUDE.md files that govern the changed code: the user-level\n~/.claude/CLAUDE.md, the repo-root CLAUDE.md, plus any CLAUDE.md or\nCLAUDE.local.md in a directory that is an ancestor of a changed file (a\ndirectory's CLAUDE.md only applies to files at or below it). Read each one\nthat exists, then check the diff for clear violations of the rules they state.\n\nOnly flag a violation when you can quote the exact rule and the exact line\nthat breaks it — no style preferences, no vague \"spirit of the doc\"\ninferences. In the finding, name the CLAUDE.md path and quote the rule so the\nreport can cite it. If no CLAUDE.md applies, return nothing for this angle.\n" },
]
const VERDICT_LADDER = "- **CONFIRMED** — can name the inputs/state that trigger it and the wrong\n  output or crash. Quote the line.\n- **PLAUSIBLE** — mechanism is real, trigger is uncertain (timing, env,\n  config). State what would confirm it.\n- **REFUTED** — factually wrong (code doesn't say that) or guarded elsewhere.\n  Quote the line that proves it."
const VERDICT_LADDER_RECALL = "**PLAUSIBLE by default** — do not refute a candidate for being \"speculative\" or\n\"depends on runtime state\" when the state is realistic: concurrency races,\nnil/undefined on a rare-but-reachable path (error handler, cold cache, missing\noptional field), falsy-zero treated as missing, off-by-one on a boundary the\ncode does not exclude, retry storms / partial failures, regex/allowlist that\nlost an anchor. These are PLAUSIBLE.\n\n**REFUTED** only when constructible from the code: factually wrong (quote the\nactual line); provably impossible (type/constant/invariant — show it); already\nhandled in this diff (cite the guard); or pure style with no observable effect."
const CLEANUP_PRECEDENCE = "Cleanup, altitude, and conventions candidates use the same\n`file`/`line`/`summary` shape; in `failure_scenario`, state the concrete\ncost (what is duplicated, wasted, harder to maintain, or which CLAUDE.md rule\nis broken) instead of a crash. Correctness bugs always outrank cleanup,\naltitude, and conventions findings when the output cap forces a cut.\n"
const SWEEP_GAP_FOCUS = "moved/extracted code that dropped a guard\nor anchor; second-tier footguns (dataclass default evaluated once, `hash()`\nnon-determinism, lock-scope shrink, predicate methods with side effects);\nsetup/teardown asymmetry in tests; config defaults flipped."

// ── Schemas ──
const SCOPE_SCHEMA = {
  type: "object", required: ["files", "summary"],
  properties: {
    files: { type: "array", items: { type: "string" } },
    claudeMdFiles: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    conventions: { type: "string" },
  },
}
const CANDIDATES_SCHEMA = {
  type: "object", required: ["candidates"],
  properties: {
    candidates: { type: "array", items: {
      type: "object", required: ["file", "summary", "failure_scenario"],
      properties: {
        file: { type: "string", description: "repo-relative path exactly as listed under Changed files in the review scope" },
        line: { type: "number" },
        summary: { type: "string" },
        failure_scenario: { type: "string" },
      },
    }},
  },
}
const GROUP_VERDICT_SCHEMA = {
  type: "object", required: ["verdicts"],
  properties: {
    verdicts: { type: "array", items: {
      type: "object", required: ["index", "verdict", "evidence"],
      properties: {
        index: { type: "number", description: "the [i] label of the candidate this verdict is for" },
        verdict: { enum: ["CONFIRMED", "PLAUSIBLE", "REFUTED"] },
        evidence: { type: "string" },
      },
    }},
  },
}
const REPORT_SCHEMA = {
  type: "object", required: ["summary", "decisions"],
  properties: {
    summary: { type: "string" },
    decisions: { type: "array", items: {
      type: "object", required: ["index"],
      properties: {
        index: { type: "number", description: "the [i] label of a finding to keep in the report" },
        merge: { type: "array", items: { type: "number" }, description: "[i] labels of findings that describe the same root cause, folded into this one" },
        reversesDecision: { type: "boolean", description: "true when applying this finding's fix would reverse a decision the design/plan documents record" },
      },
    }},
  },
}

// ── Phase 0: Scope ──
phase("Scope")
const scope = await agent(
  "Establish the scope of a code review of the current branch's accumulated diff.\n\n" +
  "Run this exact diff command (already resolved by the orchestrator): " + DIFF_CMD + "\n\n" +
  "1. Confirm it produces a non-empty diff.\n" +
  "2. List the changed files (repo-relative).\n" +
  "3. Summarize what changed in one paragraph.\n" +
  "4. List the CLAUDE.md files that apply to the changed files (the user-level ~/.claude/CLAUDE.md, the repo-root CLAUDE.md, plus any CLAUDE.md or CLAUDE.local.md in a directory that is an ancestor of a changed file). Read each one that exists and note conventions a reviewer should know.\n\n" +
  "Structured output only.",
  { label: "scope", schema: SCOPE_SCHEMA, model: MODEL }
)
if (!scope) {
  return { error: "Scope agent returned no result — cannot establish the review scope." }
}
if (!scope.files || scope.files.length === 0) {
  return { level: LEVEL, summary: "No changes found to review.", findings: [], stats: { finders: 0, candidates: 0, verifierAgents: 0, verified: 0 } }
}
log(LEVEL + " review: " + scope.files.length + " changed files")

const claudeMdFiles = scope.claudeMdFiles || []
const SCOPE_BLOCK =
  "## Review scope\n" +
  "Diff command: " + DIFF_CMD + "\n" +
  "Changed files (" + scope.files.length + "):\n" +
  scope.files.map(f => "  - " + f).join("\n") + "\n" +
  "Applicable CLAUDE.md files (" + claudeMdFiles.length + "):\n" +
  (claudeMdFiles.length > 0 ? claudeMdFiles.map(f => "  - " + f).join("\n") : "  (none)") + "\n\n" +
  "## What changed\n" + scope.summary + "\n\n" +
  "## Conventions\n" + (scope.conventions || "(none noted)") + "\n"

// ── Prompts ──
const FINDER_PROMPT = f =>
  "## Review finder — " + f.label + "\n\n" + SCOPE_BLOCK + "\n" +
  "Run the diff command above and review ONLY through the lens of your assigned angle:\n\n" +
  f.text + "\n" +
  (f.kind === "cleanup" ? CLEANUP_PRECEDENCE + "\n" : "") +
  "Surface up to " + f.cap + " candidate findings, each with file, line, a one-line summary, and a concrete failure_scenario — the user-visible consequence (error, wrong output, data loss), not an intermediate state (value stale, set grows). " +
  "Pass every candidate with a nameable failure scenario through — do not silently drop half-believed candidates; an independent verifier judges them next. " +
  "If nothing qualifies, return an empty list.\n\nStructured output only."

// Finders may return absolute, repo-relative, or backslash-separated paths
// for the same file. Normalize once at ingest by suffix-matching against
// scope.files so every downstream consumer — group key, verifier prompt,
// synthesis block, final report — sees the same path. Longest match wins.
const canonFile = raw => {
  if (!raw) return ""
  const p = raw.replace(/\\/g, "/")
  let best = ""
  for (const sf of scope.files) {
    if ((p === sf || p.endsWith("/" + sf)) && sf.length > best.length) best = sf
  }
  return best
}
const ingest = (cs, cap, kind) =>
  cs.slice(0, cap).map(c => ({ ...c, file: canonFile(c.file), kind })).filter(c => c.file)
const loc = c => c.file + (c.line != null ? ":" + c.line : "")
const inBounds = (i, n) => Number.isInteger(i) && i >= 0 && i < n

const GROUP_VERIFIER_PROMPT = group =>
  "## Review verifier\n\n" + SCOPE_BLOCK + "\n" +
  "## Candidate findings at " + loc(group[0]) + "\n" +
  group.map((c, i) =>
    "[" + i + "] Summary: " + c.summary + "\n" +
    "    Failure scenario: " + c.failure_scenario
  ).join("\n") + "\n\n" +
  "Run the diff command above, read the relevant file(s), and return one verdict per candidate. " +
  "Judge EACH candidate independently on its own claim — candidates at the same location may describe distinct issues, the same issue, or a mix. " +
  "Reference each by its [i] index.\n\n" +
  VERDICT_LADDER + "\n\n" + VERDICT_LADDER_RECALL + "\n\n" +
  "Structured output only. Evidence must quote or cite the relevant line(s)."

// One verifier per distinct (file, line) location, returning a verdict per
// candidate there. Grouping is not dedup: every candidate keeps its own
// verdict; the synthesis step merges semantic dupes. A candidate the
// verifier rendered no verdict on is dropped, never fabricated PLAUSIBLE.
let verifierAgents = 0
async function verifyGroups(candidates) {
  const byLoc = Object.create(null)
  for (const c of candidates) (byLoc[loc(c)] ||= []).push(c)
  const groups = Object.values(byLoc)
  verifierAgents += groups.length
  const out = await parallel(groups.map(g => async () => {
    const short = g[0].file.split("/").pop()
    const r = await agent(GROUP_VERIFIER_PROMPT(g), { label: "verify:" + short + "(" + g.length + ")", phase: "Verify", schema: GROUP_VERDICT_SCHEMA, model: MODEL })
    if (!r) return []
    const byIdx = {}
    for (const v of r.verdicts) if (inBounds(v.index, g.length)) byIdx[v.index] = v
    return g.flatMap((c, i) => byIdx[i] ? [{ ...c, verdict: byIdx[i].verdict, evidence: byIdx[i].evidence }] : [])
  }))
  return out.filter(Boolean).flat()
}

// ── Find (barrier — cross-finder location grouping needs every finder's
// output) → group → Verify ──
const FINDERS = CORRECTNESS_ANGLES.slice(0, P.correctnessAngles)
  .map(a => ({ ...a, kind: "correctness", cap: P.perAngle }))
  .concat(CLEANUP_LENSES.map(l => ({ label: "cleanup:" + l.label, text: l.text, kind: "cleanup", cap: P.perAngle })))

const finderOuts = await parallel(FINDERS.map(f => () =>
  agent(FINDER_PROMPT(f), { label: f.label, phase: "Find", schema: CANDIDATES_SCHEMA, model: MODEL }).then(r => {
    if (!r) return []
    log(f.label + ": " + r.candidates.length + " candidates")
    return ingest(r.candidates, f.cap, f.kind)
  })
))
const allCandidates = finderOuts.filter(Boolean).flat()
let candidatesSeen = allCandidates.length

let verified = await verifyGroups(allCandidates)

// ── Sweep (max only): one fresh finder hunting only for gaps ──
if (P.sweep) {
  phase("Sweep")
  const knownBlock = verified.length > 0
    ? verified.map(c => "- " + loc(c) + " — " + c.summary).join("\n")
    : "(none)"
  const sweep = await agent(
    "## Review sweep — gaps only\n\n" + SCOPE_BLOCK + "\n" +
    "## Already-found candidates (do NOT re-derive or re-confirm these)\n" + knownBlock + "\n\n" +
    "Re-read the diff and the enclosing functions looking ONLY for defects not already listed. " +
    "Focus on what the first pass tends to miss: " + SWEEP_GAP_FOCUS + "\n\n" +
    "Surface up to " + SWEEP_MAX + " additional candidates. If nothing new, return an empty list — do not pad.\n\nStructured output only.",
    { label: "sweep", phase: "Sweep", schema: CANDIDATES_SCHEMA, model: MODEL }
  )
  if (sweep && sweep.candidates.length > 0) {
    const sliced = ingest(sweep.candidates, SWEEP_MAX, "correctness")
    candidatesSeen += sliced.length
    log("sweep: " + sliced.length + " candidates")
    verified = verified.concat(await verifyGroups(sliced))
  }
}

const surviving = verified.filter(c => c.verdict !== "REFUTED")
const refuted = verified.filter(c => c.verdict === "REFUTED")
log("Verify done: " + verified.length + " verified → " + surviving.length + " kept, " + refuted.length + " refuted")

const stats = { level: LEVEL, finders: FINDERS.length, candidates: candidatesSeen, verifierAgents, verified: verified.length, refuted: refuted.length }

if (surviving.length === 0) {
  return { level: LEVEL, summary: "No findings survived verification.", findings: [], stats }
}

// ── Synthesize: rank, merge semantic dupes, cap, flag decision-reversals ──
phase("Synthesize")
const rank = c => (c.kind === "cleanup" ? 2 : 0) + (c.verdict === "PLAUSIBLE" ? 1 : 0)
const ranked = surviving.slice().sort((a, b) => rank(a) - rank(b))
const block = ranked.map((c, i) =>
  "### [" + i + "] " + loc(c) + " (" + c.verdict + (c.kind === "cleanup" ? ", cleanup" : "") + ")\n" +
  c.summary + "\nFailure scenario: " + c.failure_scenario + "\nVerifier evidence: " + c.evidence + "\n"
).join("\n")
const PLAN_CONTEXT = (SPEC_PATH || PLAN_PATH)
  ? "## Design/plan context\nRead these session temp files before deciding: " +
    [SPEC_PATH, PLAN_PATH].filter(Boolean).join(", ") + "\n" +
    "For each decision, set reversesDecision: true when applying the finding's fix would reverse a decision those documents record (an approach, interface, or scope choice) rather than merely polishing its execution. Default false.\n"
  : "## Design/plan context\nNo design/plan documents available — set reversesDecision: false throughout.\n"

const report = await agent(
  "## Synthesis: final review report\n\n" +
  ranked.length + " findings survived independent verification (" + LEVEL + "-effort review). They are numbered [0]-[" + (ranked.length - 1) + "] below.\n\n" + block + "\n" +
  PLAN_CONTEXT + "\n" +
  "## Instructions\n" +
  "Return decisions about findings BY INDEX — never re-emit finding text.\n" +
  "1. For each distinct defect, emit one decision with its index. When several findings describe the same defect (same root cause), keep one entry and list the others in its merge array.\n" +
  "2. Order decisions most-severe first. Correctness bugs always outrank cleanup findings.\n" +
  "3. Keep at most " + P.maxFindings + " decisions; omit the least severe beyond the cap.\n" +
  "4. Set reversesDecision per the design/plan context above.\n" +
  "5. Write a 2-3 sentence summary of the review.\n\nStructured output only.",
  { label: "synthesize", schema: REPORT_SCHEMA, model: MODEL }
)

// Assembler invariants: no silent drops while there is room (every verified
// finding appears as primary or merge note, or is omitted only because the
// cap is full); the displayed primary is the synthesizer's choice; a merged
// member's CONFIRMED escalates the verdict label. Backfilled findings carry
// no synthesizer judgment — reversesDecision: false; the orchestrator's own
// escalation judgment still applies to them.
const decisions = report && Array.isArray(report.decisions) ? report.decisions : []
const seen = new Set()
const claim = i => (inBounds(i, ranked.length) && !seen.has(i) ? (seen.add(i), true) : false)
const findings = []
for (const d of decisions) {
  if (findings.length >= P.maxFindings) break
  if (!claim(d.index)) continue
  const c = ranked[d.index]
  const merged = (Array.isArray(d.merge) ? d.merge : []).filter(claim).map(i => ranked[i])
  const verdict = merged.some(m => m.verdict === "CONFIRMED") ? "CONFIRMED" : c.verdict
  const also = merged.length > 0 ? " [same root cause also at: " + merged.map(loc).join(", ") + "]" : ""
  findings.push({ file: c.file, line: c.line, summary: c.summary + also, failure_scenario: c.failure_scenario, category: c.kind, verdict, reversesDecision: d.reversesDecision === true })
}
const usedDecisions = findings.length > 0
let backfilled = 0
for (let i = 0; i < ranked.length && findings.length < P.maxFindings; i++) {
  if (seen.has(i)) continue
  const c = ranked[i]
  findings.push({ file: c.file, line: c.line, summary: c.summary, failure_scenario: c.failure_scenario, category: c.kind, verdict: c.verdict, reversesDecision: false })
  backfilled++
}
const summary = usedDecisions && report
  ? report.summary + (backfilled > 0 ? " (" + backfilled + " additional verified finding" + (backfilled === 1 ? "" : "s") + " appended unmerged.)" : "")
  : "Synthesis step was skipped or its decisions were unusable — returning verified findings ranked, unmerged."

return {
  level: LEVEL,
  summary,
  findings,
  refuted: refuted.map(c => ({ file: c.file, line: c.line, summary: c.summary })),
  stats: { ...stats, reported: findings.length },
}
```

## After the review returns (both engines)

1. **Escalate first.** Findings with `reversesDecision: true` — plus any
   finding you yourself judge would reverse a design/plan decision regardless
   of the flag (backfilled findings carry no synthesizer judgment) — go
   through `AskUserQuestion` (apply / skip, related findings grouped into one
   question) BEFORE anything is applied. Never silently apply a
   decision-reversing fix.
2. **Apply the rest inline** (Read → Edit), most-severe first. Line numbers
   are advisory — locate each finding by content, the tree may have shifted.
   Keep the skip rule: a fix that would change intended behavior, require
   changes well outside the reviewed diff, or that you judge a false positive
   → skip it and note the skip in the report, rather than arguing with it.
3. **Commit by category** — this step deliberately overrides the repo's usual
   "one fix per commit, never bundled" convention with category granularity,
   so the two kinds of change stay distinguishable in history: all
   correctness fixes as one commit, all cleanup fixes as its own separate
   commit, each only if `git status --porcelain` shows changes for it (never
   force an empty commit).
4. **Report** one short line: findings applied / skipped / escalated, and the
   two commit hashes (or that the diff was already clean).

## Agent engine (fallback)

Run the identical stages yourself via batched Agent-tool dispatches with the
same prompts (substitute `SCOPE_BLOCK` and the placeholders by hand; every
agent `model: sonnet`):

- **Scope:** run `DIFF_CMD` yourself and gather changed files + applicable
  CLAUDE.md conventions inline — no dispatch needed.
- **Find:** one message, one Agent block per finder (correctness angles per
  `LEVEL` + the five cleanup lenses), each returning the candidate list.
- **Verify:** after reconciling the finder batch, group candidates by
  (file, line) yourself, then one message with one verifier block per group.
- **Sweep (`max` only):** one gap-hunt finder, then verify its candidates.
- **Synthesize inline:** rank (correctness > cleanup, CONFIRMED > PLAUSIBLE),
  merge semantic dupes, cap per `LEVEL`, judge `reversesDecision` against the
  plan/spec docs yourself. Then continue with "After the review returns".

> **Subagent reconciliation gate.** Track every async dispatch so you never
> advance on a partial batch and never miss a finish. Load the ledger tools
> once (deferred; resolve at depth 0, where this skill runs — a
> subagent-scoped probe falsely reports these absent, do NOT skip the ledger
> on that basis):
> `ToolSearch(query: "select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop")`
> (retry bare names). Only if the CRUD ledger tools fail to load, use the
> prose-count fallback below.
>
> 1. On dispatch, `TaskCreate` one entry per finder/verifier actually
>    dispatched (`subject` = role + label, `metadata.dispatch_id` = its Agent
>    `task_id`), then `TaskUpdate` it to `in_progress`.
> 2. On each `<task-notification>`, match by `dispatch_id`, record the
>    result, `TaskUpdate` → `completed` (soft-fail returns are terminal).
> 3. **Gate:** before grouping candidates for the verifier batch, and before
>    synthesizing, `TaskList`; any batch entry still `pending`/`in_progress`
>    → do NOT advance.
> 4. Escape hatch only: a genuinely stuck entry → `TaskStop` its
>    `dispatch_id`, mark it terminal, record a soft-failure, proceed. Never
>    `TaskOutput` a dispatch_id (transcript overflow).
> Prose-count fallback: track the dispatched count explicitly; do not advance
> until that many structured results are in hand.

## Exit

Return to `fresh-work`'s PR step (invoked after this skill returns),
carrying this skill's own step 4 (Implement)'s minor-findings list forward
unchanged — this phase does not consume it; it runs its own independent scan
and has no input mechanism for that plan-specific ledger content.
