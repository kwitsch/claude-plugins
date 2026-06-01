# no-co-authored

Strips `Co-Authored-By:` trailers and the Claude Code footer from git commit
messages before they run.

## Install

```
/plugin install no-co-authored@claude-plugins
```

## What it does

A PreToolUse hook on the Bash tool rewrites `git commit` commands in place,
removing co-author trailers and the `Generated with [Claude Code]` footer. It
fails open (never blocks a normal commit); if neither `jq` nor `node` is
available to parse the command, it blocks the commit and asks Claude to recreate
the message without those lines.
