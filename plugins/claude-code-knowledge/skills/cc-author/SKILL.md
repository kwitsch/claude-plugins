---
name: cc-author
description: Create a new Claude Code component (a skill, agent, hook, command, .mcp.json, plugin, CLAUDE.md, or settings.json) grounded strictly in the curated cc-reference authoring rules, then write it and optionally hand it to cc-review. Use when the user asks to create, scaffold, author, or generate a Claude Code skill/agent/hook/command/plugin/MCP/memory/settings component.
argument-hint: [component type and/or target path]
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, Agent, AskUserQuestion, Skill
# review-skip(F1): unscoped Bash/Edit/Write is required — the target path is an arbitrary user-supplied location, so Bash cannot be prefix-scoped and Write creates arbitrary files; allowed-tools only pre-approves, never restricts.
---

# cc-author — create a Claude Code component grounded in cc-reference

Author `$ARGUMENTS` by dispatching the read-only `cc-author-planner` agent — which
composes the component strictly from the curated `cc-reference` knowledge — then
write the returned file(s). **This skill runs inline (depth 0)** — it dispatches an
agent and writes files; never run it as `context: fork`.

The dispatched `cc-author-planner` agent is read-only. **This skill is the only
writer.**

## 1. Resolve the request

From `$ARGUMENTS`, determine three things:

- `component_type` — one of `skills`, `agents`, `hooks`, `commands`, `mcp`,
  `plugins`, `memory`, `settings`.
- `target_path` — where to create the component (a file or directory).
- `intent` — what the component should do.

If any is missing or ambiguous, ask the user (use `AskUserQuestion` for the
component type when it is unclear). Do not proceed until all three are resolved.

## 2. Dispatch the planner

Dispatch the `cc-author-planner` agent (Agent tool,
`subagent_type: claude-code-knowledge:cc-author-planner`) in a single message. The
dispatch prompt must state:

```
component_type: <type>
target_path: <path>
intent: <what the component should do>

Return ONLY the JSON object per your output contract.
```

## 3. Write the returned files

Parse the planner's JSON. For each entry in `files`, write `full_content` to
`path` with the `Write` tool. The planner returns whole-file content (even for an
amend, it reads the existing file and returns the full revised content), so always
use `Write`, never `Edit`. The skill is the only writer.

If the planner returns non-JSON or errors, report that and stop — do not write
partial or guessed content.

## 4. Surface uncovered points

If the planner's `uncovered` array is non-empty, report each item to the user as
an informational note: these are authoring points `cc-reference` (including its
WebFetch fallback) did not cover, so the planner did not ground them. The user
decides whether to fill them in manually.

## 5. Hand off to review (optional)

Offer to validate the freshly written component: invoke the `cc-review` skill
(Skill tool) on the `target_path` so it is audited against the same `cc-reference`
rules. Only do this if the user agrees.
