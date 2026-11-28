---
name: spec-task
description: >-
  Internal step of taskflow's build-task: turns an approved design draft into
  a reviewed spec. Takes the draft path plus optional --headless and
  --size=S|M|L|XL and returns the spec path. Invoked by build-task; not for
  direct use.
argument-hint: "[--headless] [--size=S|M|L|XL] <draft path>"
allowed-tools: ["Read", "Workflow", "ToolSearch", "Skill", "mcp__taskflow__size-task"]
---

# spec-task — approved draft to reviewed spec

Turns the approved design draft at the given absolute path into a reviewed
spec next to it. It runs the workflow script `taskflow:build-task-spec`,
routes every conflict and every blocking finding left after the correction
round through `taskflow:decide`, accepts the spec at size `L`/`XL` and ends
with one `RESULT:` line. Contract:
`[--headless] [--size=S|M|L|XL] <absolute input path>`. build-task calls it as
its step 4. This skill runs inline: it calls the Workflow and Skill tools and
must keep their results, so never run it as a forked context.

## Plugin context

Plugin root: ${CLAUDE_PLUGIN_ROOT}

The `Plugin root:` value above is a plain text substitution, used only by the
args fallback of step 4. Empty or unresolved → that fallback is unavailable;
report the args error instead.

> **Every decision goes through the `taskflow:decide` skill:**
> `Skill(skill: "taskflow:decide", args: "[--headless] <JSON>")`, with
> `--headless` exactly when this run got it (`HEADLESS`, step 1), where
> `<JSON>` is one object
> `{"content": [<strings>], "questions": [{"id", "question", "options", "context"}]}`
> (1-4 questions, 2-4 options each, `context` optional);
> never ask in plain prose and never call `AskUserQuestion` directly.
> Use the answers from its final `DECISIONS:` line (`[{id, answer}]`). A
> decide output starting `decide:` → print `spec-task: <that output>` as the
> last line and stop.

Every stop below ends with one last line starting `spec-task: ` and no
`RESULT:` line. Input and output files stay on disk.

## 1. Parse

`$ARGUMENTS` may hold `--headless`, one `--size=<v>` token and the input path,
in any order. Strip `--headless` first (sets `HEADLESS`), then the
`--size=<v>` token. `<v>` uppercased must be `S`, `M`, `L` or `XL`; anything
else → stop with the last line `spec-task: Invalid --size "<v>": use S, M, L or XL.`
and do nothing else. Set `SIZE` to the uppercased value, or leave it unset
when the token is absent.

The remainder, trimmed, is `INPUT_PATH`:

- empty → last line `spec-task: missing input file path`, stop;
- not starting with `/` → `spec-task: input path must be absolute: <INPUT_PATH>`, stop;
- Read the first 200 lines of `INPUT_PATH` (`limit: 200`: enough for the
  existence check and the `Keypoints` and `Goal` sections; never the whole
  file, the pipeline files stay out of this conversation); the read fails or
  returns nothing → `spec-task: cannot read input file <INPUT_PATH>`, stop.

## 2. Output path

`DIR` = the directory of `INPUT_PATH`. `BASE` = its file name without a
trailing `.md` and with one leading `draft-` stripped. `OUTPUT_PATH` =
`<DIR>/spec-<BASE>.md`, so build-task's `draft-<slug>.md` becomes
`spec-<slug>.md`. `OUTPUT_PATH` equal to `INPUT_PATH` →
`spec-task: output path would overwrite the input: <INPUT_PATH>`, stop.

## 3. Size

- With `--size`: print `Size: <SIZE> (from --size)`.
- Otherwise `ToolSearch(query: "select:mcp__taskflow__size-task")`, then call
  `mcp__taskflow__size-task` with no `subsystems` and `task` = the input's
  `Keypoints` section followed by its `Goal` section (from the step-1 read).
  When neither section exists, pass the whole input text. The result starts
  with the letter: `SIZE` = `S`, `M`, `L` or `XL`; print one line
  `Size: <result>`.
- Tool missing or an error result: decide `SIZE` yourself from the same
  input — `S` one single edit in one place, `M` a feature or fix with tests
  inside one plugin, `L` several distinct parts, a whole plugin or two to four
  plugins, `XL` repository-wide — and print
  `Size: <X> (own reasoning: <reason>)`. No retry; sizing never fails the run.

## 4. Run the spec script

Read the usage reference [workflows/spec.md](workflows/spec.md) before the
first call.

1. `ToolSearch(query: "select:Workflow")` once. Tool absent →
   `spec-task: Workflow tool unavailable`, stop.
2. `Workflow({name: "taskflow:build-task-spec", args})` with ONE structured
   `args` object `{DRAFT_PATH: INPUT_PATH, SPEC_PATH: OUTPUT_PATH, USER_INPUT}`.
   `USER_INPUT` is `''` on the first run. Never use `scriptPath`: the plugin
   cache is not readable for it.
3. Fallback, only when a return is `stage: 'args'` and its `error` starts
   with `args global is undefined`: Read
   `<Plugin root>/workflows/build-task-spec.workflow.js`, prepend exactly one
   line after the `meta` block — `const args = { … }` as a JSON object
   literal — and send the whole text via the `script` parameter, without the
   tool-level `args` parameter. Use it for every later run in this
   invocation. Any other `stage: 'args'` error means a malformed call: fix it.
