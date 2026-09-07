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
- **Optional Phase 5** invokes `coding-toolbox:refresh-tools-rule` (not
  `coding-toolbox:setup-rules`, which stays user-only) to refresh
  `~/.claude/rules/coding-toolbox-tools.md` — no hard dependency, same
  reasoning as the `cc-compress` integration, silent no-op when the skill is
  absent. That skill is the intentional integration point: an earlier design
  had dream call `setup-rules` directly once it became model-invocable, but an
  altitude review during `coding-toolbox`'s own `fresh-work` Review step
  flagged that loosening `setup-rules`'s invocation control to serve this one
  narrow, non-destructive need would also expose its destructive
  install/remove verbs to any session — so a separate, provably
  non-destructive `refresh-tools-rule` skill was split out instead (see
  `plugins/coding-toolbox/skills/refresh-tools-rule/CLAUDE.md` for the full
  rationale). Dream itself no longer checks whether the tools-rule file
  exists — that gate moved into `refresh-tools-rule`, which no-ops safely
  either way.
