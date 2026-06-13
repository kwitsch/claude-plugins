---
name: stat
description: Show combined cave-context savings — caveman token reduction (from the Claude Code session log) plus context-mode context-window savings (via ctx_stats). Read-only. Trigger /cave-context:stat.
---

# cave-context:stat

Report both savings surfaces in one place. Read-only — never reset.

## Steps

1. **context-mode savings.** Call the `ctx_stats` tool (proxied through the
   cave-context server). Display its output verbatim — token consumption,
   context-savings ratio, per-tool breakdown.

2. **caveman token savings.** Read the current Claude Code session log and
   estimate token reduction from terse/caveman responses (the way caveman-stats
   does — measured from the log, not model-estimated). If the log is
   unavailable, say so; do not fabricate numbers.

3. **Combine.** Present one short summary: context-mode context-savings ratio +
   caveman token reduction + active caveman level (read from the cave-context
   state file).

Output in caveman:compress format (terse; numbers exact).
