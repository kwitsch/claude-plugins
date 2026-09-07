---
paths:
  - "plugins/coding-toolbox/skills/**/SKILL.md"
---

# Rule: coding-toolbox SKILL.md plugin-root capture

## Fixed 2026-08-22: `$CLAUDE_PLUGIN_ROOT` load-time shell injection, ported fix from taskflow

`fresh-work`, `feature-development`, `finish-pr`, `setup-rules`,
`refresh-tools-rule`, and `setup-explore` each used to capture the plugin
root via a load-time shell injection (`` !`echo "$CLAUDE_PLUGIN_ROOT"` `` as
its own line, or `echo "Plugin root: $CLAUDE_PLUGIN_ROOT"` / `"$CLAUDE_PLUGIN_ROOT"`
inside a larger ` ```! ` block / `printf`) rather than the bare
`${CLAUDE_PLUGIN_ROOT}` pre-injection text substitution. A sibling plugin,
`taskflow`, hit a confirmed, deterministic production failure from the exact
same pattern in its `dispatch-task` → `build-task` pipeline: when the
invoking skill runs inside a worktree-isolated session — which is every
session `dispatch-agent` (this plugin) or `dispatch-task` (taskflow)
launches via `claude --worktree ... --bg` — that shell injection is refused
outright as the tool_result of the `Skill` invocation itself, before the
skill's own first step ever runs, and reproduces identically on every retry
since the skill body doesn't change. `dispatch-agent` here uses the
identical `claude --worktree ... --bg` mechanism, and `fresh-work`/
`feature-development`/`finish-pr` are all freely model-invocable (no
`disable-model-invocation`), so the same exposure applied to any dispatched
session that went on to invoke one of them — see `taskflow/CLAUDE.md`'s own
"Fixed 2026-08-22" section for the full transcript evidence. `setup-rules`/
`refresh-tools-rule`/`setup-explore` carry the lower-risk fenced-block form
of the same pattern (all three are user-only wizards, never invoked from an
automated dispatch path) — fixed for consistency, not from an observed
failure. Fixed everywhere by switching to bare `${CLAUDE_PLUGIN_ROOT}` — no
shell command runs, so there is nothing left to refuse. `finish-pr`'s
`plugin_root:` fact was split out of its combined git-context `!` block
into its own bare-substitution line, since that block also computes
`current_branch`/`fetch_status`, which do need real shell execution
(`git branch --show-current`, `git fetch origin`) and stay as-is. Do not
revert any of these back to a `!`-injected form for this value — prefer the
bare form even inside plain prose, not only inside a fenced command the
model runs (see `.claude/rules/script-authoring.md`).
