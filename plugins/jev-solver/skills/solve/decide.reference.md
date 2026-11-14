# decide

**jev-api first.** Every decision in `solve` and its references that can be put as options, a rating or a yes/no goes to the jev-api tools before any own reasoning. Own reasoning replaces the answer only when its confidence is low or the call fails (see below). Use it for every decision in the catalogue at the end of this file, never for a decision that belongs to the user (approvals, destructive or outward-facing actions): those go to the user via `AskUserQuestion` (with `--headless`: to the `decider` agent, see [SKILL.md](SKILL.md#questions-and---headless)).

## Which tool

| Decision                                              | Tool                   | Input                                            |
| ----------------------------------------------------- | ---------------------- | ------------------------------------------------ |
| One of several named options (approach A or B, scope) | `mcp__jev-api__choice` | `criteria`: option name to description           |
| Difficulty, risk or size on ordered levels            | `mcp__jev-api__score`  | `criteria`: levels, lowest first                 |
| Yes or no                                             | `mcp__jev-api__noul`   | optional `criteria`: `true` and `false` meanings |
| Several of the above about the same text              | `mcp__jev-api__batch`  | `state` once, `questions` array                  |

`state` is the text the question is about (the relevant task, spec or code excerpt), `instructions` is the question. The tools take text only: paste what matters.

**Batch first.** Decisions that fall due at the same moment go into one `mcp__jev-api__batch` call (`state` once, one question each; refer to items by number in `state`), not one call per decision: all candidate questions of a step, all findings of a review, all points of a feedback, a size plus a yes/no about the same task. Use a single tool only for one lone decision. The accepting rules below apply per answer.

## Accepting the answer

- `choice`: accept when `confidence` is at least the plugin option `confidence` (default 0.6).
- `noul`: accept when the probability is at least that value or at most 1 minus it; in between, decide yourself.
- `score`: accept the rounded level; treat a low `confidence` like above.
- Any error result (starts with the tool name and a colon, for example `choice:`), missing configuration, or a timeout: decide with your own reasoning using the same criteria. Say in one line that jev-api gave no usable answer; do not retry in a loop.

## Catalogue: where jev-api decides

| Where                                                   | Tool     | Question and `state`                                                                                 |
| ------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `solve` triage                                          | `batch`  | track (choice) and size (score) of the task text; the size floor of `solve` applies                  |
| `solve` task ambiguity (in the triage batch)            | `batch`  | is the task too ambiguous to start? Only a confident yes goes to the user                            |
| `solve` bugfix turns out to be a feature                | `noul`   | does the root cause call for new behaviour or design?                                                |
| `design` clarifying question                            | `noul`   | do the code and sensible defaults already answer it? Only a confident no is asked                    |
| `design` approaches, `plan` orderings or strategies     | `choice` | the named options with their trade-offs                                                              |
| `plan` size check                                       | `score`  | size of the plan (skipped with `--size`); a higher size than the triage wins, the size floor applies |
| `execute` unclear or wrong step, plan gap               | `noul`   | is the step really unclear or wrong? Only a confident yes stops and asks                             |
| `debug` several plausible causes                        | `choice` | the causes (the evidence still decides)                                                              |
| `request-review` severity of each finding               | `score`  | note, should fix, blocking                                                                           |
| `receive-review` unclear point, correct point           | `noul`   | is the point unclear? is it correct (state: point and code excerpt)?                                 |
| `receive-review` matter of taste                        | `choice` | the taste options                                                                                    |
| `worktree` uncommitted changes in the way, red baseline | `noul`   | do they block the task? are the failures unrelated to it?                                            |
| `pr` rebase or merge, unclear conflict hunk             | `choice` | the repo's convention first; otherwise rebase or merge; keep ours, theirs or both                    |
| `pr` failing check                                      | `noul`   | flaky or environmental rather than caused by the change?                                             |
| `finish` memory worth saving                            | `noul`   | is it lasting and useful in a later session?                                                         |

Not decided here, always the user's (headless: decider): approvals of design, spec and plan, discarding, merging, turning off tests, and what to do after three failed fixes.

Record a decision that matters (what, why) in one line in the spec or plan, and save lasting ones with `graphmind memory add --type decision` when graphmind is available.
