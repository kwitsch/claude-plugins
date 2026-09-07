---
paths:
  - "plugins/taskflow/skills/**/SKILL.md"
---

# Rule: taskflow SKILL.md plugin-root capture and `!`-injection

- Capture the plugin root via bare `${CLAUDE_PLUGIN_ROOT}` substitution — never a `!`-injected shell command. A worktree-isolated `dispatch-task` run refuses any such injection outright, deterministically, before the skill's own first step ever executes (every `dispatch-task` run launches via `claude --worktree ... --bg`).
- Never write a literal exclamation-backtick sequence anywhere in a `SKILL.md` body — not even inside a quoted example or a double-backtick code span. The load-time `!`-injection preprocessor does not respect markdown code-span quoting: it executes the sequence regardless, reproducing the same worktree-isolation-guard refusal from inside a cautionary example about the anti-pattern.
