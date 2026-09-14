# CLAUDE.md — memory-enhancement/skills/dream

Design rationale not already in `SKILL.md` (its own file documents the four-phase
procedure step by step — orient/gather/consolidate/update — read it for the
mechanics; this file holds only the _why_ behind cross-file design choices):

- Phase 3's `claude-code-knowledge:cc-compress` integration (compresses every
  touched non-MEMORY.md file, `--confirmed`, only if that skill is among this
  session's available skills) carries **no hard dependency** — `plugin.json`
  deliberately declares none, since a hard dependency would auto-cascade-install
  `claude-code-knowledge` and make the "else silent no-op" branch nearly
  unreachable. Unavailable → skip compression for that run, no note in the
  summary.
- Phase 4's MEMORY.md index update is written directly, never passed through
  `cc-compress` — its path-preservation regex doesn't protect the index's
  bare-filename links.
