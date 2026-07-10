# memory-enhancement

A dream skill that consolidates this project's auto-memory files, plus a
Stop/SessionStart hook pair that nudges the next session to run one.

## Install

```
/plugin install memory-enhancement@kwitsch-plugins
```

## Skills

| Skill | What it does |
|---|---|
| `dream` | Consolidates this project's auto-memory files in four phases (orient, gather signal, consolidate, update the MEMORY.md index), compressing touched detail files via `cc-compress`. |

## What it does

Say "dream" (or describe wanting to consolidate/clean up memory) and the
`dream` skill runs four phases over `~/.claude/projects/<project>/memory/`:
orient, gather signal from recent session transcripts, consolidate (merge
duplicates, drop stale entries, resolve contradictions, back up each changed
file alongside itself), and update the `MEMORY.md` index -- keeping it under
its 200-line load cutoff. Touched detail files get compressed caveman-style
via `claude-code-knowledge`'s `cc-compress`. Only files that actually need a
change are touched -- untouched memory files are left byte-for-byte alone.

A `Stop` hook flags the next session as dream-due; a `SessionStart` hook
consumes that flag and nudges Claude to run a cycle, gated by the
`auto_dream` toggle (default `true` -- set `false` to keep the flag silent).
