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
