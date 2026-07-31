# cc-memory analysis workflow — script reference

Read by `SKILL.md`'s step 3 ("Analyze files (Workflow)"). Runs the
per-file `cc-reviewer` audit and the aggregation/grading pass that used to
be inline in this skill, now via the `Workflow` tool. Falls back to direct
`Agent`-tool dispatch (below) when `Workflow` is unavailable.

## Engine selection

Probe once: `ToolSearch(query: "select:Workflow")`. Available → build and
run the script below (this reference instructing the call is the
documented opt-in for using the `Workflow` tool). Absent, or the tool
rejects the script (meta/API validation error) → use the Agent-tool
fallback further down; do not fight API drift.

## Workflow engine (canonical)

Build the script from the template below. Inline the discovered file list
(step 2's output) and the scope note as JS string/array literals directly
in the script text you send — **never via the `args` parameter**
(unreliable in this harness). No `Date.now()`/`Math.random()`/argless
`new Date()` inside the script.

```js
export const meta = {
  name: 'cc-memory-analyze',
  description: 'Audit each discovered memory file in parallel, then aggregate into a graded report',
  phases: [
    { title: 'Analyze', detail: 'one cc-reviewer per discovered file', model: 'sonnet' },
    { title: 'Aggregate', detail: 'grade table + report text', model: 'sonnet' },
  ],
}
// Inlined by the caller as JS string literals — never via `args`:
const FILES = /* discovered paths from step 2, JSON array of strings, e.g. ["CLAUDE.md", ".claude/rules/foo.md"] */
const SCOPE_NOTE = /* one-line note, e.g. "whole project" or the $ARGUMENTS path, as a JS string literal */

// ── Schemas ──
const FINDING_ITEM_SCHEMA = {
  type: "object",
  required: ["id", "severity", "location", "rule", "issue", "recommendation", "uncovered"],
  properties: {
    id: { type: "string" },
    severity: { enum: ["high", "med", "low"] },
    location: { type: "string" },
    rule: { type: "string" },
    issue: { type: "string" },
    recommendation: { type: "string" },
    uncovered: { type: "boolean" },
    suggested_fix: {
      type: ["object", "null"],
      properties: {
        old_string: { type: "string" },
        new_string: { type: "string" },
        full_content: { type: "string" },
      },
    },
  },
}
const FINDINGS_SCHEMA = {
  type: "object", required: ["findings"],
  properties: { findings: { type: "array", items: FINDING_ITEM_SCHEMA } },
}
const AGGREGATE_SCHEMA = {
  type: "object", required: ["summary", "perFile"],
  properties: {
    summary: {
      type: "object", required: ["filesFound", "gradeDistribution", "filesNeedingUpdate"],
      properties: {
        filesFound: { type: "number" },
        gradeDistribution: { type: "string", description: "e.g. 'A:3 B:2 C:1'" },
        filesNeedingUpdate: { type: "number" },
      },
    },
    perFile: {
      type: "array", items: {
        type: "object", required: ["path", "grade", "issues", "recommendedActions", "failed"],
        properties: {
          path: { type: "string" },
          grade: { enum: ["A", "B", "C", "D", "F"] },
          coveredCounts: { type: "object", properties: { high: { type: "number" }, med: { type: "number" }, low: { type: "number" } } },
          uncoveredCount: { type: "number" },
          issues: { type: "array", items: { type: "string" }, description: "one line each: severity · rule · issue" },
          recommendedActions: { type: "array", items: { type: "string" } },
          failed: { type: "boolean" },
        },
      },
    },
  },
}

// ── Grade table, as code (used only to backfill a file the aggregation
// agent's output omits — never overrides a file it DID report) ──
function computeCounts(findings) {
  const covered = (findings || []).filter(f => f.uncovered !== true)
  const counts = { high: 0, med: 0, low: 0 }
  for (const f of covered) if (counts[f.severity] !== undefined) counts[f.severity]++
  return counts
}
function computeGrade(counts) {
  if (counts.high >= 2) return "F"
  if (counts.high === 1) return "D"
  if (counts.med > 0) return "C"
  if (counts.low > 0) return "B"
  return "A"
}
function templateIssueLine(f) {
  return f.severity + " · " + f.rule + " · " + f.issue
}

// ── Prompts ──
const FINDER_PROMPT = path =>
  "component_type: memory\n" +
  "target_paths: " + path + "\n\n" +
  "In addition to the usual memory rule-compliance findings, also surface — against " +
  "the cc-reference memory rules you already apply — these leanness/splittability " +
  "findings:\n" +
  "- LENGTH/LEANNESS: if the file exceeds the cc-reference ~200-line target, emit a " +
  "finding noting the length and that it should be trimmed.\n" +
  "- SPLITTABILITY: if a section's content is scoped to ONE subdirectory, recommend " +
  "moving it to that subdirectory's CLAUDE.md (grounded in the cc-reference " +
  "locations table — subdir files load on-demand). If a section's content applies " +
  "to a FILE TYPE / EXTENSION across the tree, recommend moving it to " +
  ".claude/rules/ with a `paths:` glob, e.g. `paths: [\"**/*.kt\"]` (grounded in the " +
  "cc-reference \"What belongs\" table). Both targets are co-equal; choose by scope. " +
  "When the target IS itself a `.claude/rules/*.md` file, the move-into-`.claude/rules/` " +
  "branch does not apply (it is already a rule file) and the ~200-line LENGTH target is " +
  "advisory there rather than a cited rule — for a rule file, audit what genuinely fits " +
  "it (e.g. a well-formed `paths:` frontmatter glob, terseness) and skip the rest.\n\n" +
  "For every leanness/splittability finding: set `uncovered: false` (cc-reference " +
  "covers both the 200-line target and the .claude/rules/+paths: route), " +
  "`suggested_fix: null` (new-file/multi-file coordination — recommend-only), and " +
  "severity `low` (or at most `med` for an egregiously long file) — NEVER `high`. " +
  "Include the candidate target path / `paths:` glob in the `recommendation` text.\n\n" +
  "Return your findings via the required structured-output call: an object with a " +
  "`findings` array, each item shaped per your own output contract (id, severity, " +
  "location, rule, issue, recommendation, uncovered, suggested_fix)."

const AGGREGATE_PROMPT = perFile => {
  const failedPaths = perFile.filter(p => p.failed).map(p => p.path)
  const okBlock = perFile.filter(p => !p.failed).map(p =>
    "### " + p.path + "\n" +
    (p.findings.length === 0 ? "(no findings)\n" : p.findings.map(f =>
      "- [" + f.id + "] " + f.severity + " · " + f.rule + " · " + f.issue +
      " (uncovered: " + f.uncovered + ", suggested_fix: " + (f.suggested_fix ? "yes" : "null") + ")\n" +
      "  recommendation: " + f.recommendation
    ).join("\n"))
  ).join("\n\n")
  return "## Aggregate memory-file findings into a graded report\n\n" +
    "Scope: " + SCOPE_NOTE + ". " + perFile.length + " file(s) analyzed, " +
    failedPaths.length + " failed (" + (failedPaths.join(", ") || "none") + ").\n\n" +
    okBlock + "\n\n" +
    "## Grade table (apply per file, using only findings with uncovered: false)\n" +
    "| Covered findings | Grade |\n|---|---|\n| none | A |\n| only low | B |\n" +
    "| any med, no high | C |\n| one high | D |\n| multiple high | F |\n\n" +
    "Leanness/splittability findings are uncovered: false and count toward this table " +
    "too — capped at med, they can lower a grade to C but never to D/F on their own.\n\n" +
    "## Your task\n" +
    "For each file NOT in the failed list, return one `perFile` entry: `path`, the " +
    "computed `grade`, `coveredCounts` (high/med/low counts among uncovered:false " +
    "findings), `uncoveredCount`, `issues` (one line each, `severity · rule · issue`, " +
    "covered findings only — skip uncovered ones here, they are informational), and " +
    "`recommendedActions` (fixable findings' recommendation text plus any manual " +
    "to-do — leanness/split recommendations with their candidate target — with " +
    "`suggested_fix: null`). Set `failed: false`.\n" +
    "For each failed path, return a `perFile` entry with `failed: true`, `grade: \"A\"` " +
    "(placeholder — the orchestrator does not grade a failed file), empty `issues`/" +
    "`recommendedActions`.\n" +
    "Then return `summary`: `filesFound` (" + perFile.length + "), `gradeDistribution` " +
    "(e.g. \"A:3 B:2 C:1\", counting failed files separately as noted in prose), and " +
    "`filesNeedingUpdate` (grade < A, or any fixable finding / actionable task, " +
    "excluding failed files).\n\n" +
    "Structured output only."
}

// ── Phase 1: Analyze ──
phase('Analyze')
const perFile = await parallel(FILES.map(path => () =>
  agent(FINDER_PROMPT(path), {
    label: 'analyze:' + path, phase: 'Analyze',
    agentType: 'claude-code-knowledge:cc-reviewer',
    schema: FINDINGS_SCHEMA, model: 'sonnet',
  }).then(r => ({ path, findings: r ? r.findings : null, failed: !r }))
))
log('Analyzed ' + perFile.length + ' file(s), ' + perFile.filter(p => p.failed).length + ' failed')

// ── Phase 2: Aggregate ──
phase('Aggregate')
const aggregate = await agent(AGGREGATE_PROMPT(perFile), {
  label: 'aggregate', schema: AGGREGATE_SCHEMA, model: 'sonnet',
})

// Backfill: no discovered file may be missing from aggregate.perFile.
const reportedPaths = new Set((aggregate && aggregate.perFile ? aggregate.perFile : []).map(e => e.path))
const backfilled = []
for (const p of perFile) {
  if (reportedPaths.has(p.path)) continue
  if (p.failed) {
    // "A" is an inert placeholder (matches AGGREGATE_PROMPT's own instruction for
    // failed files) — step 4 renders "failed to analyze" from `failed: true` and
    // never reads `grade` for these entries, so the placeholder value is never shown.
    backfilled.push({ path: p.path, grade: "A", failed: true, issues: [], recommendedActions: [], coveredCounts: { high: 0, med: 0, low: 0 }, uncoveredCount: 0 })
  } else {
    const counts = computeCounts(p.findings)
    backfilled.push({
      path: p.path,
      grade: computeGrade(counts),
      failed: false,
      issues: p.findings.filter(f => f.uncovered !== true).map(templateIssueLine),
      recommendedActions: p.findings.filter(f => f.uncovered !== true && f.suggested_fix).map(f => f.recommendation),
      coveredCounts: counts,
      uncoveredCount: p.findings.filter(f => f.uncovered === true).length,
    })
  }
}
if (backfilled.length > 0) log('Backfilled ' + backfilled.length + ' file(s) the aggregation agent omitted: ' + backfilled.map(b => b.path).join(', '))
const finalPerFile = (aggregate && aggregate.perFile ? aggregate.perFile : []).concat(backfilled)

return {
  perFile,
  aggregate: { summary: aggregate ? aggregate.summary : null, perFile: finalPerFile },
}
```

## Agent-tool fallback

Only when `Workflow` is unavailable or rejects the script above. This is
today's proven direct-dispatch logic, unchanged:

1. **Dispatch reviewers (parallel).** For each discovered path, dispatch
   the `cc-reviewer` agent (Agent tool, `subagent_type:
   claude-code-knowledge:cc-reviewer`) in a single message so they run
   concurrently. Each dispatch prompt is `FINDER_PROMPT(path)` above, with
   its closing line replaced by: "Return ONLY the JSON findings array per
   your output contract."
2. **Grade and report.** Parse each agent's JSON findings array yourself.
   For each file derive a quality grade from the covered findings only
   (`uncovered: false`) using the grade table in `AGGREGATE_PROMPT`'s
   prose above (equivalently, `computeGrade`/`computeCounts` from this
   file). If an agent returns non-JSON or errors, note that file as
   failed and continue with the others. Produce the same
   `{ perFile, aggregate: { summary, perFile } }` shape `SKILL.md`'s step
   4 expects, built by hand instead of returned by a `Workflow` run.
