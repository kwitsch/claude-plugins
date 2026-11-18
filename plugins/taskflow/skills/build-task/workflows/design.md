# build-task design script — usage reference

Design pipeline, phase 2 of 3: Draft design → Design review → at most one
revision round → recheck. Reads the exploration file the explore script wrote;
exits with a decision-complete draft (`complete`) or pauses with open user
questions (`user_input_required`, resumable any number of times). `GRAPHMIND_AVAILABLE` only adds a hint to the designer and design-reviewer prompts.

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

Role agents: the designer and the design reviewer are plugin agents
(`taskflow:designer`, `taskflow:design-reviewer`, `agents/`), dispatched via
`agentType`; the script's `model` option overrides their frontmatter model.

## Parameters (`args` object)

| Key                   | Type    | Required | Meaning                                                                                                                                                                    |
| :-------------------- | :------ | :------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TASK`                | string  | yes      | The design task / work description (same text as the explore call)                                                                                                         |
| `EXPLORE_PATH`        | string  | yes      | Absolute path of the exploration file the explore script wrote — same path on every resume                                                                                 |
| `DRAFT_PATH`          | string  | yes      | Absolute path of the draft file — the single persistent state between runs; same path on every resume                                                                      |
| `SIZE`                | string  | no       | `''` (default). Task size `S` / `M` / `L` / `XL` from build-task's size step (case-insensitive); picks the designer model                                                  |
| `GRAPHMIND_AVAILABLE` | boolean | no       | `false` (default). `true` ⇒ the designer and the design reviewer get a hint to use the graphmind MCP tools (`project` as given). Requires a non-empty absolute `REPO_PATH` |
| `REPO_PATH`           | string  | no       | `''` (default). Absolute checkout root (`git rev-parse --show-toplevel`). **Required when `GRAPHMIND_AVAILABLE` is `true`**                                                |
| `RESUME`              | boolean | no       | `false` (default) on the first run; `true` when restarting with an existing draft + answers                                                                                |
| `USER_INPUT`          | string  | no       | `''` (default) on the first run; on resume: the answers to the previously returned questions — BINDING. Recommended shape: JSON `[{id, answer}]`                           |

Guards: missing required keys, `RESUME: true` without `USER_INPUT`, or a
return `status: 'error', stage: 'args'` before any agent is dispatched.

## Result (exit contract)

One structured object; `status` is the discriminator. Consume only this return.

### `status: 'complete'` — draft decision-complete

| Field           | Meaning                                                                                                  |
| :-------------- | :------------------------------------------------------------------------------------------------------- |
| `draftPath`     | The decision-complete draft (no open user questions) — the spec script's `DRAFT_PATH`                    |
| `keypoints`     | The Keypoints section verbatim — present this to the user for approval                                   |
| `minorFindings` | Array of non-blocking design-review findings (`{severity: 'minor', description}`) — for the final report |

### `status: 'user_input_required'` — open user questions

| Field       | Meaning                                                                                                                    |
| :---------- | :------------------------------------------------------------------------------------------------------------------------- |
| `draftPath` | Complete draft persisted (incl. `## Open questions` and `## Decisions & assumptions`) — restart state                      |
| `keypoints` | Current Keypoints — usable as context when asking the user                                                                 |
| `questions` | ≤4 entries `{id, question, options[2-4], whyItMatters}` — AskUserQuestion-ready; free text arrives via "Other"             |
| `resume`    | Restart instruction: re-run with `RESUME: true`, the same `DRAFT_PATH` and `EXPLORE_PATH`, and the answers as `USER_INPUT` |

New genuine questions after a resume are expected, not a failure — the loop
repeats until `complete` or `error`.

### `status: 'error'`

| `stage`  | Meaning                                                                                                   | Action                                                               |
| :------- | :-------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------- |
| `args`   | Invocation malformed (missing keys, `RESUME` without `USER_INPUT`) or `args global is undefined`          | Fallback for `args global is undefined`; otherwise fix the call      |
| `Design` | Designer null/blocked twice, design reviewer null twice, or blocking findings survived the revision round | Surface `error` + `draftPath` (draft preserved for inspection), stop |

## Behavior notes

- Answers passed via `USER_INPUT` are recorded as `USER DECISION` in the draft
  and are binding — the design reviewer flags any reversal as blocking.
- Question bar is high: questions the reviewer judges resolvable from the code
  are decided by the designer in one revision round, not returned to the user.
- Explore is not re-run on resume: the designer re-reads the same exploration
  file and uses its own Read/Grep for areas the answers newly touch.
- Model assignment: designer model from `SIZE` — `S` → `sonnet`, `M` and `L` →
  `opus`, `XL` → `fable`, unset or unknown → `opus`; a `fable` dispatch that
  throws (no Fable access) falls back to `opus` for the rest of the run.
  Design reviewer on the `sonnet` alias.
- The design reviewer's tool allowlist (agent frontmatter) is Read/Grep/Glob/
  Bash plus ToolSearch and the graphmind tools; read-only for files is an
  instruction (Bash can still write).
