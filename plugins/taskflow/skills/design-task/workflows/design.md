# design-task design script — usage reference

The design pipeline of the `design-task` skill in five Workflow phases:
`Scout` picks 1-4 lenses → `Explore` runs one read-only explorer per lens
(parallel, each job labelled with its lens name) plus, on the graphmind path
only, the project-memory recall labelled `graphmind memory` → `Scribe`: the
`taskflow:explore-scribe` agent writes the exploration reports to
`EXPLORE_PATH` and reads them back → `Size`: one agent sizes the task with the
`mcp__taskflow__size-task` tool → `Design`: the designer writes the draft to
`DRAFT_PATH`, the design reviewer checks it, at most one revision round and a
recheck follow. Every run is a full run; design-task never reads either file.
`GRAPHMIND_AVAILABLE` only adds a hint to the designer and design-reviewer prompts (and moves the explorers to the graphmind path).

## Invocation

**Primary:** `Workflow({ name: "taskflow:build-task-design", args })`
with ONE structured `args` object — the script reads it as the global `args`.
The runtime may deliver the object as a JSON string; `decodeArgs` parses that
transparently.

**Fallback** — only when the return is `stage: 'args'` and its `error` starts
with `args global is undefined`: Read `<PLUGIN_ROOT>/workflows/build-task-design.workflow.js`, prepend
exactly one line after the `meta` block — `const args = { … }` as a JSON object
literal — and submit the whole text via the Workflow tool's `script`
parameter, without the tool-level `args` parameter. Any other
`stage: 'args'` error means a malformed payload: fix the call.

Agents: the scribe is `taskflow:explore-scribe` (Read and Write only); the
designer and the design reviewer are `taskflow:designer` and
`taskflow:design-reviewer`. All three are dispatched via `agentType`; the
script's `model` option overrides their frontmatter model. The scout and
(without graphmind) the explorers use the built-in `Explore` agent; the
memory recall, the graphmind explorers and the size agent are inline.

## Parameters (`args` object)

| Key                   | Type    | Required | Meaning                                                                                                                                                                                                                                 |
| :-------------------- | :------ | :------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TASK`                | string  | yes      | The design task text: the prompt, plus `Exploration focus: …` and `Binding user decisions from earlier rounds: …` when design-task runs the script again                                                                                |
| `EXPLORE_PATH`        | string  | yes      | Absolute path of the exploration file to write (`<session temp>/explore-<slug>.md`, create/overwrite)                                                                                                                                   |
| `DRAFT_PATH`          | string  | yes      | Absolute path of the draft file to write (`<session temp>/draft-<slug>.md`, create/overwrite)                                                                                                                                           |
| `GRAPHMIND_AVAILABLE` | boolean | no       | `false` (default). `true` ⇒ the per-lens explorers use the graphmind MCP tools (`mcp__graphmind__gm_*`, default subagent), one memory-recall agent runs, and the designer and design reviewer get a graphmind hint (`project` as given) |
| `REPO_PATH`           | string  | no       | `''` (default). Absolute repo root (`git rev-parse --show-toplevel`), passed as graphmind's `project`. **Required when `GRAPHMIND_AVAILABLE` is `true`**                                                                                |

Guards: missing required keys, a non-absolute `EXPLORE_PATH` or `DRAFT_PATH`,
or `GRAPHMIND_AVAILABLE: true` with an empty or non-absolute `REPO_PATH`
return `status: 'error', stage: 'args'` before any agent is dispatched.

## Phases and models

| Phase     | Agents                                                                     | Model                                     |
| :-------- | :------------------------------------------------------------------------- | :---------------------------------------- |
| `Scout`   | scout (built-in `Explore` agent)                                           | `haiku`                                   |
| `Explore` | one explorer per lens; the `graphmind memory` recall on the graphmind path | `haiku`                                   |
| `Scribe`  | `taskflow:explore-scribe`                                                  | `haiku`                                   |
| `Size`    | inline size agent calling `mcp__taskflow__size-task`                       | `haiku`                                   |
| `Design`  | `taskflow:designer`, `taskflow:design-reviewer`                            | designer from the size; reviewer `sonnet` |

- Designer model from the size: `S` → `sonnet`, `M` and `L` → `opus`, `XL` →
  `fable`, unknown → `opus`. A `fable` dispatch that throws (no Fable access)
  falls back to `opus` for the rest of the run; a null result on `fable` is
  retried on `opus`.
- A failed explore phase does not end the run before `Size`: a `Scout`
  failure skips `Explore` and `Scribe`, an `Explore` failure skips `Scribe`;
  the run then returns `blocked` (case E1) after `Size`, without `Design`.

## Exploration file

- Content: `# Exploration reports`, then one block per Explore job (each lens,
  plus `graphmind memory` on the graphmind path): a `## Lens: <name>` line,
  the report, and an `_End of lens: <name>_` line. A failed explorer and an
  empty memory recall get no block. The script builds these lines; the
  scribe copies them.
