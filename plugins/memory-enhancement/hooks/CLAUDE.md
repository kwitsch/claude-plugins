# CLAUDE.md — memory-enhancement/hooks

Mods hooks module (0.5.0+), replacing the 0.4.x `Stop` / `SessionStart`
command hooks (`flag-dream-due.mjs`, `check-dream-due.mjs`). No process is
spawned per turn.

## The flag

- A key in the plugin's own `$.store` (cross-session JSON file under the
  config dir, e.g. `~/.claude/plugins/store/memory-enhancement_<marketplace>-<id>.json`):
  `dream-due:<hash>` → `true`; presence = due.
- `<hash>`: first 8 hex chars of `sha256(realpath(project root))`
  (`dueKey` in `dream.mjs`, `crypto.subtle`), the 0.4.x flag file's hash.
  Project root is `$.session.root()`, realpath via
  `$.fs.stat(root, { resolve: true })`, the root as given when it does not
  resolve. Realpath so symlink variants of one project dir share a key (same
  idiom as `cc-compress`'s `backupPathFor`).
- Why `$.store`, not the 0.4.x `${CLAUDE_PLUGIN_DATA}/dream-due-<hash>.flag`
  files: a mod gets no `CLAUDE_PLUGIN_DATA` (live-checked, 2.1.302) and `$.fs`
  has no delete, so files would need a copied data-dir layout plus an `rm`
  process.
- Deliberate one-time migration loss: legacy `.flag` files are ignored (never
  read, never deleted), so a project flagged under 0.4.x misses at most one
  nudge after the upgrade; its first 0.5.0 turn end sets the key again.

## `turn.complete` (was `Stop`)

- Main loop only: skips `e.agentId !== undefined`, and `aborted` / `error`
  ends (the old `Stop` did not fire on an interrupt or an API error).
- Gate: none — the flag stays fresh whatever `auto_dream` says.
- Sets the key only when missing; never alters `next(e)`'s result;
  any error is swallowed.

## `session.start` (was `SessionStart` matcher `startup`)

- Registered only while `auto_dream` is enabled (`isAutoDreamEnabled`:
  only `false` / `"false"` disables; fail-open, the hook creates no state —
  same reasoning as `universal-format`'s `auto_format`).
- `session.start` has no source field and fires once per process plus on a
  plugin enable / reload, never on `/clear` or `/compact`. `startup` is
  matched as "the transcript holds no user turn yet" (`$.session.turns() === 0`):
  `--resume` / `--continue` and a mid-session reload see turns > 0 and keep
  the flag (live-verified on `--resume`). Why only startup: the turn-end hook
  fires every turn, so any other source would consume a flag set moments
  earlier and nudge mid-session.
- Key set → `$.store.delete(key)`, then (a failed delete throws first)
  `$.session.append` of a user row with `NUDGE` (stored `isMeta`, read by the
  model like the old `additionalContext`). Consumed once.
