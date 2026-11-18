# build-task spec script — usage reference

Design pipeline, phase 3 of 3: Write spec → Spec review → at most one fix
round → recheck. Turns the decision-complete draft into the spec file the
plan script consumes.

## Invocation

**Primary:** `Workflow({ name: "taskflow:build-task-spec", args })`
with ONE structured `args` object — the script reads it as the global `args`.
The runtime may deliver the object as a JSON string; `decodeArgs` parses that
transparently.

**Fallback** — only when the return is `stage: 'args'` and its `error` starts
with `args global is undefined`: Read `<PLUGIN_ROOT>/workflows/build-task-spec.workflow.js`, prepend
exactly one line after the `meta` block — `const args = { … }` as a JSON object
literal — and submit the whole text via the Workflow tool's `script`
parameter, without the tool-level `args` parameter. Any other
`stage: 'args'` error means a malformed payload: fix the call.

No plugin agent dependency: the spec writer and spec reviewer are inline
agents.

## Parameters (`args` object)

| Key          | Type   | Required | Meaning                                                                                   |
| :----------- | :----- | :------- | :---------------------------------------------------------------------------------------- |
| `DRAFT_PATH` | string | yes      | Absolute path of the decision-complete draft (the design script's `complete` `draftPath`) |
| `SPEC_PATH`  | string | yes      | Absolute target path of the spec (input of the plan script)                               |

Guards: missing required keys return `status: 'error', stage: 'args'` before
any agent is dispatched.

## Result (exit contract)

One structured object; `status` is the discriminator. Consume only this return.

### `status: 'complete'`

| Field           | Meaning                                                                                                                                                                                       |
| :-------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `specPath`      | The finished spec (all draft decisions carried over, no open questions, `## Global Constraints` included)                                                                                     |
| `specReviewed`  | `true` unless the first-pass spec reviewer failed twice (both attempts returned null) — `false` means the spec shipped without the completeness/ambiguity gate; note this in the final report |
| `minorFindings` | Array of non-blocking spec-review findings — for the final report                                                                                                                             |

### `status: 'error'`

| `stage` | Meaning                                                                                                                                 | Action                                                          |
| :------ | :-------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------- |
| `args`  | Invocation malformed, or `args global is undefined`                                                                                     | Fallback for `args global is undefined`; otherwise fix the call |
| `Spec`  | Spec writer null/blocked twice, blocking findings survived the fix round, or the recheck reviewer returned null twice after a fix round | Surface `error` + `draftPath`, stop                             |

## Behavior notes

- The spec is written ENTIRELY in English regardless of the draft's language,
  carries every draft decision and the draft's lean/YAGNI decisions forward,
  and adds nothing new.
- After an intent correction, build-task re-runs the design script and then
  this script; the spec is rewritten in place at the same `SPEC_PATH`.
- The draft is left in place — context for the delivery scripts.
- Models: spec writer and spec reviewer on the `sonnet` alias.
