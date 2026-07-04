---
name: cc-compress
description: Compress a markdown memory/instruction file (CLAUDE.md, todos, preferences) into dense caveman-style prose, cutting the token cost of loading it on every future session. Preserves code blocks, inline code, URLs, file paths, commands, headings, and YAML frontmatter exactly. Backs up the original to session-temp storage for rollback before overwriting the source in place. Use when the user asks to compress, shrink, or reduce tokens in a markdown memory or instructions file.
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

## 2. Recoverability gate

Run, from the target file's directory:

```bash
git ls-files --error-unmatch -- "<file>" && git status --porcelain -- "<file>"
```

- **Tracked and clean** (first command succeeds, second prints nothing) → git
  itself is a second rollback path (`git checkout -- <file>`). Proceed.
- **Untracked, or dirty** → the session-temp backup (step 3) is the *only*
  rollback path. Ask via `AskUserQuestion`: proceed anyway, or cancel.

## 3. Resolve the backup root (once per session)

Prefer the session scratchpad directory from your system prompt when one is
provided. Otherwise run `mktemp -d -t cc-compress-XXXXXX` once and reuse that
same directory for every `cc-compress` call in this session. Never place the
backup next to the source file.

## 4. Run the script

```bash
node ${CLAUDE_SKILL_DIR}/scripts/compress.mjs "<absolute-filepath>" "<backup-root>"
```

Exit codes: `0` = success or clean skip (not a markdown file); `1` = usage
error, refusal (sensitive filename, empty file, existing backup), or I/O
failure; `2` = compression failed validation after retries. Validation and
retries happen entirely on in-memory text — the source file is written at most
once, only after a valid result exists, so every non-zero exit leaves it
byte-for-byte untouched (there is nothing to restore).

## 5. Report

- **Success:** state the compressed file path and the printed backup path
  plainly — the backup is the rollback source (copy its content back over the
  compressed file to undo). Mention it lives in session-temp storage, so it may
  not survive past this session.
- **Skip (not markdown):** say so; nothing changed.
- **Failure:** relay the script's printed reason. The original file was never
  touched — never left half-compressed.
