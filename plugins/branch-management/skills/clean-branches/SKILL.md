---
name: clean-branches
description: Fetch latest state, prune merged upstream branches (when gh or glab is available), delete local branches whose upstream is gone, and list uncommitted files.
context: fork
model: claude-haiku-4-5-20251001
allowed-tools: ["Bash(bash:*)", "Bash(git:*)", "Bash(gh:*)", "Bash(glab:*)"]
---

# Clean branches

Script: !`echo "$CLAUDE_PLUGIN_ROOT/bin/clean-branches.sh"`

Run `bash "<script-path-from-above>"` in the working directory. Show stdout verbatim. On non-zero exit, show stderr and exit code.