4. Consume only the structured return.

State held in this running skill: `DECISIONS_SO_FAR`, a list of
`{id, question, answer}` starting empty (`question` is the question text as
asked, so a later resume still shows what a short answer such as "Stop" or
"Resolve it with the smallest change to the input's intent" decided), and
`RESUMES` = 0. A **resume** re-runs item 2
with the same paths and `USER_INPUT` = the JSON string
`{"decisions": DECISIONS_SO_FAR, "findings": <findings of the return that triggered this resume, [] for intent corrections>}`,
and adds 1 to `RESUMES`. Send every decision so far each time. The script is
stateless, and writer and reviewer must both see every binding decision, or
the reviewer re-flags a decided deviation.

**Headless resume cap:** with `HEADLESS`, at most 3 resumes per invocation,
decide-triggered resumes and step-5 corrections together. A 4th needed resume
→ `spec-task: headless spec did not converge after 3 resumes: <OUTPUT_PATH>`,
stop. Interactive runs have no cap.

Branch on `status`:

- `error` → `spec-task: <stage>: <error>` (plus ` draftPath: <draftPath>`
  when present), stop.
- `user_input_required` with `reason: "conflict"` → one question per finding
  of severity `conflict`, numbered by a running `<n>` that is unique within
  this invocation:
  `{"id": "conflict-<n>", "question": "<description> Which resolution applies?", "options": <the finding's options, at most 3, then "Stop">, "context": "Severe conflict: requirements of <INPUT_PATH> force mutually exclusive points into the spec."}`.
  A finding with fewer than 2 options gets
  `"options": ["Resolve it with the smallest change to the input's intent", "Stop"]`.
  `content` = every finding of the return as `<severity>: <description>`. At
  most 4 questions per decide call; more conflicts → further decide calls
  before the resume. Any answer `Stop` →
  `spec-task: stopped by decision on a conflict: <OUTPUT_PATH>`, stop.
  Otherwise append every `{id, question, answer}` to `DECISIONS_SO_FAR` and
  resume.
- `user_input_required` with `reason: "rounds_exhausted"` → one decide call
  with `content` = the blocking findings as `<severity>: <description>` and
  the question
  `{"id": "rounds-<n>", "question": "Blocking findings remain after the correction round. How should the spec continue?", "options": ["Run another correction round", "Accept the spec as is", "Stop"]}`.
  - `Run another correction round` or a free-text answer → append
    `{id, question, answer}` to `DECISIONS_SO_FAR`, resume.
  - `Accept the spec as is` → continue as if `complete`, with
    `REVIEWED` = `true` and the remaining blocking findings added to the
    reported findings; go to step 5. Append `{id, question, answer}` to
    `DECISIONS_SO_FAR` with the accepted findings' descriptions added to
    `answer`, so that a later resume (step 5 corrections) does not re-raise
    them.
  - `Stop` → `spec-task: stopped by decision after the correction round: <OUTPUT_PATH>`, stop.
- `complete` → `REVIEWED` = its `specReviewed`, keep its `minorFindings`, go
  to step 5.

## 5. Acceptance (size L and XL only)

`SIZE` `S` or `M` → step 6. Otherwise:

1. Read the first 200 lines of `OUTPUT_PATH` (`limit: 200`; `Keypoints` is the
   spec's first section).
2. One decide call with `content` = the spec's `Keypoints` bullets, one item
   per bullet, verbatim, and the one question
   `{"id": "intent", "question": "Does this spec match the approved design? Proceed? Picking No requires describing the change.", "options": ["Yes — proceed", "No — needs changes"]}`.
3. By answer:
   - `Yes — proceed` → step 6.
   - Any answer other than the two options is the corrections → append
     `{"id": "intent-<n>", "question": <the intent question>, "answer": <the corrections>}` to
     `DECISIONS_SO_FAR`, resume the script (step 4, resume cap included) with
     `"findings": []`, handle its return as in step 4, then repeat this step
     from the new spec.
   - `No — needs changes` without corrections:
     - Interactive: one clarifying decide call with
       `{"id": "changes", "question": "What should change in the spec?", "options": ["Proceed as written after all", "Describe the change (via Other)"]}`.
       `Proceed as written after all` counts as `Yes — proceed`. The option
       `Describe the change (via Other)` itself → ask that call once more;
       never guess. A free-text answer is the corrections (bullet above).
     - Headless: `spec-task: headless intent check rejected the spec without corrections: <OUTPUT_PATH>`, stop.

## 6. Result

With `HEADLESS`, first repeat every `Decided ...` line that decide printed in
this invocation. The last line is exactly one plain-text line:

`RESULT: {"path": "<OUTPUT_PATH>", "size": "<SIZE>", "reviewed": <REVIEWED>, "findings": [{"severity": "<severity>", "description": "<description>"}, ...]}`

`reviewed` is the JSON boolean `true` or `false`. `findings` = the last
`complete` return's `minorFindings` plus any accepted blocking findings. It is
a real JSON array, never `[object Object]`.
