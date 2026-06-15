---
name: stat
description: Show cave-context savings — context-mode context-window savings measured via ctx_stats. Read-only. Trigger /cave-context:stat.
---

# cave-context:stat

Report cave-context's measured savings. Read-only — never reset.

## Steps

1. **context-mode savings (measured).** Call the `ctx_stats` tool (proxied
   through the cave-context server). Display its output verbatim — token
   consumption, context-savings ratio, per-tool breakdown. This is the real
   measured number.

2. **Caveman level.** Fixed at `full` — no level state to read. caveman trims
   output verbosity, but cave-context does NOT separately meter caveman token
   savings; never fabricate a savings number for it.

3. **Combine.** One short summary: context-mode context-savings ratio (step 1),
   caveman level full.

Output in caveman:compress format (terse; numbers exact).
