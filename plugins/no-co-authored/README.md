# no-co-authored

Blocks `git commit` commands whose message carries a `Co-Authored-By:` trailer
or the Claude Code footer, and asks Claude to recreate the message without them.

## Install

```
/plugin install no-co-authored@kwitsch-plugins
```

## What it does

A PreToolUse hook on the Bash tool scans `git commit` commands. If the message
contains a `Co-Authored-By:` trailer or the `Generated with [Claude Code](http…`
footer, the hook returns a `deny` decision with a reason telling Claude to
recreate the commit without those lines. It never rewrites the command itself.

Clean commits, non-commit commands, and prose that merely mentions the footer
(without the `](http…` URL) fall open and run untouched. The scan is pure shell
with no `jq`/`node` dependency.
