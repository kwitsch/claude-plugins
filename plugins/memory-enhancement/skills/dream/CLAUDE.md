# CLAUDE.md — memory-enhancement/skills/dream

Design rationale not already in `SKILL.md` (its own file documents the four-phase
procedure step by step — orient/gather/consolidate/update — read it for the
mechanics; this file holds only the _why_ behind cross-file design choices):

- Phase 3's `cc-knowledge:cc-compress` integration (compresses every
  touched non-MEMORY.md file, `--confirmed`, only if that skill is among this
  session's available skills) carries **no hard dependency** — `plugin.json`
  deliberately declares none, since a hard dependency would auto-cascade-install
  `cc-knowledge` and make the "else silent no-op" branch nearly
  unreachable. Unavailable → skip compression for that run, no note in the
  summary.
- Phase 4's MEMORY.md index update is written directly, never passed through
  `cc-compress` — its path-preservation regex doesn't protect the index's
  bare-filename links.
- The graphmind branch (Phase 1 probe, Phase 3 new findings) uses the
  `graphmind` CLI, not the `gm_memory_*` MCP tools: the CLI resolves the
  cwd's project itself (a linked worktree auto-registers and shares memory
  with its parent repo), needs no deferred-tool loading or absolute project
  path, and works when the MCP server failed to connect. Only _new_ findings
  move; existing memory files are still consolidated and `MEMORY.md` is
  still maintained, because Claude Code keeps loading it every session. No
  `userConfig` toggle: registering the project with graphmind is the
  opt-in, and dream is an on-demand skill (the `auto_dream` toggle only
  gates the nudge). Keep `hooks/dream.mjs` `NUDGE` and `self-improvement`
  Step 3 in parity with this branch.
