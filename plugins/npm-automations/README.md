# npm-automations

## Install

```
/plugin install npm-automations@kwitsch-plugins
```

## What it does

Centralizes npm-lifecycle automation hooks, run in-process by Claude Code (no
process starts per tool call; only the install itself runs as a background
process). Every hook below is on by default and
independently toggleable via its own plugin setting (only the literal value `false`
disables it).

Both hooks pick the package manager from whichever lockfile is present
(`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `package-lock.json` → npm — pnpm/yarn
take priority if more than one lockfile exists) and look for that manager's binary
at `~/.local/bin` in addition to the inherited `PATH`, covering standalone/corepack
installs that land there.

- **Clean install on worktree entry:** after `EnterWorktree` creates or
  switches into a worktree whose project has a lockfile, runs that manager's
  lockfile-frozen install there in the background (`npm ci` / `pnpm install
--frozen-lockfile` / `yarn install --frozen-lockfile`; never blocks the agent).
  Toggle: `npm_ci_on_worktree`. Silent on success; a real install failure or
  a missing binary on `PATH` surfaces as context on the next turn.
- **Install on package.json dependency change:** after a
  `Write`/`Edit` to any `package.json` whose `dependencies`/`devDependencies`/
  `optionalDependencies` actually changed, runs an install scoped to only the
  changed specs in the background (`npm install`/`pnpm add`/`yarn add`, or npm by
  default when no lockfile exists yet) — a version-only (or other non-dependency)
  change triggers no call at all. Toggle: `npm_install_on_package_change`. Silent
  on success; a failure or a missing binary surfaces as context on the next turn.

Installs into the same directory within a session run one after another, so two
installs never race there.
