---
name: stat
description: Show cave-context savings — context-mode context-window savings (measured via ctx_stats) plus the active caveman compression level. Read-only. Trigger /cave-context:stat.
---

# cave-context:stat

Report cave-context's savings surfaces in one place. Read-only — never reset.

## Steps

1. **context-mode savings (measured).** Call the `ctx_stats` tool (proxied
   through the cave-context server). Display its output verbatim — token
   consumption, context-savings ratio, per-tool breakdown. This is the real
   measured number.

2. **Active caveman level.** Report the active compression level from the
   cave-context state file:

   ```bash
   cat "${CLAUDE_PLUGIN_DATA:-$HOME/.claude/cave-context}/active-level" 2>/dev/null || echo "off"
   ```

   Report the level (`lite` / `full` / `ultra`, or `off` when absent). caveman
   trims output verbosity, but cave-context does NOT separately meter caveman
   token savings — report the active level only; never fabricate a savings
   number for it.

3. **Combine.** One short summary: context-mode context-savings ratio (step 1) +
   active caveman level (step 2).

Output in caveman:compress format (terse; numbers exact).
