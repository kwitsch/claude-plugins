# /taskflow:design-to-spec — usage reference

Design pipeline: Explore → Draft design → Design review → Write spec → Spec
review. Turns a design task into a spec file ready for approval, or pauses
with open user questions (resumable any number of times).

## Invocation

**Primary:** run the plugin workflow `/taskflow:design-to-spec` with ONE
structured `args` object — the script reads it as the global `args`.

**Fallback** (workflow not registered): read
`${CLAUDE_PLUGIN_ROOT}/workflows/design-to-spec.workflow.js`, prepend exactly
one line after the `meta` block — `const args = { … }` as a JSON object
literal — and submit the whole text via the Workflow tool's `script`
parameter. NEVER pass the tool-level `args` parameter on an ad-hoc `{script}`
call: the global arrives `undefined` there (docs scope `args` to saved
workflows); the template's `decodeArgs` guard turns that into an immediate
`status: 'error', stage: 'args'` return.

Agent dependency: the static role prompts live in this plugin's `agents/`
directory and are addressed via `agentType` (namespaced `taskflow:<name>`;
rename together with the plugin). An unknown type throws hard at dispatch
("agent type 'X' not found. Available agents: ..."), so both invocation paths
— named AND ad-hoc fallback — require the plugin's agents to be loaded.

## Parameters (`args` object)

| Key          | Type    | Required | Meaning                                                                                                                                          |
| :----------- | :------ | :------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| `TASK`       | string  | yes      | The design task / work description                                                                                                               |
| `DRAFT_PATH` | string  | yes      | Absolute path of the draft file — the single persistent state between runs; same path on every resume                                            |
| `SPEC_PATH`  | string  | yes      | Absolute target path of the spec (input contract of `/taskflow:spec-driven-delivery`)                                                            |
| `RESUME`     | boolean | no       | `false` (default) on the first run; `true` when restarting with an existing draft + answers                                                      |
| `USER_INPUT` | string  | no       | `''` (default) on the first run; on resume: the answers to the previously returned questions — BINDING. Recommended shape: JSON `[{id, answer}]` |

Guards: missing required keys or `RESUME: true` without `USER_INPUT` return
`status: 'error', stage: 'args'` before any agent is dispatched.

Delivery format (primary/named-workflow invocation): the runtime may hand
`args` to the script as a JSON STRING depending on the invocation path —
`decodeArgs` parses string deliveries (including double-encoded)
transparently. On this path, a `stage: 'args'` error always means genuinely
malformed input (free text, array, missing keys), never a threading quirk —
fix the payload; do not switch to the fallback. On the ad-hoc fallback path,
the same `stage: 'args'` error can ALSO mean the threading quirk described
above (the tool-level `args` parameter was passed instead of prepending
`const args = {…}` to the script text) — check the invocation shape first
before assuming malformed content.

## Result (exit contract)

The workflow returns ONE structured object; `status` is the discriminator.
Consume only this return — never re-derive state from transcript output.

### `status: 'complete'` — Exit 1: design fully written to spec

| Field           | Meaning                                                                                                                                                                            |
| :-------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `specPath`      | The finished spec (all draft decisions carried over, no open questions, `## Global Constraints` included)                                                                          |
| `draftPath`     | The draft is left in place — context for the delivery workflow's review synthesis                                                                                                  |
| `keypoints`     | The Keypoints section verbatim — present this to the user for approval (the spec is NOT yet approved)                                                                              |
| `specReviewed`  | `true` unless the spec reviewer failed twice (both attempts returned null) — `false` means the spec shipped without the completeness/ambiguity gate; note this in the final report |
| `minorFindings` | `{design: [], spec: []}` — non-blocking reviewer findings, for the final report                                                                                                    |

### `status: 'user_input_required'` — Exit 2: open user questions

| Field       | Meaning                                                                                                        |
| :---------- | :------------------------------------------------------------------------------------------------------------- |
| `draftPath` | Complete draft persisted (incl. `## Open questions` and `## Decisions & assumptions`) — restart state          |
| `keypoints` | Current Keypoints — usable as context when asking the user                                                     |
| `questions` | ≤4 entries `{id, question, options[2-4], whyItMatters}` — AskUserQuestion-ready; free text arrives via "Other" |
| `resume`    | Restart instruction: re-run with `RESUME: true`, the same `DRAFT_PATH`, and the answers as `USER_INPUT`        |

New genuine questions after a resume are expected, not a failure — the loop
repeats until `complete` or `error`.

### `status: 'error'`

| `stage`   | Meaning                                                            | Action                                                         |
| :-------- | :----------------------------------------------------------------- | :------------------------------------------------------------- |
| `args`    | Invocation malformed (no/missing args, RESUME without USER_INPUT)  | Fix the call — do not debug the pipeline                       |
| `Explore` | Scout or all explorers returned null                               | Retry once; then surface                                       |
| `Design`  | Designer blocked, or blocking findings survived the revision round | Surface `error` + `draftPath` (draft preserved for inspection) |
| `Spec`    | Spec writer blocked, or blocking findings survived the fix round   | Surface `error` + `draftPath`                                  |

## Behavior notes

- Answers passed via `USER_INPUT` are recorded as `USER DECISION` in the draft
  and are binding — the design reviewer flags any reversal as blocking.
- Question bar is high: questions the reviewer judges resolvable from the code
  are decided by the designer in one revision round, not returned to the user.
- Model assignment (fixed in template + agent frontmatter): designer pinned to
  `claude-opus-4-8`; design reviewer on the `sonnet` alias (= newest Sonnet;
  judgment-heavy question validation); explorers, spec writer, and spec
  reviewer pinned to `claude-sonnet-4-6` (mechanical/faithful work);
  classification on `haiku` (scout).
