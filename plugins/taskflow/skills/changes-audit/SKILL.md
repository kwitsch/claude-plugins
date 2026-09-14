---
name: changes-audit
description: >-
  Audit the current branch's changes with taskflow's combined review engine
  (correctness angles + cleanup lenses, independently verified, plus a
  report-only lean pass), then with --fix auto-apply every finding, or without
  --fix present them as an AskUserQuestion multi-select and apply only the ones
  you pick. Fixes are applied by re-dispatching the fix-applier agent. Use when
  the user asks to review, audit, or check the current branch's changes / diff.
argument-hint: "[--fix] [base ref]"
allowed-tools: ["Read", "Bash", "Workflow", "ToolSearch", "Agent", "AskUserQuestion"]
---

# changes-audit — review the branch diff, then optionally apply the fixes

Run taskflow's combined review engine over the current branch's committed diff
against a base ref — correctness angles + cleanup lenses, each finding
independently verified, plus a report-only lean (over-engineering) pass — then
either auto-apply every finding (`--fix`) or let the user pick which to apply
(`AskUserQuestion` multi-select). Fixes are realized by re-dispatching the
`fix-applier` agent: taskflow findings carry no patch text, so only a Read/Edit
agent can turn one into an edit. **This skill runs inline (depth 0)** — it
drives `Workflow`, `AskUserQuestion`, and an `Agent` dispatch and must retain
their results; never run it as `context: fork`.

The review engine is the `taskflow:changes-review` Workflow; this SKILL.md only
orchestrates it and owns the apply step. Merging or pushing the branch is out of
scope here.

> **User decisions go through `AskUserQuestion`** — fixed-choice and open-ended
> alike; never plain prose that waits for a typed reply. Remote sessions do not
> reliably surface a plain-text "waiting for input" prompt, whereas
> `AskUserQuestion` raises a notification.

## Plugin context

Plugin root: ${CLAUDE_PLUGIN_ROOT}

Capture the `Plugin root:` value above — the fallback workflow-invocation path
(step 3) reads the workflow file from it. This is a plain pre-injection text
substitution (the same mechanism as `${CLAUDE_SKILL_DIR}`, per
`.claude/rules/script-authoring.md`), resolved before this skill body is even
sent to you — no shell command runs. Do NOT change this to a load-time shell
injection (an exclamation-prefixed backtick that runs a command at load time):
that form fails outright, deterministically, inside a worktree-isolated session
— see `.claude/rules/taskflow-skill-plugin-root-and-injection.md`. Empty (loaded
outside any plugin context, or an unresolved literal token) → the named
invocation in step 3 is the only path.

## 1. Parse arguments

`$ARGUMENTS` may contain the bare flag `--fix` (no value) and/or a base ref.
Parse and strip `--fix` first; set `$FIX` = present/absent. Whatever non-flag
text remains, trimmed, is the base ref → `$BASE`; when empty, default it to the
short name from `git symbolic-ref --short refs/remotes/origin/HEAD` (fallback
`main` if that command fails).

## 2. Pre-checks

Run these via the Bash tool (an ordinary fenced `bash` command — never load-time
injection):

- Capture `BRANCH_NAME` = `git branch --show-current` — you pass it to
  `fix-applier` so its branch guard can confirm the right checkout.
