// ─────────────────────────────────────────────────────────────────────────────
// build-task-spec.workflow.js — build-task design pipeline, phase 3 of 3
//
//   Write spec → review gate → at most one fix round → recheck
//
// Transforms the decision-complete draft (DRAFT_PATH, written by
// build-task-design.workflow.js) into the final spec at SPEC_PATH — the single input of
// the delivery workflow. The spec writer and spec reviewer are inline agents
// (they never had role files).
//
// Args: { DRAFT_PATH, SPEC_PATH }
//   DRAFT_PATH — absolute path of the approved, decision-complete draft
//   SPEC_PATH  — absolute target path of the spec (create/overwrite)
//
// Exit contract:
//   'complete' — { status, specPath, specReviewed, minorFindings: [] }
//   'error'    — { status, stage: 'args' | 'Spec', error, draftPath? }
//
// Invocation contract:
//   - PRIMARY: the plugin workflow `build-task-spec` (by name, namespaced by the plugin, args)
//     with ONE JSON object as args — the script reads it as the global `args`.
//   - FALLBACK (decodeArgs reports "args global is undefined"): prepend
//     EXACTLY ONE line right after the meta block: `const args = { … }`
//     (JSON literal) and submit the text via `script` without the tool-level
//     `args` parameter.
//   - No clock reads, randomness or FS in the script.
//
// Models: spec writer sonnet (1:1 transformation), spec reviewer sonnet.
// ─────────────────────────────────────────────────────────────────────────────

export const meta = {
  name: "build-task-spec",
  description: "Approved design draft → spec (reviewed)",
  phases: [
    { title: "Spec", detail: "Draft → spec, review gate" },
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
const A = decodeArgs(["DRAFT_PATH", "SPEC_PATH"], {});
if (A.__error) return { status: "error", stage: "args", error: A.__error };
const { DRAFT_PATH, SPEC_PATH } = A;

const MODELS = {
  specWriter: "sonnet", // 1:1 transformation, no new decisions
  specReview: "sonnet", // document comparison draft↔spec
};

// Prepended to every prompt below — same wording as the rule baked into every
// plugin agents/*.md file: these agents run headless inside a Workflow, so any
// prose between tool calls is wasted tokens no one reads.
const NO_NARRATION = "No narrative text between tool calls — call tools silently and speak only in your final message (the report or structured output). Write that final message in English, whatever the language of the task or its inputs; commit messages are not covered.";

// ── Schemas ──────────────────────────────────────────────────────────────────
const WRITE_RESULT = {
  type: "object",
  required: ["status"],
  properties: { status: { enum: ["done", "blocked"] }, detail: { type: "string" } },
};
const SPEC_REVIEW = {
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

// ═════════════════════════════════════════════════════════════════════════════
// SPEC  (draft → spec → review gate → optional 1 fix round)
// ═════════════════════════════════════════════════════════════════════════════
phase("Spec");

const specWriterPrompt = (revision) =>
  `${NO_NARRATION}

You are the spec writer. The design
draft at ${DRAFT_PATH} is approved and decision-complete (its Open-questions
section is empty or fully resolved). Transform it into the final spec at
${SPEC_PATH} (create/overwrite).
The spec is the single input a downstream planner turns into an implementation
plan — dense, exact, complete, zero placeholders. Write it ENTIRELY in
English regardless of the draft's language (translate faithfully if needed)
— this file is read only by other agents, never shown to the user directly:
- Carry over EVERY decision, interface, constraint, and acceptance criterion
  from the draft — nothing dropped, nothing newly invented, no re-opened
  decisions ('USER DECISION' entries are immutable).
- Carry the draft's lean/YAGNI decisions forward: do not reintroduce a
  component, abstraction, or config the draft deliberately cut, and do not
  drop a required piece. The spec adds no speculative scope (reinforces
  "nothing newly invented" above).
- Sections: Keypoints; Goal; Non-goals; Chosen approach (alternatives + why
  they lost, condensed); Detailed design (architecture, components, data flow,
  exact interfaces); Error handling; Testing strategy; Acceptance criteria
  (checkable, exact commands); Risks; '## Global Constraints' (verbatim from
  the draft — one line each, exact values); '## Decisions & assumptions'.
- NO Open-questions section — a spec with open questions is invalid.
${revision ? "\nThis is a FIX round. Address exactly these findings, then rewrite " + SPEC_PATH + " in place:\n" + revision + "\n" : ""}
Return structured output: status (+ detail when blocked).`;

const specReviewerPrompt = `${NO_NARRATION}

You are a read-only spec reviewer. Compare the spec
at ${SPEC_PATH} against the approved draft at ${DRAFT_PATH}:
1. Completeness — every draft decision, interface, constraint, and acceptance
   criterion appears in the spec; name anything dropped or altered.
2. No inventions — the spec adds no decision the draft does not contain.
3. Placeholders — no TBD/TODO/vague requirements; no Open-questions section.
4. Ambiguity — every requirement has exactly one reading.
5. Acceptance criteria — checkable, with exact commands where the draft had them.
6. '## Global Constraints' present and matching the draft verbatim.
Severity 'blocking' for anything that would mislead the downstream planner.
Structured output only.`;

async function writeSpec(revision, label) {
  const opts = { label, phase: "Spec", schema: WRITE_RESULT, model: MODELS.specWriter };
  let w = await agent(specWriterPrompt(revision), opts);
  if (w === null) w = await agent(specWriterPrompt(revision), { ...opts, label: label + ":retry" });
  return w;
}

async function reviewSpec(label) {
  const opts = { label, phase: "Spec", schema: SPEC_REVIEW, model: MODELS.specReview };
  let r = await agent(specReviewerPrompt, opts);
  if (r === null) r = await agent(specReviewerPrompt, { ...opts, label: label + ":retry" });
  return r;
}

let spec = await writeSpec(null, "spec-write");
if (!spec || spec.status === "blocked") {
  return { status: "error", stage: "Spec", error: spec ? spec.detail : "spec writer returned null twice", draftPath: DRAFT_PATH };
}
let specCheck = await reviewSpec("spec-review");
if (specCheck && !specCheck.approved) {
  const specBlocking = specCheck.findings.filter((f) => f.severity === "blocking");
  if (specBlocking.length) {
    log("Spec review: " + specBlocking.length + " blocking finding(s) — one fix round");
    spec = await writeSpec(JSON.stringify(specBlocking), "spec-fix");
    if (!spec || spec.status === "blocked") {
      return { status: "error", stage: "Spec", error: "spec writer failed during fix round", draftPath: DRAFT_PATH };
    }
    specCheck = await reviewSpec("spec-recheck");
    // Fail closed: blocking findings were found, so an unreviewed fix must not exit complete.
    if (!specCheck) {
      return { status: "error", stage: "Spec", draftPath: DRAFT_PATH, error: "spec recheck reviewer returned null twice after a fix round for blocking findings" };
    }
    if (!specCheck.approved && specCheck.findings.some((f) => f.severity === "blocking")) {
      return {
        status: "error",
        stage: "Spec",
        draftPath: DRAFT_PATH,
        error: "spec still blocking after one fix round: " + JSON.stringify(specCheck.findings.filter((f) => f.severity === "blocking")),
      };
    }
  }
}

log("Exit: spec complete at " + SPEC_PATH);
return {
  status: "complete",
  specPath: SPEC_PATH,
  specReviewed: specCheck != null, // false means the reviewer failed twice — spec shipped unreviewed
  minorFindings: specCheck ? (specCheck.findings || []).filter((f) => f.severity === "minor") : [],
};
