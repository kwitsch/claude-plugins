---
name: universal-lint
description: >-
  User-invoked. Takes a free-text description of a set of files ("all files in src/",
  "files changed in PR 123", or an explicit list) and lints each of them exactly as this
  plugin's Write/Edit hook would — read-only, no autofix — printing one aggregated findings
  report. Self-contained: depends on no other plugin.
argument-hint: "[files description, e.g. 'all files in src/' or 'files changed in PR 123']"
allowed-tools: ["Glob", "Read", "Write", "AskUserQuestion", "Bash(git:*)", "Bash(gh:*)", "Bash(node:*)", "Bash(mktemp:*)"]
disable-model-invocation: true
---

# universal-lint

Lints every file you name — in natural language — exactly as this plugin's always-on
`Write`/`Edit` hook would: each language's standard linter, read-only, findings only, never a
change to any file. The whole trailing text of the command binds to `$ARGUMENTS`. Reuses the
plugin's own tested hook logic through a colocated driver — no new linting logic, no other plugin.

## Steps

1. **Resolve `$ARGUMENTS` into a concrete file list**, deterministically, yourself:
   - an explicit list ("these files: a b c") → use the named paths as-is;
   - "all files in <folder-or-glob>" → in a git repo
     `git -c core.quotePath=false ls-files --cached --others --exclude-standard -- <folder>` (a glob
     goes in as `':(glob)<glob>'`; paths come out cwd-relative, with no cap). Outside a repo use the
     `Glob` tool, which lists at most 100 files: when its result says it shows only part of the
     matches, split the pattern by subdirectory until no result is truncated — never pass a
     truncated list on;
   - "files changed in PR <N>" → run `gh auth status` first (it exits non-zero for both a
     missing PR and a dead token, so auth is checked before the diff), then
     `gh pr diff <N> --name-only`; the driver lints the working tree, not the PR, so compare
     `gh pr view <N> --json headRefOid -q .headRefOid` with `git rev-parse HEAD`: if they differ,
     stop and tell the user to run `gh pr checkout <N>` first (files the PR adds would be dropped
     and the rest linted at this checkout's version) — lint the local copies only if the user
     explicitly agrees;
   - "files changed on this branch / in the working tree" →
     `git -c core.quotePath=false diff --relative --name-only <base>...HEAD`
     or `git -c core.quotePath=false status --porcelain --untracked-files=all` (without
     `core.quotePath=false` git prints non-ASCII names as quoted octal escapes, which the driver
     drops as missing files; without `--untracked-files=all` git shows a new directory as one `dir/`
     entry, whose files the driver never lints); a path git still wraps in double quotes (it
     contains a space, a quote, a backslash or a control character) must be unquoted before it goes
     into the list;
   - `gh pr diff` and `git status --porcelain` print repo-root-relative paths, but the driver
     resolves each path against the cwd: put `$(git rev-parse --show-toplevel)/` in front of each
     of their paths (absolute) before writing the list;
   - empty or genuinely ambiguous `$ARGUMENTS` → ask with `AskUserQuestion` (offer 2-3 example
     scopes as options; the real answer arrives via "Other"). Never guess a scope.

   If a `gh`/`git` command fails (no auth, PR not found, not a repo), surface its own error and
   stop — do not run the driver on a partial or empty list.

2. **Announce** the resolved list (count + paths) so the user sees what will be linted, then
   proceed. There is no confirmation gate — linting is read-only and was explicitly invoked.

3. **Read `lint-files.reference.md`** (colocated) for the driver's invocation contract, per its
   table.

4. **Write the list to a temp file, then run the driver.** Get a unique directory with `mktemp -d`
   (a directory, not a file: `Write` refuses to overwrite an existing file it has not read, and
   `mktemp -u` would bring back the create race), then use the `Write` tool to create
   `<dir>/list.txt` with one resolved path per line (the `Write` tool authors the file content, so
   no path text is ever interpolated into a shell command), then run:

   ```bash
   node ${CLAUDE_SKILL_DIR}/lint-files.mjs "<dir>/list.txt"
   ```

   `${CLAUDE_SKILL_DIR}` is the bare pre-injection substitution token — never a live shell
   environment variable.

5. **Report** the driver's printed findings report verbatim.
