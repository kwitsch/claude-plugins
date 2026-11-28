# statusbar

Keeps Claude Code's status line current while long work runs: the folder, the git branch, the context use and the 5-hour and 7-day quota, refreshed after every turn and at least every 10 seconds, so hour-long workflows that complete no turn still show the current 5-hour quota.

## What it shows

`📂 <folder> | ⎇ <branch> | 🗃️ <context>% | 🕔 <5-hour>% | 🗓️ <7-day>%`

- Folder: the last part of the session's directory; red when it is not inside a git repository.
- Branch: the checked-out branch (`feature/x` stays whole); a detached HEAD shows the first 7 characters of its commit hash; no branch segment outside git.
- Context: green up to 60 %, yellow up to 80 %, red above; `0%` without colour while Claude Code has no figure yet.
- 5-hour quota: green below 80 %, yellow from 80 %, red from 90 %; `0%` without colour while there is no figure.
- 7-day quota: only from 80 %, yellow, red from 90 %.

Percentages are rounded half to even (60.5 % shows 60 %).

## How it works

You keep your own `statusLine` command in your settings; this plugin does not read or change your settings. Once the plugin has computed its first line, it replaces the text your command printed with its own line, so the line appears once. Until then your command's output shows unchanged. Without a `statusLine` entry in your settings the line still shows.

## Limits

- The branch is read from the `.git` files, not by running git: `GIT_DIR` / `GIT_WORK_TREE` overrides, `core.worktree` and checked-out refs outside `refs/heads/` are not followed.
- A detached HEAD always shows 7 hash characters, even where git would print more to stay unique.
- It only draws where Claude Code has a status line (the terminal); other surfaces are unchanged.
- No options: disable the plugin to get your command's own line back.