- `git status --porcelain` must be empty. Dirty → stop and tell the user to
  commit or stash first: the engine reviews committed changes only (the
  workflow's scope agent asserts a clean tree as its own first instruction).
- `git diff --quiet "$BASE"...HEAD` → if it exits 0 (no diff), report "no
  changes to audit against `$BASE`" and stop.

## 3. Invoke the review workflow

1. **Probe once:** `ToolSearch(query: "select:Workflow")`. Tool absent, or the
   script is rejected with a meta/API validation error → stop and report. There
   is no Agent-engine fallback — the workflow is the engine.
2. **Primary — invoke by name with `args`:** the workflow lives in this plugin's
   root `workflows/` directory and is auto-discovered, so it runs namespaced,
   displayed as the slash command `/taskflow:changes-review`. The `Workflow`
   tool's `name` parameter takes that identifier WITHOUT the leading `/` —
   `taskflow:changes-review`; a leading `/` makes the tool report the name as
   not found. Pass inputs as ONE structured `args` object:
   `Workflow({name: "taskflow:changes-review", args: {BASE_BRANCH: "$BASE"}})`.
   The runtime may deliver the object serialized as a JSON string — the
   template's `decodeArgs` parses that transparently, so a `stage: 'args'`
   return always means a genuinely malformed payload: fix the call, never
   switch to the fallback for it.
3. **Fallback — ad-hoc script with prepended args:** only if the named
   invocation is unavailable, Read
   `${CLAUDE_PLUGIN_ROOT}/workflows/changes-review.workflow.js`, prepend exactly
   one line after the `meta` block — `const args = { BASE_BRANCH: "$BASE" }` as
   a JSON object literal — and send the whole text via the `script` parameter.
   NEVER pass the tool-level `args` parameter on an ad-hoc `{script}` call: the
   global arrives `undefined` there. The fallback still requires this plugin to
   be loaded — the script dispatches `taskflow:review-finder` /
   `taskflow:review-verifier` via namespaced `agentType`, and an unknown type
   throws hard at dispatch.
4. **Consume only the structured return** — never re-derive workflow state from
   transcript output.

## 4. Handle the return

- `stage: 'args'` or `stage: 'Review'` → surface the `error` string and stop; do
  NOT dispatch any apply.
- `stage: 'done'` → take `review.findings` (an array of
  `{file, line, summary, failure_scenario, category, verdict}`, already ranked
  most-severe first) and `ponytailReview`.
- Empty `review.findings` → report the diff is clean of verified findings (and
  list the report-only `ponytailReview` over-engineering findings, if any), then
  stop.

## 5. --fix path (auto-apply all)

If `$FIX` is set and `review.findings` is non-empty, dispatch `fix-applier` once
with every finding. Number the findings 0-based in the order returned:
`numbered = review.findings.map((f, i) => ({ index: i, ...f }))`.

Use the `Agent` tool with `subagent_type: "taskflow:fix-applier"` and this
prompt (substitute `<BRANCH_NAME>` and `<JSON>` = the `numbered` array as JSON):

    Fix-application run. Work branch: <BRANCH_NAME>. No approved spec — apply the
    skip rule without the spec-contradiction clause. Findings to apply, numbered,
    most-severe first: <JSON>. Locate-by-content, skip rule, commit-by-category,
    and test gate per your agent definition. Return the JSON object
    {applied:[idx], skipped:[{index,reason}], commits:[hash]} as your final
    message.

The `Agent` tool takes no schema parameter, so `fix-applier` emits that object
as text — parse the JSON object from its final message. Then go to Report.

## 6. Interactive path (no --fix)

Build `AskUserQuestion` tabs from `review.findings`:

- Each finding is one selectable option, `multiSelect: true`.
- The option label begins with the finding id and its summary: `f01: <summary>`,
  `f02: <summary>`, … numbered in the returned order.
- At most 4 options per tab, at most 4 tabs per call. Keep the returned order
  (correctness before cleanup, CONFIRMED before PLAUSIBLE — the workflow already
  ranks them). Issue successive calls when more than 4 tabs are needed. If a tab
  would have only one option, add an explicit `Skip this group` filler so every
  tab has at least 2 options.
- Collect the selected findings. None selected → report that nothing was applied
  (still show the report-only ponytail findings) and stop.
- Renumber ONLY the selected findings 0-based and dispatch `fix-applier` with
  just those — the same `Agent` dispatch and prompt shape as step 5. Then go to
  Report.

## 7. Report

Summarize:

- applied findings with their commit hashes (from the agent's `applied` /
  `commits`);
- skipped findings with the reason the applier gave (`skipped`);
- findings the user did not select (interactive path only);
- the report-only `ponytailReview` over-engineering findings — these are never
  applied; point the user at `/simplify` or a ponytail review to act on them;
- the `refuted` candidates (verified-but-REFUTED), for transparency;
- any error stage surfaced in step 4.

If `fix-applier` returned null or a non-JSON message, treat every dispatched
finding as skipped with reason "applier returned no result" and report that; do
not retry automatically. If `fix-applier` STOPped on a branch mismatch (its own
guard), surface the branch it reported verbatim. Merging or pushing the branch
is not this skill's job.
