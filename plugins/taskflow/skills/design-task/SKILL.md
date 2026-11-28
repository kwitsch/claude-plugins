---
name: design-task
description: >-
  Internal step of taskflow's build-task: explores the repository, sizes the
  task and writes an approved design draft. Takes optional --headless and the
  task prompt; returns the explore path, the size and the design path.
  Invoked by build-task; not for direct use.
argument-hint: "[--headless] <task prompt>"
allowed-tools: ["Read", "Bash", "Workflow", "ToolSearch", "Skill", "Agent"]
---

# design-task — task prompt to approved design

Explores the repository for a task prompt, sizes the task and writes a
reviewed design draft with the workflow script `taskflow:build-task-design`,
routes every block of that script through `taskflow:decide`, has the design
accepted and ends with one `RESULT:` line. Contract:
`[--headless] <task prompt>`. build-task calls it as its step 2. This skill
runs inline: it calls the Workflow, Skill and Agent tools and must keep their
results, so never run it as a forked context.

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
> decide output starting `decide:` → print `design-task: <that output>` as the
> last line and stop.

Every stop below ends with one last line starting `design-task: ` and no
`RESULT:` line. A stop after at least one workflow return appends
` (explore: <EXPLORE_PATH>, size: <SIZE>, draft: <DRAFT_PATH>)` to that line.
The exploration and draft files stay on disk.

## 1. Parse

`$ARGUMENTS` may start with `--headless` (a bare flag, recognised only as the
leading token): strip it and set `HEADLESS`. A `--headless` later in the text
is part of the prompt. The remainder, trimmed, is `PROMPT`; read it from
`$ARGUMENTS`, never from a named argument (a named argument gets only the
first word). Empty → last line `design-task: missing task prompt`, stop.

## 2. Context

1. `REPO_PATH` = output of `git rev-parse --show-toplevel` (Bash). The command
   fails → `REPO_PATH` = `''`.
2. `BASE_BRANCH` = short name from `git symbolic-ref refs/remotes/origin/HEAD`,
   fallback `main`.
3. Graphmind probe, once: (a) `ToolSearch(query: "select:mcp__graphmind__gm_search")`
   — the tool's schema present in the result; and (b) `graphmind which` via
   Bash — exit 0 (it prints the registered project slug; exit 1 when the
   checkout is not registered). Both, and a non-empty `REPO_PATH` ⇒
   `GRAPHMIND_AVAILABLE = true`; no schema, `graphmind` not found, exit 1 or an
   empty `REPO_PATH` ⇒ `false`. Hold the value for every workflow run and
   designer dispatch of this invocation; never write it to a file.
4. Directory: `<session scratchpad>/build-task/` from your system prompt's
   scratchpad directory (create the subfolder), the same directory build-task
   uses. Pipeline files are written by agents with the Write tool, and only the
   scratchpad is both outside the checkout and skipped by the formatter hooks.
   Only when no scratchpad is provided, run `mktemp -d -t build-task-XXXXXX`
   once and use that. Neither available → `design-task: no session temp directory`, stop.
5. `<slug>`: `git branch --show-current` is non-empty and not `BASE_BRANCH` →
   that branch name without its `<type>/` prefix; otherwise kebab-case of
   `PROMPT`, at most 40 characters.
6. `EXPLORE_PATH` = `<dir>/explore-<slug>.md`, `DRAFT_PATH` =
   `<dir>/draft-<slug>.md`, both absolute. The skill never Reads these files:
   it passes their paths on, and agents read them.

## 3. State

Held in this running skill:

- `DECISIONS_SO_FAR`: a list of `{id, question, answer}`, starting empty.
  Every design decision goes in with its question text as asked; the control
  answers `Retry the design` and `Run another design round` do not.
- `FOCUS`: the exploration focus, starting empty.
- `RERUNS` = 0. A re-run is every full workflow run after the first (step 4)
  and every designer dispatch (step 5); the one retry inside a dispatch is
  not.
- `SIZE`, `SIZE_LINE`, `KEYPOINTS`; `FINDINGS` = `[]`.

**Headless cap:** before every re-run add 1 to `RERUNS`; with `HEADLESS` and
`RERUNS` = 4 → `design-task: headless design did not converge after 3 re-runs`,
stop, without running it. Interactive runs have no cap.

