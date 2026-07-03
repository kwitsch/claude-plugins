---
name: cc-review
description: Review a Claude Code component (a plugin dir, skill, agent, hook, command, .mcp.json, CLAUDE.md, or settings.json) against the curated cc-reference authoring rules, then interactively apply the recommendations you select. Use when the user asks to review, audit, or check a Claude Code skill/agent/hook/command/plugin/MCP/memory/settings file for errors or best-practice violations.
argument-hint: [target path]
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, Agent, AskUserQuestion, mcp__plugin_context-mode_context-mode__*, ToolSearch
# review-skip(F1): unscoped Bash/Edit/Write is required — detection (sec 2) runs against an arbitrary user-supplied path so Bash cannot be prefix-scoped, and fixes (sec 6) Edit/Write arbitrary files; allowed-tools only pre-approves, never restricts.
---

# cc-review — audit a Claude Code component and apply selected fixes

Audit `$ARGUMENTS` against the curated `cc-reference` knowledge by dispatching the
read-only `cc-reviewer` agent per detected component type, then gate every change
behind an interactive selection. **This skill runs inline (depth 0)** — it dispatches
agents and writes files; never run it as `context: fork`.

The dispatched `cc-reviewer` agents are read-only. **This skill is the only writer.**

> **Ask the user via `AskUserQuestion`.** When this skill needs a decision from
> the user and the answers are a fixed / multiple-choice set, it MUST present the
> question through the `AskUserQuestion` tool — never as plain prose that waits for
> a typed reply. Remote sessions do not reliably surface a plain-text "waiting for
> input" prompt, whereas `AskUserQuestion` raises a notification. Open-ended,
> free-text prompts may be asked inline, but prefer `AskUserQuestion` whenever the
> choices can be enumerated.

## context-mode routing (optional acceleration)

If the context-mode MCP tools are available, route heavy work through them so large
output stays out of context — leaner, faster turns. Fall back to native tools when
absent; never block on context-mode.

- **Read-only / output-heavy shell** (no filesystem or git writes) → run via
  `ctx_execute` (one command) or `ctx_batch_execute` (several), printing only the
  answer. Load the tools once with
  `ToolSearch(query: "select:mcp__plugin_context-mode_context-mode__ctx_execute,mcp__plugin_context-mode_context-mode__ctx_batch_execute")`
  (retry the bare names `select:ctx_execute,ctx_batch_execute`); if neither
  resolves, run the command via Bash.
- **State-mutating shell** (writes files, `git` commits/pushes, edits settings) →
  always native Bash; the ctx sandbox discards filesystem and git writes.

## 1. Resolve the target

The target is `$ARGUMENTS`. If it is empty, ask the user for a path (a file or a
directory) and stop until they provide one. Do not proceed without a target.

## 2. Detect component types

Once the target is resolved, run this detection with the Bash tool, passing the
resolved target as the argument. (Detection runs at runtime, not as a load-time
dynamic-context injection, because the target may have been supplied interactively.)

```bash
T="$1"
if [ -f "$T" ]; then
  case "$T" in
    */plugin.json|*/.claude-plugin/plugin.json) echo "plugins:$T" ;;
    */SKILL.md)                                  echo "skills:$T" ;;
    */hooks.json|*/hooks/*.mjs|*/hooks/*.sh)     echo "hooks:$T" ;;
    */.mcp.json)                                 echo "mcp:$T" ;;
    */CLAUDE.md)                                 echo "memory:$T" ;;
    */settings.json|*/settings.local.json)       echo "settings:$T" ;;
    */agents/*.md)                               echo "agents:$T" ;;
    */commands/*.md)                             echo "commands:$T" ;;
  esac
elif [ -d "$T" ]; then
  [ -f "$T/.claude-plugin/plugin.json" ] && echo "plugins:$T/.claude-plugin/plugin.json"
  [ -d "$T/skills" ]   && echo "skills:$T/skills"
  [ -d "$T/agents" ]   && echo "agents:$T/agents"
  [ -d "$T/hooks" ]    && echo "hooks:$T/hooks"
  [ -d "$T/commands" ] && echo "commands:$T/commands"
  [ -f "$T/.mcp.json" ]  && echo "mcp:$T/.mcp.json"
  [ -f "$T/CLAUDE.md" ]  && echo "memory:$T/CLAUDE.md"
  [ -f "$T/settings.json" ]       && echo "settings:$T/settings.json"
  [ -f "$T/settings.local.json" ] && echo "settings:$T/settings.local.json"
else
  echo "NOT_FOUND:$T"
fi
```

Each output line is `component_type:path`. If the only line is `NOT_FOUND:…` or
there are no lines, tell the user nothing reviewable was found and stop.

## 3. Dispatch reviewers (parallel)

For each detected `component_type:path`, dispatch the `cc-reviewer` agent (Agent
tool, `subagent_type: claude-code-knowledge:cc-reviewer`) in a single message so
they run concurrently. Each dispatch prompt must state:

```
component_type: <type>
target_paths: <path>

Return ONLY the JSON findings array per your output contract.
```

## 4. Aggregate

Parse each agent's JSON array. If an agent returns non-JSON or errors, note that
component type as failed and continue with the others — never abort the whole
review. Merge all findings, dedupe by `(location, rule)`, and sort by severity
(`high` → `med` → `low`). If zero findings remain, report the target is clean and
stop (skip the AskUserQuestion gate).

`uncovered` findings (`"uncovered": true`) are included in the sorted list but
always shown with a visual tag (e.g. `[uncovered]` in the option label) and their
`suggested_fix` is always treated as `null` — they are never auto-applied.

## 5. Gate via AskUserQuestion (paginate ALL severities)

`AskUserQuestion` hard caps: at most **4 questions (tabs)** per call, each tab
**2–4 options**, so **16 selectable findings per call** maximum.

Chunking is **tab-driven** (a tab maps to one component type, so a type never
splits across tabs ambiguously):

- For each `component_type`, split its severity-sorted findings into groups of ≤4.
  Each group becomes one **tab** (≤4 options), `multiSelect: true`. A type with
  more than 4 findings therefore contributes several tabs.
- Pack up to **4 tabs per `AskUserQuestion` call**. With up to 8 component types
  (and types that exceed 4 findings), there are usually more than 4 tabs total —
  issue successive calls of ≤4 tabs each until every tab has been shown. Order the
  tabs high→med→low by their group's top severity so the most severe come first;
  a type with leftover findings simply resumes in a later call.
- Each option label must begin with the finding `id` (e.g. `"skills-01: <issue>"`)
  so a selection maps back to its finding record.
- If a tab would have only one finding, add an explicit `"Skip this group"` option
  so the tab has ≥2 options.
- After the high+med tabs are triaged, if only low-severity tabs remain you may ask
  once whether to continue into them before issuing the remaining calls.

## 6. Apply selected findings

For each selected finding (matched by `id`), apply its `suggested_fix`:
- `{ "old_string", "new_string" }` → an `Edit` call on the finding's file.
- `{ "full_content" }` → a `Write` call on the finding's file.
- `null` → do not auto-apply; collect it as a manual to-do.

Apply nothing the user did not select.

## 7. Report

Summarize, grouped by component type: which findings were applied, which were
skipped, which are manual to-dos (`suggested_fix: null`), which are uncovered
(`"uncovered": true` — flagged informational, never auto-applied), and any
component type whose reviewer failed.
