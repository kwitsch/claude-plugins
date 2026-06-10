---
paths:
  - "**/*.md"
---
# Rule: CodeRabbit annotations on markdown files

Applies to all `.md` files matched by the glob above. The glob includes `**/README.md` — **ignore this rule when the file being edited is a README** (negative globs are not supported in paths frontmatter; the exclusion is prose-only).

## When applying CodeRabbit suggestions

Before applying any CodeRabbit annotation to a markdown file:

1. **Check against Anthropic documentation** — if the suggestion conflicts with current Anthropic/Claude Code documentation (API fields, hook schemas, frontmatter keys, model IDs, tool names, behavior descriptions), do NOT apply it.

2. **Contradicts Anthropic docs** → insert a justification comment directly above the affected line instead:
   ```markdown
   <!-- coderabbit-skip: <one-line reason why the suggestion contradicts Anthropic docs, with doc reference if possible> -->
   ```

3. **Does not contradict Anthropic docs** → apply the suggestion normally.

## Rationale

Markdown files in this repo include skills, agents, rules, and hooks documentation that must match Claude Code's actual behavior. CodeRabbit may suggest changes based on general writing style or outdated training data that conflict with current Anthropic-documented behavior. Accuracy over style.