## 4. Run the workflow

The first run and every full re-run. Read the usage reference
[workflows/design.md](workflows/design.md) before the first call.

1. `ToolSearch(query: "select:Workflow")` once. Tool absent →
   `design-task: Workflow tool unavailable`, stop.
2. `Workflow({name: "taskflow:build-task-design", args})` with ONE structured
   `args` object `{TASK, EXPLORE_PATH, DRAFT_PATH, GRAPHMIND_AVAILABLE, REPO_PATH}`.
   `TASK` = `PROMPT`, then `"\n\nExploration focus: " + FOCUS` when `FOCUS`
   is set, then `"\n\nBinding user decisions from earlier rounds: " +` the
   JSON of `DECISIONS_SO_FAR` when it is non-empty (a full re-run overwrites
   the draft, so earlier decisions travel in the task text). Never use `scriptPath`: the plugin cache is not readable for it.
3. Fallback, only when a return is `stage: 'args'` and its `error` starts
   with `args global is undefined`: Read
   `<Plugin root>/workflows/build-task-design.workflow.js`, prepend exactly one
   line after the `meta` block — `const args = { … }` as a JSON object
   literal — and send the whole text via the `script` parameter, without the
   tool-level `args` parameter. Use it for every later run in this
   invocation. Any other `stage: 'args'` error means a malformed call: fix it.
4. Consume only the structured return. After every `complete` or `blocked`
   return: `SIZE` = its `size`, `SIZE_LINE` = its `sizeLine`, and print one
   line `Size: <sizeLine>`.

Branch on `status`:

- `error` (`stage: 'args'`, not the fallback case) → `design-task: args: <error>`, stop.
- `blocked` → step 6 with the returned `stage`, `reason`, `keypoints` (when
  present) and `questions`.
- `complete` → `KEYPOINTS` = its `keypoints`, `FINDINGS` = its
  `minorFindings`; step 7.

## 5. Designer only

Every decision that is not a re-explore, and every intent correction, is
answered here: this skill starts only the designer. It never runs the
workflow's Design stage again, and the design reviewer does not run on this
path.

Apply the headless cap (step 3). `MODEL` from `SIZE`: `S` → `sonnet`, `M` and
`L` → `opus`, `XL` → `fable`, anything else → `opus`. Dispatch

`Agent(subagent_type: "taskflow:designer", description: "Design revision", model: <MODEL>, prompt: <PROMPT_D>)`

with `PROMPT_D` = the text below, angle-bracket parts filled in:

```text
This is a RESUME run: continue a prior draft using the user's answers.
Task:
<PROMPT>

Draft file to write (create/overwrite): <DRAFT_PATH>
Open-question cap: 4 (2-4 options each).<graphmind hint>
Draft requirements, question bar, and self-review checklist per your role
definition.
## Exploration reports
Read the exploration file at <EXPLORE_PATH> before designing.

## Prior draft
Read the existing draft at <DRAFT_PATH> if it exists — it is your starting point; revise it in place. If it does not exist, produce the first complete draft.

## User answers (BINDING — record each under Decisions & assumptions as
'USER DECISION', remove the answered questions, and never reverse these
decisions later):
<JSON of DECISIONS_SO_FAR>
<revision input>

There is no StructuredOutput tool in this run: your final message is exactly one JSON object {"status": "done" | "blocked", "detail": "...", "keypoints": "...", "openQuestions": [{"id", "question", "options", "whyItMatters"}]} and nothing else; `keypoints` is the Keypoints section verbatim and never contains open questions.
```

- `<graphmind hint>`: empty when `GRAPHMIND_AVAILABLE` is `false`; otherwise
  a blank line followed by
  `Hint: graphmind indexes this repository. Optionally load its tools with ToolSearch(query: "select:mcp__graphmind__gm_search,mcp__graphmind__gm_outline,mcp__graphmind__gm_fn,mcp__graphmind__gm_deps") and use them to verify the files, symbols and signatures the exploration reports mention rather than broad Grep/Read; pass project: "<REPO_PATH>" on every call. Fall back to Read/Grep when a call errors or returns nothing.`
- `<revision input>`: when step 6 came here through the control answer
  `Retry the design` or `Run another design round`, the line `## Revision input`
  followed by the text of each question answered that way (it carries the
  block reason or the blocking findings); otherwise empty.