- The scribe copies the script-built text through a model, with the Write tool
  (one retry), then Reads the file back in full and returns the lens names of
  the `## Lens: <name>` headers and `_End of lens: <name>_` footers it found.
  The phase fails unless the headers and the footers equal the expected
  lenses exactly, in order; a missing trailing footer catches truncation. The
  retry only re-reads a file that was written and rewrites one that was not.
  An alteration inside a lens body is not caught.

## Size

- The size agent loads `mcp__taskflow__size-task` with `ToolSearch` and calls
  it with `task` = `TASK` verbatim and `subsystems` = one `<name> — <focus>`
  string per scout lens (omitted when the scout failed). It returns `size`
  (the result's leading letter, `S`, `M`, `L` or `XL`) and `line` (the result
  text verbatim).
- Tool missing or an error result: the agent sizes by its own reasoning with
  the same rubric (`S` one single edit in one place, `M` a feature or fix with
  tests inside one plugin, `L` several distinct parts, a whole plugin or two
  to four plugins, `XL` repository-wide); `line` = `<X> (own reasoning: <reason>)`.
- No result twice → `size` `M`, `sizeLine` `M (size agent returned no result; default)`.
  Sizing never fails the run.

## Result (exit contract)

One structured object; `status` is the discriminator. Consume only this
return. Every return except `error` carries `explorePath` (= `EXPLORE_PATH`),
`exploreWritten` (`true` when the exploration file passed the scribe check),
`size`, `sizeLine` and `draftPath` (= `DRAFT_PATH`).

### `status: 'complete'` — draft decision-complete

| Field               | Meaning                                                                                                  |
| :------------------ | :------------------------------------------------------------------------------------------------------- |
| `explorePath`       | The written exploration file — never read it in the skill                                                |
| `subsystems`        | `[{name, focus}]` — the explored lenses                                                                  |
| `size` / `sizeLine` | Size letter and the printable size line (`Size: <sizeLine>`)                                             |
| `draftPath`         | The decision-complete draft (no open user questions) — the spec script's `DRAFT_PATH`                    |
| `keypoints`         | The Keypoints section verbatim — content of the intent acceptance                                        |
| `minorFindings`     | Array of non-blocking design-review findings (`{severity: 'minor', description}`) — for the final report |

### `status: 'blocked'` — a decision is needed

| Field       | Meaning                                                                                                                                          |
| :---------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage`     | `Explore` or `Design`                                                                                                                            |
| `reason`    | Why the run stopped                                                                                                                              |
| `keypoints` | Current Keypoints — only for open design questions (D4)                                                                                          |
| `questions` | 1-4 entries `{id, question, options[2-4], whyItMatters}` — decide-ready; map `whyItMatters` to decide's `context`; free text arrives via "Other" |

| Case | Trigger                                                      | `reason`                                                                                     | `questions`                                                                                                      |
| :--- | :----------------------------------------------------------- | :------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| E1   | `Scout`, `Explore` or `Scribe` failed                        | `<stage>: <error>`                                                                           | `explore`: options `Re-run explore`, `Stop`; a free-text answer is the exploration focus                         |
| D1   | designer blocked or no usable result (first run or revision) | the designer's `detail`, `designer returned null twice` or `designer failed during revision` | `design-blocked`: options `Re-run explore`, `Retry the design`, `Stop`                                           |
| D2   | design reviewer returned nothing twice (review or recheck)   | `design reviewer returned null twice` or `design reviewer failed on recheck`                 | `review-failed`: options `Retry the design`, `Re-run explore`, `Stop`                                            |
| D3   | blocking findings after the revision round                   | `design still blocking after one revision`                                                   | `findings` (the question text carries the blocking findings as JSON): options `Run another design round`, `Stop` |
| D4   | genuine open design questions                                | `open design questions`                                                                      | the designer's genuine questions unchanged (at most 4), plus `keypoints`                                         |

E1 stage failures:

| `stage`   | Meaning                                                                                                                                               |
| :-------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Scout`   | The scout returned no result, or named a lens `graphmind memory` (reserved for the memory recall)                                                     |
| `Explore` | All explorers returned null                                                                                                                           |
| `Scribe`  | After one retry, the written file's lens headers or footers differ from the expected lenses (missing, extra, other order), or it could not be written |

### `status: 'error'`

| `stage` | Meaning                                                               | Action                                                          |
| :------ | :-------------------------------------------------------------------- | :-------------------------------------------------------------- |
| `args`  | Invocation malformed, or `args global is undefined` (threading quirk) | Fallback for `args global is undefined`; otherwise fix the call |

## Behavior notes

- The question bar is high: questions the reviewer judges resolvable from the
  code are decided by the designer in the one revision round, not returned.
- User decisions recorded in the draft are binding; the design reviewer flags
  any reversal as blocking.
- A full run overwrites both files; earlier decisions reach the designer only
  through `TASK`.
- The design reviewer's tool allowlist (agent frontmatter) is Read/Grep/Glob/
  Bash plus ToolSearch and the graphmind tools; read-only for files is an
  instruction (Bash can still write).
- design-task answers non-explore decisions by dispatching `taskflow:designer` itself (SKILL.md step 5), never by re-running this script's Design stage.
