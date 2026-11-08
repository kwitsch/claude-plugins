# jevfort

Lets TypeSafe **Jev** take routine steps, answer simple prompts without the main model, route effort or model by
difficulty, gate risky Bash commands and edits, check that work is done when Claude answers, classify prompts, pick
subagent types and guide compaction. Every decision is logged and reported through `/jev`.

A port of [nim-f/jev-pilot](https://github.com/nim-f/jev-pilot) 0.5.0 by Code and Bird into this repository's plugin
layout, with the endpoint configurable through `JEV_URL`.

## Environment

| Variable           | Required | Meaning                                                                                                                                                                                                                                                                                           |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TYPESAFE_API_KEY` | yes      | Bearer token for the TypeSafe API. Without it every Jev decision is logged as `unavailable` and Claude Code behaves as usual.                                                                                                                                                                     |
| `JEV_URL`          | no       | The Jev endpoint, read on every request. Default `https://api.typesafe.ai/v1/systemone`. Any `http://` or `https://` URL is accepted (trimmed); blank counts as unset; anything else is logged as a Jev error and no request is sent. Over plain `http://` the bearer token travels in cleartext. |

## Commands

| Command                   | Does                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/jev`                    | Status: mode, routing, thresholds, decision counts, the last 10 decisions (` (pass)` marks one that changed nothing)                                                                        |
| `/jev report`             | Markdown report: steps Jev took, turns answered without Claude, agreement with Claude step by step, take-threshold table, routing, gate, done check, classifier, subagent types, compaction |
| `/jev candidates`         | The options Jev is offered at step 0 for the last prompt                                                                                                                                    |
| `/jev export`             | Writes the log to `<cwd>/.jev/decisions.jsonl`                                                                                                                                              |
| `/jev clear`              | Clears the log and the counters                                                                                                                                                             |
| `/jev active`, `/jev off` | Switches the mode for this plugin's store (wins over the configured option)                                                                                                                 |

## Options

| Option              | Default  | Meaning                                                                               |
| ------------------- | -------- | ------------------------------------------------------------------------------------- |
| `mode`              | `active` | `active` applies Jev's decisions, `off` disables the mod                              |
| `routing`           | `effort` | Per-turn routing by difficulty: `effort`, `model` (also a cheaper model) or `off`     |
| `takeSteps`         | `true`   | Let Jev make routine tool calls (Read, git, project scripts) itself                   |
| `gate`              | `true`   | Let Jev tighten permissions on risky or out-of-scope Bash and edits                   |
| `doneCheck`         | `true`   | After an answer that looks unfinished, send Claude one follow-up message to continue  |
| `takeThreshold`     | `0.85`   | Minimum probability for Jev to take a step                                            |
| `subagents`         | `true`   | Also take steps and route effort inside subagent loops                                |
| `dangerAsk`         | `0.5`    | Ask before a Bash command at this danger probability                                  |
| `dangerDeny`        | `0.8`    | Deny a dangerous Bash command at this probability when it is also out of scope        |
| `scopeDeny`         | `0.2`    | A Bash command counts as out of scope below this in-scope probability                 |
| `editScope`         | `0.15`   | Ask before an edit below this in-scope probability                                    |
| `doneThreshold`     | `0.15`   | Send Claude back below this finished probability                                      |
| `bypass`            | `true`   | Answer a one-action prompt with Jev's action plus a small-model summary               |
| `classify`          | `true`   | Classify each prompt and add a skill or plan hint                                     |
| `agentTypes`        | `true`   | Switch a general-purpose subagent to a specialised type when confident                |
| `compaction`        | `true`   | Tell the summarizer which tool results to keep in detail                              |
| `takeOnlyForBypass` | `true`   | Take a step only when the whole prompt is one read-only action                        |
| `measureSteps`      | `true`   | Inside longer turns, ask Jev in parallel which action it would take and log the match |
