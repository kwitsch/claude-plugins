---
name: repo-init
description: Orchestrator — runs claude-repo-init, codebase-repo-init, and lsp-repo-init in sequence. Single entry point for full repo initialization. Each sub-skill is idempotent; this skill is safe to re-run.
allowed-tools: ["Skill"]
---

# repo-init

Run all repo-initialization skills in sequence. Each sub-skill is idempotent and
reports its own outcome. A sub-skill failure does not stop the sequence.

## Steps

1. Invoke `init:claude-repo-init` via Skill tool.
2. Invoke `init:codebase-repo-init` via Skill tool.
3. Invoke `init:lsp-repo-init` via Skill tool.
4. Print a one-line summary per skill outcome:
   - success: `✓ <skill-name>`
   - failure: `✗ <skill-name>: <reason>`
