# build-task explore script — usage reference

Design pipeline, phase 1 of 3, in three Workflow phases: `Scout` picks 1-4
lenses → `Explore` runs one read-only explorer per lens (parallel, each job
labelled with its lens name) plus, on the graphmind path only, the
project-memory recall labelled `graphmind memory` → `Scribe`: the
`taskflow:explore-scribe` agent writes the exploration reports to
`EXPLORE_PATH` and reads them back. build-task never reads that file; it
passes the path on to the design script.

## Invocation

**Primary:** `Workflow({ name: "taskflow:build-task-explore", args })`
with ONE structured `args` object — the script reads it as the global `args`.
The runtime may deliver the object as a JSON string; `decodeArgs` parses that
transparently.

**Fallback** — only when the return is `stage: 'args'` and its `error` starts
with `args global is undefined`: Read `<PLUGIN_ROOT>/workflows/build-task-explore.workflow.js`, prepend
exactly one line after the `meta` block — `const args = { … }` as a JSON object
literal — and submit the whole text via the Workflow tool's `script`
parameter, without the tool-level `args` parameter. Any other
`stage: 'args'` error means a malformed payload: fix the call.

One plugin agent: the scribe is `taskflow:explore-scribe` (Read and Write only). The scout and (without graphmind) the explorers use the built-in `Explore` agent.

## Parameters (`args` object)

| Key                   | Type    | Required | Meaning                                                                                                                                                                                              |
| :-------------------- | :------ | :------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TASK`                | string  | yes      | The design task / work description                                                                                                                                                                   |
| `EXPLORE_PATH`        | string  | yes      | Absolute path of the exploration file to write (`<session temp>/explore-<slug>.md`, create/overwrite)                                                                                                |
| `GRAPHMIND_AVAILABLE` | boolean | no       | `false` (default). When `true`, the per-lens explorers use the graphmind MCP tools (`mcp__graphmind__gm_*`, default subagent) and one memory-recall agent runs; otherwise the built-in Explore agent |
| `REPO_PATH`           | string  | no       | `''` (default). Absolute repo root (`git rev-parse --show-toplevel`), passed as graphmind's `project`. **Required when `GRAPHMIND_AVAILABLE` is `true`**                                             |

Guards: missing required keys, or `GRAPHMIND_AVAILABLE: true` with an empty or
non-absolute `REPO_PATH`, return `status: 'error', stage: 'args'` before any
agent is dispatched.

## Result (exit contract)

One structured object; `status` is the discriminator. Consume only this return.

### `status: 'complete'`

| Field         | Meaning                                                                                                    |
| :------------ | :--------------------------------------------------------------------------------------------------------- |
| `explorePath` | The written exploration file (= `EXPLORE_PATH`) — pass it to the design script; never read it in the skill |
| `subsystems`  | `[{name, focus}]` — the 1-4 explored lenses; build-task sizes the task from these plus the task text       |

### `status: 'error'`

| `stage`   | Meaning                                                                                                                                               | Action                                                                  |
| :-------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| `args`    | Invocation malformed, or `args global is undefined` (threading quirk)                                                                                 | Fallback for `args global is undefined`; otherwise fix the call         |
| `Scout`   | The scout returned no result, or named a lens `graphmind memory` (reserved for the memory recall)                                                     | Surface `stage` + `error` and stop; no file path is passed on to Design |
| `Explore` | All explorers returned null                                                                                                                           | Surface `stage` + `error` and stop; no file path is passed on to Design |
| `Scribe`  | After one retry, the written file's lens headers or footers differ from the expected lenses (missing, extra, other order), or it could not be written | Surface `stage` + `error` and stop; no file path is passed on to Design |

## Behavior notes

- Runs once per build-task invocation; resumes and intent corrections re-run
  only the design script, which reads the same file.
- File content: `# Exploration reports`, then one block per Explore job (each
  lens, plus `graphmind memory` on the graphmind path): a `## Lens: <name>`
  line, the report, and an `_End of lens: <name>_` line. A failed explorer
  and an empty memory recall get no block. The script builds these lines; the
  scribe copies them.
- Models: scout, explorers, memory recall and scribe on the `haiku` alias.
- The scribe copies the script-built text through a model, with the Write tool
  (one retry), then Reads the file back in full and returns
  the lens names of the `## Lens: <name>` headers and `_End of lens: <name>_`
  footers it found. The script fails (`stage: 'Scribe'`) unless the headers and the
  footers equal the expected lenses exactly, in order; a missing trailing
  footer catches truncation. The retry only re-reads a file that was written
  and rewrites one that was not. An alteration inside a lens body is not
  caught.