A dispatch that errors on `fable` is repeated once on `opus`, and `opus`
replaces `fable` for the rest of this invocation.

Check the designer's final message: it parses as one JSON object, has a
`status` of `done` or `blocked`, a string `keypoints` and an array
`openQuestions`, and `keypoints` contains neither `<openQuestions` nor
`</invoke`. A failed check → one more dispatch with the same prompt (not
counted as a re-run); failed again → treat it as
`{"status": "blocked", "detail": "designer returned no usable result twice"}`.
Then:

- `blocked` → step 6 with `stage` = `Design`, `reason` = its `detail`, and
  `questions` = `[{"id": "design-blocked", "question": "The designer is blocked: <reason>. How should the design continue?", "options": ["Re-run explore", "Retry the design", "Stop"], "whyItMatters": "Re-run explore explores again with this reason as focus; Retry or a free-text answer starts the designer again with that answer."}]`.
- `done` with a non-empty `openQuestions` → step 6 with `stage` = `Design`,
  `reason` = `open design questions`, its `keypoints`, and `questions` = its
  first 4 `openQuestions`.
- `done` with an empty `openQuestions` → `KEYPOINTS` = its `keypoints`;
  step 7. `FINDINGS` keeps its value (no review on this path).

## 6. Decide

One decide call: `content` = [`<stage>: <reason>`], followed by the
`keypoints` bullets, one item per bullet, verbatim, when present; `questions`
= the questions, each mapped to `{id, question, options, context: whyItMatters}`
(options verbatim). Then, from `DECISIONS`, the first matching rule wins:

1. Any answer `Stop` → `design-task: stopped by decision on <id>`, stop.
2. The `explore` question is answered → full re-run (step 4, headless cap
   first). The answer `Re-run explore` keeps `FOCUS`; a free-text answer sets
   `FOCUS` = that text.
3. Any answer `Re-run explore` → when it answers `design-blocked`, `FOCUS` =
   the current `FOCUS` (when set) followed by `reason`; for any other question
   `FOCUS` stays as it is (its `reason` is no exploration focus); full re-run
   (step 4, headless cap first).
4. Otherwise → append every answer except the control answers
   `Retry the design` and `Run another design round` to `DECISIONS_SO_FAR` as
   `{id, question, answer}` (`question` = the question text as asked); keep
   the questions answered with a control answer as the revision input;
   step 5 (designer only).

## 7. Acceptance

One decide call with `content` = the `KEYPOINTS` bullets, one item per bullet,
verbatim (the user has never seen the temp files; decide shows them as a
bullet list), and the one question
`{"id": "intent", "question": "Does this match the intended design? Proceed to implementation? Picking No requires describing the change.", "options": ["Yes — proceed", "No — needs changes"]}`.

- `Yes — proceed` → step 8.
- Any answer other than the two options is the corrections → append
  `{"id": "intent-<n>", "question": <the intent question>, "answer": <the corrections>}`
  (`<n>` a running number, unique within this invocation) to
  `DECISIONS_SO_FAR`; step 5 (designer only, headless cap included, no
  revision input), handle its result as there; a decision-complete draft
  comes back to this step.
- `No — needs changes` without corrections:
  - Interactive: one clarifying decide call with
    `{"id": "changes", "question": "What should change in the design?", "options": ["Proceed as designed after all", "Describe the change (via Other)"]}`.
    `Proceed as designed after all` counts as `Yes — proceed`. The option
    `Describe the change (via Other)` itself → ask that call once more; never
    guess. A free-text answer is the corrections (bullet above).
  - Headless: `design-task: headless intent check rejected the design without corrections`, stop.

Only after `Yes` is the design approved: this is the pipeline's one human
checkpoint on the design.

## 8. Result

With `HEADLESS`, first repeat every `Decided ...` line that decide printed in
this invocation. The last line is exactly one plain-text line:

`RESULT: {"explorePath": "<EXPLORE_PATH>", "size": "<SIZE>", "designPath": "<DRAFT_PATH>", "findings": [{"severity": "minor", "description": "<description>"}, ...]}`

`findings` = `FINDINGS`: the last `complete` workflow return's
`minorFindings`, `[]` when the workflow never completed. It is a real JSON
array, never `[object Object]`.
