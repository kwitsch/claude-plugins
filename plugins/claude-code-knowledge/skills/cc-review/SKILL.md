---
name: cc-review
description: Review a Claude Code component (a plugin dir, skill, agent, hook, command, .mcp.json, CLAUDE.md, or settings.json) against the curated cc-reference authoring rules, then interactively apply the recommendations you select. Use when the user asks to review, audit, or check a Claude Code skill/agent/hook/command/plugin/MCP/memory/settings file for errors or best-practice violations.
argument-hint: [target path]
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, Agent, AskUserQuestion, Skill
---

# cc-review — audit a Claude Code component and apply selected fixes

Audit `$ARGUMENTS` against the curated `cc-reference` knowledge by dispatching the
read-only `cc-reviewer` agent per detected component type, then gate every change
behind an interactive selection. **This skill runs inline (depth 0)** — it dispatches
agents and writes files; never run it as `context: fork`.

The dispatched `cc-reviewer` agents are read-only. **This skill is the only writer.**

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
  [ -f "$T/settings.json" ] && echo "settings:$T/settings.json"
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

- Chunk the full sorted finding list into windows of up to 16. Within a window,
  group findings into ≤4 tabs by `component_type`, ≤4 options each, with
  `multiSelect: true` on every tab.
- Each option label must begin with the finding `id` (e.g. `"skills-01: <issue>"`)
  so a selection maps back to its finding record.
- If a tab would have only one finding, add an explicit `"Skip this group"` option
  so the tab has ≥2 options.
- Repeat AskUserQuestion rounds (next 16, etc.) until every finding has been shown.
  After the high+med findings are triaged, if low-severity findings remain you may
  ask once whether to continue into them before paginating the rest.

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
