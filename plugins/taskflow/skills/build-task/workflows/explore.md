# build-task explore script — usage reference

Design pipeline, phase 1 of 3: scout → 1-4 read-only explorers (parallel) →
graphmind project-memory recall (graphmind path only) → a scribe agent writes
the exploration reports to `EXPLORE_PATH`. build-task never reads that file;
it passes the path on to the design script.

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

No plugin agent dependency: every agent is dispatched inline. The scout and
(without graphmind) the explorers use the built-in `Explore` agent.

## Parameters (`args` object)

| Key                   | Type    | Required | Meaning                                                                                                                                                                                                   |
| :-------------------- | :------ | :------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TASK`                | string  | yes      | The design task / work description                                                                                                                                                                        |
| `EXPLORE_PATH`        | string  | yes      | Absolute path of the exploration file to write (`<session temp>/explore-<slug>.md`, create/overwrite)                                                                                                     |
| `GRAPHMIND_AVAILABLE` | boolean | no       | `false` (default). When `true`, the per-subsystem explorers use the graphmind MCP tools (`mcp__graphmind__gm_*`, default subagent) and one memory-recall agent runs; otherwise the built-in Explore agent |
| `REPO_PATH`           | string  | no       | `''` (default). Absolute repo root (`git rev-parse --show-toplevel`), passed as graphmind's `project`. **Required when `GRAPHMIND_AVAILABLE` is `true`**                                                  |

Guards: missing required keys, or `GRAPHMIND_AVAILABLE: true` with an empty or
non-absolute `REPO_PATH`, return `status: 'error', stage: 'args'` before any
agent is dispatched.

## Result (exit contract)

One structured object; `status` is the discriminator. Consume only this return.

### `status: 'complete'`

| Field         | Meaning                                                                                                    |
| :------------ | :--------------------------------------------------------------------------------------------------------- |
| `explorePath` | The written exploration file (= `EXPLORE_PATH`) — pass it to the design script; never read it in the skill |
| `subsystems`  | `[{name, focus}]` — the 1-4 explored areas; build-task sizes the task from these plus the task text        |

### `status: 'error'`

| `stage`   | Meaning                                                                                                                                                                    | Action                                                                  |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| `args`    | Invocation malformed, or `args global is undefined` (threading quirk)                                                                                                      | Fallback for `args global is undefined`; otherwise fix the call         |
| `Explore` | Scout returned no result, all explorers returned null, or the scribe could not write `EXPLORE_PATH` intact (first attempt below 90% of the expected size, retry not exact) | Surface `stage` + `error` and stop; no file path is passed on to Design |

## Behavior notes

- Runs once per build-task invocation; resumes and intent corrections re-run
  only the design (and spec) script, which read the same file.
- File content: `# Exploration reports`, one `## <area>` section per
  explorer report, and — graphmind path only, when memory recall found
  anything — `## Recorded project knowledge (graphmind memory)`.
- Models: scout, explorers, memory recall and scribe on the `haiku` alias.
- The scribe copies the text through a model, writing with the Write tool
  (one retry, same method), and reports the size from a separate `wc -c`; the
  script fails only when that is below 90% of the expected UTF-8 byte length
  (after the retry: `stage: 'Explore'`). Oversize passes; a same-size or
  slightly shorter alteration is not caught.
