export const meta = {
  name: "update-cc-references-run",
  description: "Refresh cc-reference files: author+gate, verify",
  phases: [{ title: "Update" }, { title: "Verify" }],
};

// Filled in by `refresh.mjs plan` (one literal replace on the next line); do not pass Workflow args.
const PLAN = __PLAN__;

// Author result: changelog plus the gate output (changing, diffPath) echoed back.
const AuthorSchema = {
  type: "object",
  required: ["name", "changelog", "changing", "diffPath"],
  properties: {
    name: { type: "string" },
    changelog: { type: "string" },
    changing: { type: "array", items: { type: "string" } },
    diffPath: { type: ["string", "null"] },
  },
};
// Object-rooted wrapper around cc-reference-validator's verdict array (agent() rejects array roots).
const VerdictBatchSchema = {
  type: "object",
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        required: ["hunk", "verdict"],
        properties: {
          hunk: { type: "string" },
          verdict: { enum: ["CONFIRMED", "REJECTED", "UNVERIFIABLE"] },
          quote: { type: "string" },
          docPath: { type: "string" },
          confidence: { enum: ["high", "medium", "low"] },
          notes: { type: "string" },
        },
      },
    },
  },
};

const sq = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;

// Gate writes the diff here; derived, not trusted from the author's echo.
const diffPath = (t) => `${PLAN.scratch}/diffs/${t.name}.diff`;

const docLines = (t) => t.docs.map((d) => `- ${d.path} (fetched from ${d.url}.md)`);

const authorPrompt = (t) =>
  [
    "You refresh ONE harness-optimized Claude Code reference file against the official Anthropic docs.",
    "",
    `Reference file (edit in place with Edit/Write): ${t.file}`,
    "Local doc copies, already curl-fetched (Read/Grep them; never fetch anything, never WebFetch, never WebSearch):",
    ...docLines(t),
    ...(t.note ? ["", `File-specific rule (obey strictly): ${t.note}`] : []),
    "",
    "Diff the docs against the reference file with this delta checklist:",
    "- Frontmatter fields: added, removed, renamed, or changed semantics.",
    "- Hook events & handler fields (hooks files only): new/removed events, changed cadence, new matcher fields, new handler types/fields, changed exit-2-per-event effects, new decision-control fields, hookSpecificOutput changes.",
    "- Best-practice guidance: changed thresholds, reworded rules, new anti-patterns/patterns.",
    "- Lifecycle / mechanics: compaction budgets, context-loading rules, discovery/precedence changes.",
    "- Permissions & invocation: new permission modes, Skill(...)/Agent(...) rule syntax, skillOverrides states, delegation/--agent behavior.",
    "- Version gates: any \"requires vX.Y.Z\"/\"as of vX.Y.Z\" note goes to the Version notes section.",
    "- Env vars & settings: new CLAUDE_CODE_* vars or settings keys.",
    "- Built-ins: changes to built-in skills/agents.",
    "",
    "Apply edits: directives not prose, tables for field references, no marketing, forward slashes. Body under 500 lines (split to a sibling file, one level deep, if it outgrows this). No time-sensitive phrasing: use a Version notes line or a collapsed \"Old patterns\" block. Write in English.",
    "Only introduce an x.y.z version number that appears verbatim in the local doc copies; any other newly added version is reverted automatically.",
    "Do NOT touch the verified date in the file header; the finish step stamps it.",
    `If you add, rename or remove a "## " heading, update the matching section index in ${PLAN.repoRoot}/plugins/cc-knowledge/skills/cc-reference/SKILL.md.`,
    "",
    "When done editing, run exactly this command via Bash and read its one-line JSON output:",
    `node ${sq(PLAN.script)} gate ${sq(PLAN.scratch)} ${sq(t.name)}`,
    `Return {name, changelog, changing, diffPath}: name = "${t.name}"; changelog = a short delta summary grouped by the checklist categories ("no changes" if none); changing and diffPath copied verbatim from the gate output.`,
  ].join("\n");

const validatorPrompt = (t, authored) =>
  [
    `Validate the line-changing hunks of one cc-reference file refresh (${t.name}).`,
    `Diff (local file path, Read it): ${diffPath(t)}`,
    "Authoritative doc(s) (local file paths, Read/Grep them):",
    ...docLines(t),
    "Every hunk in this diff removes or changes an existing line and needs its own verdict: report ALL of them, including rewordings you would call additive (an unreported hunk is reverted).",
    "The hunk field of each verdict is the hN label at the end of each @@ line (for example \"h1\").",
    "Return {\"verdicts\": [...]} per your Output contract.",
  ].join("\n");

phase("Update");
const results = await pipeline(
  PLAN.targets,
  (t) => agent(authorPrompt(t), { phase: "Update", schema: AuthorSchema, model: "sonnet" }),
  (authored, t) => {
    if (!authored) return null;
    if (!authored.changing || !authored.changing.length) return { authored, verdicts: [] };
    return agent(validatorPrompt(t, authored), {
      phase: "Verify",
      agentType: "cc-reference-validator",
      schema: VerdictBatchSchema,
      model: "sonnet",
    }).then((r) => ({ authored, verdicts: (r && r.verdicts) || [] }));
  },
  (prev, t) => {
    if (!prev) return null;
    const { authored, verdicts } = prev;
    // Normalize "h1" / "@@ ... h1" to the bare label; one non-CONFIRMED verdict vetoes the hunk.
    const label = (v) => (/\bh\d+\b/.exec(v.hunk) || [])[0];
    const vetoed = new Set(verdicts.filter((v) => v.verdict !== "CONFIRMED").map(label));
    const confirmed = verdicts.filter((v) => v.verdict === "CONFIRMED" && authored.changing.includes(label(v)) && !vetoed.has(label(v)));
    return {
      name: t.name,
      changelog: authored.changelog,
      verdicts,
      keep: [...new Set(confirmed.map(label))],
      lowConfidenceKept: confirmed.filter((v) => v.confidence === "low"),
    };
  },
);

// A null result (thrown stage) still gets its finish command, without --keep: fail-closed revert.
const commands = PLAN.targets.map((t, i) => {
  const keep = (results[i] && results[i].keep) || [];
  return `node ${sq(PLAN.script)} finish ${sq(PLAN.scratch)} ${sq(t.name)}` + (keep.length ? ` --keep ${keep.join(",")}` : "");
});
return { results, commands };
