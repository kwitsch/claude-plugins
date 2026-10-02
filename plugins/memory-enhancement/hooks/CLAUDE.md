# CLAUDE.md — memory-enhancement/hooks

## `hooks/flag-dream-due.mjs`

- Event/matcher: `Stop`, command hook, no matcher — fires every turn.
- Gate: none. No `user_config` read; gating happens once, at SessionStart.
- Behavior:
  - Touches `${CLAUDE_PLUGIN_DATA}/dream-due-<hash>.flag`, skipping the write entirely when it already exists.
  - `<hash>` is the first 8 hex chars of `sha256(realpath(${CLAUDE_PROJECT_DIR}))`.
  - Is the shared home for `flagPathFor` / `isMainModule`, which `check-dream-due.mjs` imports instead of duplicating; `isMainModule` takes the caller's own `import.meta.url` so the entry-point check still targets the right file.
- Why:
  - Hash `fs.realpathSync`, not a plain `path.resolve`: two symlink variants of the same project dir must hash identically (same idiom as `cc-compress`'s `backupPathFor`).

## `hooks/check-dream-due.mjs`

- Event/matcher: `SessionStart`, command hook, **matcher `startup` only**.
- Gate: reads `auto_dream` via `${user_config.auto_dream}` interpolated into `argv[2]`.
  - Fail-open: only the literal string `"false"` disables.
  - Checked **before** reading stdin, so a disabled hook skips the parse entirely.
- Behavior: when enabled and this project's flag file exists, injects a natural-language `additionalContext` nudge to run a dream cycle, then deletes the flag (consumed once).
- Why:
  - `resume`/`clear`/`compact` are excluded because `Stop` fires every turn: any of them would consume a flag set moments earlier and nudge mid-session, contradicting the documented "flags the next session" behavior. `resume` in particular continues the very session it was suspended from.
  - Fail-open despite the plugin-userconfig state-creating-toggle rule: this hook creates no files and only suggests a dream cycle via `additionalContext` (same reasoning as `universal-format`'s `auto_format`).
