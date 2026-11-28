---
name: decide
description: >-
  Internal decision step of taskflow's build-task and review-task: shows the
  given content and asks the user via AskUserQuestion, or with --headless lets
  the advisor tool or the taskflow:decider agent decide. Invoked by those
  skills with a JSON argument; not for direct use.
argument-hint: "[--headless] <JSON: {content, questions}>"
allowed-tools: ["AskUserQuestion", "Agent"]
---

# decide — one decision step for build-task and review-task

Runs inline in the caller's conversation (never `context: fork`): the advisor
must see the content, and the caller reads this skill's last line. It asks 1
to 4 questions at once and always ends with one `DECISIONS:` line.

## 1. Parse

`$ARGUMENTS`: when its first token is `--headless`, strip it and set
`HEADLESS`. The rest, trimmed, must be one JSON object:

- `content`: array of strings (may be empty), the context, one bullet each.
- `questions`: array of 1 to 4 objects
  `{"id": string, "question": string, "options": string[], "context"?: string}`
  with 2 to 4 `options` each; every `id` non-empty and unique.

Anything else (not JSON, a missing field, wrong counts, a duplicate or empty
id) → print exactly `decide: invalid input: <reason>` and stop; nothing is
asked.

## 2. Content

In every mode, output the `content` items as a markdown bullet list in one
plain-text message (skip it when `content` is empty). This is the only place
the content is shown; callers do not print it themselves.

## 3. Interactive (no `HEADLESS`)

One `AskUserQuestion` call with one question per entry: the `question` text,
the `options` verbatim as choices (free text arrives via "Other"), `context`
as the question context, and a header of at most 12 characters derived from
`id`. Answer = the picked option text or the "Other" text. `BY` = `user`.
Then step 6.

## 4. Headless: advisor

The advisor is available exactly when a tool named `advisor` is in your tool
list. Not available → step 5 for all questions.

Available: output one plain-text message that lists each question with its
`id`, its numbered options and its `context`, followed by the line
`Headless decision: pick one option per question (or a short free-text answer when no option fits) and give the reason in one sentence.`
Then call `advisor()` (no parameters; it reads the conversation, including
the content bullets of step 2). For each question take the option the advice
picks (match by option text or number) and its reason; a free-text answer
only when the advice explicitly rejects every option and states the
alternative. `BY` = `advisor`. The call fails, or the advice leaves a
question without a clear pick → step 5 for exactly those questions.

## 5. Headless: decider agent

Call
`Agent(subagent_type: "taskflow:decider", description: "Headless decision", prompt: <JSON object {"content", "questions"} with the content and only the remaining questions>)`.
Its final message is a JSON array `[{"id", "answer", "reason"}]`. An entry
counts when its `id` is one of the asked ids and its `answer` is non-empty;
an answer equal to an option text is that option, any other string is a
free-text answer. `BY` = `decider` for these questions.

The Agent tool is missing, the call fails, the output does not parse, or an
asked id has no entry → print `decide: no headless decision: <reason>` and
stop. Headless never falls back to `AskUserQuestion`: it would stall an
unattended run, and in `claude -p` it is disabled.

## 6. Output

The last lines, plain text:

- headless only, one line per question:
  `Decided <id>: <answer> (<BY>: <reason>)`
- always, as the final line:
  `DECISIONS: [{"id": "<id>", "answer": "<answer>"}, ...]` — a real JSON
  array in question order, never `[object Object]`.
