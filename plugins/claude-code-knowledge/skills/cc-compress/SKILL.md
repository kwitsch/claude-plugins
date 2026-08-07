---
name: cc-compress
description: Compress a markdown memory/instruction file (CLAUDE.md, todos, preferences) into dense caveman-style prose, cutting the token cost of loading it on every future session. Hard-enforces (retries, then fails rather than write a bad result) exact preservation of code blocks, inline code, URLs, heading count, and YAML frontmatter; flags (non-blocking) drift in file paths, heading wording, and bullet count. Backs up the original to session-temp storage for rollback before overwriting the source in place. Use when the user asks to compress, shrink, or reduce tokens in a markdown memory or instructions file.
argument-hint: [filepath]
allowed-tools: Bash, AskUserQuestion
---

# cc-compress — compress a markdown file into caveman-style prose

Adaptation of the upstream `caveman-compress` skill (JuliusBrussee/caveman),
ported to a zero-dep Node script, scoped to markdown files only, with the
`.original.md` backup relocated to session-temp storage instead of sitting next
to the source file.

> **Ask the user via `AskUserQuestion`.** When this skill needs a decision from
> the user, it MUST present the question through the `AskUserQuestion` tool —
> never as plain prose that waits for a typed reply.

## 1. Resolve the target file

Take the filepath from `$ARGUMENTS`. If none was given, ask via
`AskUserQuestion` (illustrative examples: `CLAUDE.md`, a todo file, a
preferences doc; free text arrives via "Other"). Resolve it to an absolute path.

## 2. Resolve the backup root (once per session)

Prefer the session scratchpad directory from your system prompt when one is
provided. Otherwise run `mktemp -d -t cc-compress-XXXXXX` once and reuse that
same directory for every `cc-compress` call in this session. Never place the
backup next to the source file.

## 3. Run the script

```bash
node ${CLAUDE_SKILL_DIR}/scripts/compress.mjs "<absolute-filepath>" "<backup-root>"
```

The script itself checks git recoverability (tracked-and-clean means
`git checkout -- <file>` is a second rollback path alongside the session-temp
backup) before touching anything.

Exit codes: `0` = success or clean skip (not a markdown file); `1` = usage
error, refusal (sensitive filename, empty file, existing/concurrent backup), or
I/O failure; `2` = compression failed validation after retries; `3` = the
target is untracked or has uncommitted changes, so the session-temp backup
would be the _only_ rollback path — nothing was touched yet.

**On exit 3:** ask via `AskUserQuestion` whether to proceed anyway (session-temp
backup only) or cancel. If the user says proceed, re-run the exact same command
with `--confirmed` appended. Any other exit code needs no confirmation step.

Validation and retries happen entirely on in-memory text — the source file is
written at most once, only after a valid result exists, so every non-zero exit
(besides a resolved exit 3) leaves it byte-for-byte untouched.

## 4. Report

- **Success:** state the compressed file path and the printed backup path
  plainly — the backup is the rollback source (copy its content back over the
  compressed file to undo). Mention it lives in session-temp storage, so it may
  not survive past this session.
- **Skip (not markdown):** say so; nothing changed.
- **Cancelled at the exit-3 gate:** say so; nothing changed.
- **Failure:** relay the script's printed reason. The original file was never
  touched — never left half-compressed.
