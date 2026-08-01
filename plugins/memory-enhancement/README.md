# memory-enhancement

A dream skill that consolidates this project's auto-memory files, a
self-improvement skill that reflects on a session's own efficiency, plus a
Stop/SessionStart hook pair that nudges the next session to run a dream
cycle.

## Install

```
/plugin install memory-enhancement@kwitsch-plugins
```

## Skills

| Skill | What it does |
| --- | --- |
| `dream` | Consolidates this project's auto-memory files in four phases (orient, gather signal, consolidate, update the MEMORY.md index), optionally compressing touched detail files via `claude-code-knowledge`'s `cc-compress` when that plugin is enabled, and optionally refreshing coding-toolbox's user-level tool-routing rule when that plugin is installed and the rule already exists. |
| `self-improvement` | Reflects on the current session's own tool calls and reasoning to find concrete ways the task could have been solved faster or more efficiently, reports a summary to the user, and saves durable, deduped lessons as feedback memory. |

## What it does

Say "dream" (or describe wanting to consolidate/clean up memory) and the
`dream` skill runs four phases over `~/.claude/projects/<project>/memory/`:
orient, gather signal from recent session transcripts, consolidate (merge
duplicates, drop stale entries, resolve contradictions, author a new memory file
for any signal with no existing memory home, back up each existing changed
detail file alongside itself), and update the `MEMORY.md` index -- keeping it under
its 200-line load cutoff. If `claude-code-knowledge` is enabled, touched
detail files also get compressed caveman-style via its `cc-compress` skill --
no hard dependency, silent no-op if that plugin isn't installed. If
`coding-toolbox` is installed and its `~/.claude/rules/coding-toolbox-tools.md`
tool-routing rule already exists, dream also refreshes it -- again no hard
dependency, silent no-op otherwise, and dream never installs that file itself.
Only files that actually need a change are touched -- untouched memory files
are left byte-for-byte alone.

A `Stop` hook flags a genuinely new next session (not a same-session
`/clear`, `/compact`, or `--resume`) as dream-due; a `SessionStart` hook
consumes that flag and nudges Claude to run a cycle. On by default -- set
`auto_dream` to `false` to keep the flag silent.
