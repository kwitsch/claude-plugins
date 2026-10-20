# CLAUDE.md — dprint/hooks

Wiring lives in `register.ts`, logic in `detect.mjs`. Only rationale and pitfalls are kept here.

## `session.start` (missing-dprint toast)

- Awaits `next(e)` first and returns its result unchanged; any throw after it is caught (fail open).
- Skipped when `!e.isInteractive`: nobody sees a toast in a `-p` or SDK run.
- No `$.session.turns()` guard: a toast never enters the transcript, so a resume, continue or plugin reload re-checks without duplicating anything. Re-warning at each session start is intended.
- Config probe: `CONFIG_PATHS` under `e.cwd` (cwd first, then `.config/`), `$.fs.stat` kind `file`; first hit wins.
- Installed probe mirrors `check-dprint.mjs` `findDprint` (each PATH entry's `dprint`, then `~/.dprint/bin/dprint`), stat only, no spawn. The two lookups MUST change together.
- X_OK shortcut: `FsStat` has no mode bits, so a non-executable `dprint` file counts as installed (`findDprint` also tests X_OK).
- This is the repo's first `$.ui.toast` use: ephemeral, user-only, never seen by the model; the engine prefixes the plugin name, so the text never names the plugin. Timeout 10 s.

## Toggle

- `warn_missing_dprint`, read from `register`'s `options`; when off, `register` registers nothing.
- Fail-open (only `false`/`"false"` disables) because the toast creates no file or state, per `.claude/rules/plugin-userconfig.md`.
