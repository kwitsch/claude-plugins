---
name: universal-format
description: >-
  User-invoked. Takes a free-text description of a set of files ("all files in src/",
  "files changed in PR 123", or an explicit list) and formats each of them exactly as this
  plugin's Write/Edit hooks would — all 17 languages, formatting files in place. Self-contained:
  depends on no other plugin.
argument-hint: "[files description, e.g. 'all files in src/' or 'files changed in PR 123']"
arguments: file_scope
allowed-tools: ["Glob", "Read", "Write", "AskUserQuestion", "Bash(git:*)", "Bash(gh:*)", "Bash(node:*)", "Bash(mktemp:*)"]
disable-model-invocation: true
---

# universal-format

Formats every file you name — in natural language — exactly as this plugin's always-on
`Write`/`Edit` hooks would: the 13 Prettier languages in-process before the write, the 4 CLI
languages (Kotlin, Python, Go, Rust) via their own tool after it. The whole trailing text of the
command binds to `$file_scope`. Reuses the plugin's own tested hook logic through a colocated
driver — no new formatting logic, no other plugin.

## Steps

1. **Resolve `$file_scope` into a concrete file list**, deterministically, yourself:
   - an explicit list ("these files: a b c") → use the named paths as-is;
   - "all files in <folder-or-glob>" → the `Glob` tool;
   - "files changed in PR <N>" → run `gh auth status` first (it exits non-zero for both a
     missing PR and a dead token, so auth is checked before the diff), then
     `gh pr diff <N> --name-only`;
   - "files changed on this branch / in the working tree" → `git diff --name-only <base>...HEAD`
     or `git status --porcelain`;
   - empty or genuinely ambiguous `$file_scope` → ask with `AskUserQuestion` (offer 2-3 example
     scopes as options; the real answer arrives via "Other"). Never guess a scope.

   If a `gh`/`git` command fails (no auth, PR not found, not a repo), surface its own error and
   stop — do not run the driver on a partial or empty list.

2. **Announce** the resolved list (count + paths) so the user sees what will be formatted, then
   proceed. There is no confirmation gate — formatting is idempotent, matches the always-on hook,
   and was explicitly invoked.

3. **Read `format-files.reference.md`** (colocated) for the driver's invocation contract, per its
   table.

4. **Write the list to a temp file, then run the driver.** Get a unique path with `mktemp`, use
   the `Write` tool to write one resolved path per line into it (the `Write` tool authors the
   file content, so no path text is ever interpolated into a shell command), then run:

   ```bash
   node ${CLAUDE_SKILL_DIR}/format-files.mjs "$LIST"
   ```

   `${CLAUDE_SKILL_DIR}` is the bare pre-injection substitution token — never a live shell
   environment variable.

5. **Report** the driver's printed summary verbatim.
