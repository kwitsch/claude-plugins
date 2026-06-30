# coding-toolbox

## Install

```
/plugin install coding-toolbox@kwitsch-plugins
```

## What it does

Injects a compact "golden behavior rules" contract into every Claude Code session and
re-surfaces a short reminder before consequential tool calls, so the rules stay in
context and are enforced.

The rules document is written in cavemem's compressed-English notation and combines
three sources along three axes:

| Axis | Source | Contributes |
|---|---|---|
| **Language** | [cavemem `docs/compression.md`](https://github.com/JuliusBrussee/cavemem/blob/main/docs/compression.md) | write compactly; preserve technical tokens |
| **Behavior** | [andrej-karpathy-skills `CLAUDE.md`](https://github.com/multica-ai/andrej-karpathy-skills/blob/main/CLAUDE.md) | think → simplify → surgical → verify |
| **Mentality** | [ponytail-lite `AGENTS.md`](https://github.com/ilindaniel/ponytail-lite/blob/main/AGENTS.md) | lazy senior dev; YAGNI; prefer deletion |

- A `SessionStart` hook injects the full rules document (it re-fires on resume and after
  compaction, so the rules survive a compaction).
- A `PreToolUse` hook (scoped to `Edit`, `Write`, `NotebookEdit`, `Bash`, `Task`,
  `Agent`) injects a one-line reminder before code edits, shell commands, and subagent
  dispatch.

No configuration; nothing to set up — enabling the plugin is enough.
