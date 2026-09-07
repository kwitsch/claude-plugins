---
paths:
  - "plugins/*/agents/*.md"
  - "plugins/*/workflows/**"
  - ".claude/agents/*.md"
---

# Rule: harness-only content stays in English

Agent prompt bodies and workflow scripts are never read by a human as prose
documentation — only the harness (an agent's own runtime, or the Workflow
tool) consumes them. Write and keep all of it in English, including code
comments inside `*.workflow.js` files: prose, examples, and the rest of the
repo (skills, hooks, READMEs, CLAUDE.md files) are all English, and a
harness-only file in a different language is invisible drift no reviewer
reads in the normal course of working the repo.

This applies regardless of the language the request that produced the file
was written in.
