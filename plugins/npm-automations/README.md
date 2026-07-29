# npm-automations

## Install

```
/plugin install npm-automations@kwitsch-plugins
```

## What it does

Centralizes npm-lifecycle automation hooks. Every hook below is on by default and
independently toggleable via its own plugin setting (only the literal value `false`
disables it).

- **npm ci on worktree entry (PostToolUse):** after `EnterWorktree` creates or
  switches into a worktree whose project has a `package-lock.json`, runs `npm ci`
  there in the background (`async`, never blocks the agent). Toggle:
  `npm_ci_on_worktree`. Silent on success; a real `npm ci` failure or a missing
  `npm` on `PATH` surfaces as context on the next turn.
- **npm install on package.json dependency change (PostToolUse):** after a
  `Write`/`Edit` to any `package.json` whose `dependencies`/`devDependencies`/
  `optionalDependencies` actually changed, runs `npm install` scoped to only the
  changed specs in the background — a version-only (or other non-dependency) change
  triggers no npm call at all. Toggle: `npm_install_on_package_change`. Concurrent
  edits to the same `package.json` are serialized with a filesystem lock so two
  installs never race in the same directory.
