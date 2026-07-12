# CLAUDE.md — memory-enhancement

Two skills (`dream`, `self-improvement`) plus a Stop/SessionStart
command-hook pair that auto-nudges `dream`, replicating an "auto-dream"
style consolidation cycle on top of Claude Code's native auto-memory
feature (v2.1.59+).

## Behavior

- `hooks/flag-dream-due.mjs` (`Stop`, command, no matcher -- fires every
  turn): unconditionally touches/refreshes (skipping the write entirely if
  already present)
  `${CLAUDE_PLUGIN_DATA}/dream-due-<hash>.flag`, where `<hash>` is the first
  8 hex chars of `sha256(realpath(${CLAUDE_PROJECT_DIR}))` (`fs.realpathSync`,
  not a plain `path.resolve` -- two symlink variants of the same project dir
  must hash identically; mirrors `cc-compress`'s own `backupPathFor`
  hash-suffix idiom). Also the shared home for `flagPathFor`/`isMainModule`,
  which `check-dream-due.mjs` imports rather than duplicating (`isMainModule`
  takes the caller's own `import.meta.url` as a parameter so the entry-point
  check still targets the right file when shared). No `user_config` read
  here -- gating happens once, at SessionStart.
- `hooks/check-dream-due.mjs` (`SessionStart`, command, **matcher `startup`
  only** -- deliberately excludes `resume`/`clear`/`compact`: `resume`
  continues the same session it was suspended from, and `Stop` fires every
  turn, so any of those would otherwise consume a flag set moments earlier
  and nudge mid-session instead of at a genuinely new next session,
  contradicting the documented "flags the next session" behavior): reads
  `auto_dream` via `${user_config.auto_dream}`
  interpolated into `argv[2]` (documented in the plugins reference: "Plugin
  hooks/commands additionally substitute `${user_config.*}`") -- **fail-open**,
  only the literal string `"false"` disables (the plugin-userconfig
  state-creating-toggle exception does not apply here: this hook itself
  creates no files, it only suggests a dream cycle via `additionalContext`;
  same reasoning as `universal-format`'s `auto_format`). Checks this gate
  **before** reading stdin (skips the parse entirely when disabled). If
  enabled and this project's flag file exists, injects a natural-language
  `additionalContext` nudge and deletes the flag (consumed once).
- `skills/dream/SKILL.md`: four phases -- orient (read the memory path from
  the session's own auto-memory system-prompt block, never recomputed),
  gather signal (targeted `rg` over the most recent 8 main-session `*.jsonl`
  transcripts -- never a full read), consolidate (merge/drop/resolve, author
  a new memory file for any signal with no existing memory home, sibling
  `.bak` backup before writing for each existing changed file (a
  newly-authored file has nothing to back up), then — only if `claude-code-knowledge:cc-compress`
  is among this session's available skills — `Skill(claude-code-knowledge:cc-compress)
  --confirmed` on every touched non-MEMORY.md file; **no hard dependency** —
  `plugin.json` deliberately declares none, since a hard dependency would
  auto-cascade-install `claude-code-knowledge` and make the "else silent
  no-op" branch nearly unreachable; unavailable → skip compression for that
  run, no note in the summary), update the MEMORY.md
  index (kept under 200 lines/25KB, written directly -- never passed through
  `cc-compress`, whose path-preservation regex doesn't protect its
  bare-filename links).
- Optional Phase 5 (2026-07-10): if `coding-toolbox:refresh-tools-rule` is
  available this session, dream invokes it with no arguments
  (`Skill(coding-toolbox:refresh-tools-rule)`) to refresh
  `~/.claude/rules/coding-toolbox-tools.md` -- no hard dependency
  (`plugin.json` declares none, same reasoning as the `cc-compress`
  integration), silent no-op when the skill is absent. That skill (not
  `coding-toolbox:setup-rules`, which stays user-only) is the intentional
  integration point: an earlier design had dream call `setup-rules` directly
  once it became model-invocable, but an altitude review during
  `coding-toolbox-plugins`' own `fresh-work` Review step flagged that
  loosening `setup-rules`' invocation control to serve this one narrow,
  non-destructive need would also expose its destructive install/remove
  verbs to any session -- so a separate, provably non-destructive
  `refresh-tools-rule` skill was split out instead (see
  `coding-toolbox/CLAUDE.md`'s "Skill design (`refresh-tools-rule`)" for the
  full rationale). Dream itself no longer checks whether the tools-rule file
  exists -- that gate moved into `refresh-tools-rule`, which no-ops safely
  either way.
- `skills/self-improvement/SKILL.md`: on-demand retro skill, runs inline
  (no `context: fork` -- an isolated subagent has no session history to
  reflect on). Three steps: reflect on this session's own tool
  calls/reasoning against a fixed efficiency-retro prompt; report a
  concrete-bullet summary to the user (always, regardless of whether
  anything is saved); save durable, generalizable lessons as
  `feedback`-type memory via the auto-memory two-step save process,
  gated by a hard dedup check against `MEMORY.md` and its own running
  memory file (`feedback_self_improvement_efficiency.md`) so repeated
  runs don't accumulate near-duplicate entries. No hooks, no `userConfig`
  toggle -- unlike `dream`'s auto-nudge, this is a plain on-demand skill,
  consistent with this repo's precedent that on-demand skills aren't
  toggle-gated.

## Tests

`test/memory-enhancement/test.bats` (bats) + `test/memory-enhancement/hooks.test.mjs`
(`node --test`). Run:
```bash
BATS_LIB_PATH="$PWD/node_modules" npx bats test/memory-enhancement/
npm run test:unit
npm run typecheck
```
