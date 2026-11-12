# jevfort

Lets TypeSafe **Jev** take routine steps, answer simple prompts without the main model, estimate each turn's effort,
route the model by difficulty, allow writes into the session scratchpad, check that work is done when Claude answers, classify prompts,
pick subagent types and guide compaction. Every decision is logged and reported through `/jev`.

jevfort has no off switch of its own: disable the plugin (`/plugin`, or `claude plugin disable`) to turn it off.

A port of [nim-f/jev-pilot](https://github.com/nim-f/jev-pilot) 0.5.0 by Code and Bird into this repository's plugin
layout. jevfort makes no network request of its own: it asks Jev through the tools of the jev-api plugin.

## Requires

The **jev-api** plugin, installed and enabled together with jevfort. jevfort declares it as a plugin dependency, so Claude Code keeps jevfort disabled while jev-api is missing or disabled. jevfort asks Jev only through jev-api's tool `mcp__jev-api__batch` (jev-api 0.2.0 or later): one call, and one request, per decision.

The endpoint and the key are configured for jev-api, not for jevfort: its environment variables `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`, `JEV_URL` and `TYPESAFE_DEFAULT_MODEL` are described in the jev-api README. Coming from jevfort 0.4, which sent its own request: jev-api sends the key only to an `https://` endpoint (an `http://` `JEV_URL` now gets no `Authorization` header), and it also reads `TYPESAFE_BASE_URL` and `TYPESAFE_DEFAULT_MODEL`, which jevfort 0.4 ignored.

Without jev-api's batch tool in a session (for example denied by a permission rule), jevfort does nothing: it changes no event, does not register `estimate_effort` (once registered, `estimate_effort` keeps answering its default effort), and `/jev` says so. jevfort looks the tool up again at every turn, so jev-api appearing or going away (for example through a permission rule added later) takes effect from the next turn. When jev-api is not configured, fails, or does not answer a decision within 4 seconds, jevfort leaves that decision to Claude Code's own behaviour: a turn step logs it as `unavailable`, an `estimate_effort` call answers its default effort.

## Commands

| Command           | Does                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/jev`            | Status: routing (`(effort auto off)` while the effort band's Auto button pauses the effort choice), thresholds, decision counts, the last 10 decisions (` (pass)` marks one that changed nothing) |
| `/jev report`     | Markdown report: steps Jev took, turns answered without Claude, agreement with Claude step by step, take-threshold table, routing, done check, classifier, subagent types, compaction             |
| `/jev candidates` | The options Jev is offered at step 0 for the last prompt                                                                                                                                          |
| `/jev export`     | Writes the log to `<cwd>/.jev/decisions.jsonl`                                                                                                                                                    |
| `/jev clear`      | Clears the log and the counters                                                                                                                                                                   |

## Effort band

In the terminal and the desktop app jevfort draws one row above the prompt: `low medium high xhigh max` and a `Jev auto: on` button. From each turn's start, the effort Claude Code is set to (the session effort) is bold and the effort Jev chose for the current turn is blue; the other levels are dim. Pressing `Jev auto` pauses Jev's automatic effort choice: turns run at the session effort until you press it again or a new session starts (a reload of jevfort also turns it back on). Taking steps, model routing and the `estimate_effort` tool keep working. The row shows the main conversation only, not subagents, and is hidden with `routing: off` and while jevfort is inactive. `/jev` shows `(effort auto off)` while the choice is paused.

## Tool

`estimate_effort` (model-visible name `mcp__jevfort__estimate_effort`, deferred: load it with ToolSearch `select:mcp__jevfort__estimate_effort`) estimates the reasoning effort a prompt most likely needs; Skills and subagents can call it.

| Input           | Values                                  | Meaning                                                         |
| --------------- | --------------------------------------- | --------------------------------------------------------------- |
| `model`         | `haiku`, `sonnet`, `opus`, `fable`      | The model that will run the prompt; a stronger model needs less |
| `defaultEffort` | `low`, `medium`, `high`, `xhigh`, `max` | Returned unchanged when Jev is unreachable or unsure            |
| `minEffort`     | `low`, `medium`, `high`, `xhigh`, `max` | Lowest effort to return; the answer for a mechanical prompt     |
| `maxEffort`     | `low`, `medium`, `high`, `xhigh`, `max` | Highest effort to return                                        |
| `prompt`        | text                                    | The prompt to estimate                                          |

The result is JSON `{"effort": "<level>", "source": "jev" | "mechanical" | "fallback"}`: a purely mechanical prompt gets `minEffort`; otherwise Jev's estimate plus the model bias, kept within `minEffort`..`maxEffort`; when Jev is unreachable or unsure (confidence below 0.5), `defaultEffort`. Invalid input is a tool error and sends no Jev request. The turn-start routing uses the same logic with the session model, the session effort as `defaultEffort` and the `minEffort`/`maxEffort` options.

## Options

| Option              | Default  | Meaning                                                                                                                                                                        |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `routing`           | `effort` | Per-turn routing: `effort` (effort from Jev's estimate: every turn on Opus/Sonnet, first turn then held on Haiku/Fable), `model` (also a cheaper model by difficulty) or `off` |
| `takeSteps`         | `true`   | Let Jev make routine tool calls (Read, git, project scripts) itself                                                                                                            |
| `doneCheck`         | `true`   | After an answer that looks unfinished, send Claude one follow-up message to continue                                                                                           |
| `takeThreshold`     | `0.85`   | Minimum probability for Jev to take a step                                                                                                                                     |
| `subagents`         | `true`   | Also take steps and route effort inside subagent loops                                                                                                                         |
| `doneThreshold`     | `0.15`   | Send Claude back below this finished probability                                                                                                                               |
| `bypass`            | `true`   | Answer a one-action prompt with Jev's action plus a small-model summary                                                                                                        |
| `classify`          | `true`   | Classify each prompt and add a skill or plan hint                                                                                                                              |
| `agentTypes`        | `true`   | Switch a general-purpose subagent to a specialised type when confident                                                                                                         |
| `compaction`        | `true`   | Tell the summarizer which tool results to keep in detail                                                                                                                       |
| `takeOnlyForBypass` | `true`   | Take a step only when the whole prompt is one read-only action                                                                                                                 |
| `measureSteps`      | `true`   | Inside longer turns, ask Jev in parallel which action it would take and log the match                                                                                          |
| `minEffort`         | `low`    | Lowest effort the effort estimate may pick; also the effort of a purely mechanical turn                                                                                        |
| `maxEffort`         | `xhigh`  | Highest effort the effort estimate may pick                                                                                                                                    |

Write, Edit and NotebookEdit calls into this session's scratchpad directory are allowed in every permission mode; a settings deny or ask rule still wins (only a mode's own ask becomes allow). Paths containing `..` are never allowed. Bash commands that write there are not covered. Every other permission verdict is Claude Code's own.
