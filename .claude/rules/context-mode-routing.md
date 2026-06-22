---
paths:
  - "plugins/branch-management/skills/**"
  - "plugins/branch-management/agents/*.md"
---

# Rule: context-mode tool grants for branch-management agents

context-mode is an **optional** accelerator (not a declared dependency). The
branch-management reviewer/monitor/fixer agents (`claude-reviewer`,
`codex-reviewer`, `copilot-reviewer`, `coderabbit-reviewer`, `ci-monitor`,
`review-fixer`) retain `mcp__plugin_context-mode_context-mode__*` and
`mcp__context-mode__*` (short alias) in their `tools:` allowlist as
**pre-approvals** — kept so those tools never prompt when a context delegate
routes a subagent's calls. Do NOT strip these grants as "unused".

The agents and skills carry **no** context-mode routing prose: each runs its
script directly via the Bash tool, and output isolation is provided by the
subagent boundary itself. Do not re-add a routing block or any instruction to
prefer `ctx_execute`/`ctx_batch_execute`. State-mutating scripts always run on
the native Bash tool.

See also the script-authoring rule (`script-authoring.md`).
