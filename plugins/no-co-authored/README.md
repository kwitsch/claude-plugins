# no-co-authored

Strips `Co-Authored-By:` trailers and the Claude Code footer from git commit
messages before they run.

## Install

```
/plugin install no-co-authored@kwitsch-plugins
```

## What it does

A PreToolUse hook on the Bash tool rewrites `git commit` commands in place,
removing co-author trailers and the `Generated with [Claude Code]` footer. In
normal operation it fails open and never blocks a commit. Only when neither `jq`
nor `node` is available to parse the command does it block that git commit
(non-commit commands are left alone) and ask Claude to recreate the message
without those lines.
