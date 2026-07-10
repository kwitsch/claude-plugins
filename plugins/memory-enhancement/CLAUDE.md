# CLAUDE.md — memory-enhancement

One skill (`dream`) plus a Stop/SessionStart command-hook pair that
auto-nudges it, replicating an "auto-dream" style consolidation cycle on top
of Claude Code's native auto-memory feature (v2.1.59+).

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
  transcripts -- never a full read), consolidate (merge/drop/resolve, sibling
  `.bak` backup before writing, then `Skill(claude-code-knowledge:cc-compress)
  --confirmed` on every touched non-MEMORY.md file), update the MEMORY.md
  index (kept under 200 lines/25KB, written directly -- never passed through
  `cc-compress`, whose path-preservation regex doesn't protect its
  bare-filename links).

## Tests

`test/memory-enhancement/test.bats` (bats) + `test/memory-enhancement/hooks.test.mjs`
(`node --test`). Run:
```bash
BATS_LIB_PATH="$PWD/node_modules" npx bats test/memory-enhancement/
npm run test:unit
npm run typecheck
```
