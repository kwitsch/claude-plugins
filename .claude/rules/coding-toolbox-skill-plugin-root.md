---
paths:
  - "plugins/coding-toolbox/skills/**/SKILL.md"
---

# Rule: coding-toolbox SKILL.md plugin-root capture

- Capture the plugin root via bare `${CLAUDE_PLUGIN_ROOT}` text substitution — never a `!`-injected shell command (`` !`echo "$CLAUDE_PLUGIN_ROOT"` `` or an `echo`/`printf` of `$CLAUDE_PLUGIN_ROOT` inside a ` ```! ` block).
  - Why: a worktree-isolated session refuses the injection outright as the `Skill` invocation's own tool_result, before the skill's first step runs, deterministically on every retry. Every session `dispatch-agent` launches (`claude --worktree ... --bg`) is worktree-isolated, and `fresh-work`/`feature-development`/`finish-pr` are model-invocable from one.
  - Prefer the bare form even in plain prose, not only inside a fenced command the model runs (see `.claude/rules/script-authoring.md`).
- `finish-pr`: `plugin_root:` stays its own bare-substitution line. The git-context `!` block keeps real shell execution for `current_branch`/`fetch_status` (`git branch --show-current`, `git fetch origin`).
- Taskflow-side rule: `.claude/rules/taskflow-skill-plugin-root-and-injection.md`.
