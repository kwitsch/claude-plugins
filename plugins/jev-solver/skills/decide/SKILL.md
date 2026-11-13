---
name: decide
description: Shared rule for direction decisions with defined options or a difficulty rating, answered through the jev-api tools with a fallback to own reasoning. Used by the other jev-solver skills; load it when a skill says to decide.
---

# decide

Use for a direction decision that has defined options or a rating scale, never for a decision that belongs to the user (approvals, destructive or outward-facing actions): those go to the user via `AskUserQuestion`.

## Which tool

| Decision                                              | Tool                   | Input                                            |
| ----------------------------------------------------- | ---------------------- | ------------------------------------------------ |
| One of several named options (approach A or B, scope) | `mcp__jev-api__choice` | `criteria`: option name to description           |
| Difficulty, risk or size on ordered levels            | `mcp__jev-api__score`  | `criteria`: levels, lowest first                 |
| Yes or no                                             | `mcp__jev-api__noul`   | optional `criteria`: `true` and `false` meanings |
| Several of the above about the same text              | `mcp__jev-api__batch`  | `state` once, `questions` array                  |

`state` is the text the question is about (the relevant task, spec or code excerpt), `instructions` is the question. The tools take text only: paste what matters.

## Accepting the answer

- `choice`: accept when `confidence` is at least the plugin option `confidence` (default 0.6).
- `noul`: accept when the probability is at least that value or at most 1 minus it; in between, decide yourself.
- `score`: accept the rounded level; treat a low `confidence` like above.
- Any error result (starts with the tool name and a colon, for example `choice:`), missing configuration, or a timeout: decide with your own reasoning using the same criteria. Say in one line that jev-api gave no usable answer; do not retry in a loop.

Record a decision that matters (what, why) in one line in the spec or plan, and save lasting ones with `graphmind memory add --type decision` when graphmind is available.
