---
name: clean-branches
description: Fetch latest state, prune merged upstream branches (when gh or glab is available), delete local branches whose upstream is gone, and list uncommitted files.
context: fork
model: claude-haiku-4-5-20251001
disable-model-invocation: true
allowed-tools: ["Bash(bash:*)", "Bash(git:*)", "Bash(gh:*)", "Bash(glab:*)"]
---

# Clean branches

Script: !`echo "$CLAUDE_PLUGIN_ROOT/bin/clean-branches.sh"`

Run `bash "<script-path-from-above>"` in the working directory. Show stdout verbatim. On non-zero exit, show stderr and exit code.

When `gh`/`glab` is authenticated, upstream deletion targets **every** remote branch merged into the default branch — including shared/long-lived ones (`release/*`, `develop`, etc.), not just personal feature branches. Only the default branch itself is exempt.
