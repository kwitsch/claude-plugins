---
name: cave-compress
description: Compress a single Markdown file in place using the caveman terse-encoding ruleset — cut prose tokens while preserving every fact and verbatim region (code, paths, URLs, numbers, frontmatter). Use when asked to compress/shrink/condense a Markdown doc, or proactively on a verbose Markdown file under the auto-allowed paths. Auto-allows **/CLAUDE.md, docs/**/*.md, plan/**/*.md; any other .md needs explicit confirmation.
when_to_use: |
  Invoke when the user asks to compress / shrink / condense / "cavemanify" a Markdown
  file, or when a Markdown file under the auto-allowed paths has grown verbose and would
  benefit from terser prose. Eligible auto-allowed targets (no scope confirmation):
  any **/CLAUDE.md (basename anywhere), and any .md under the repo-root docs/ or plan/
  directories. Any other .md path requires explicit user confirmation before compressing.
argument-hint: "<path/to/file.md>"
allowed-tools: ["Read", "Write", "Edit", "AskUserQuestion", "Glob", "Bash(git:*)", "mcp__plugin_cave-context_cave-context__compress"]
---

# cave-compress

Compress ONE Markdown file *in place* by rewriting its prose under the caveman
ruleset below. Cut tokens, keep every fact. This is a **lossy, in-place
overwrite** — run the gates in order before writing.

Both you (the model) and the user can invoke this skill. Target = the file path in
the argument. **Path hints — where this applies:** the auto-allowed targets are any
`**/CLAUDE.md` (basename at any depth), and any `.md` under the repo-root `docs/` or
`plan/` directories; these compress without a scope prompt. When you invoke this
yourself, target one of those paths — any other `.md` triggers the scope-confirmation
gate (step 3). No path given → ask which `.md` file; never guess a "newest file."
The gates below still run regardless of who invoked the skill.

> **Ask the user via `AskUserQuestion`.** When this skill needs a decision from
> the user and the answers are a fixed / multiple-choice set, it MUST present the
> question through the `AskUserQuestion` tool — never as plain prose that waits for
> a typed reply. Remote sessions do not reliably surface a plain-text "waiting for
> input" prompt, whereas `AskUserQuestion` raises a notification. Open-ended,
> free-text prompts may be asked inline, but prefer `AskUserQuestion` whenever the
> choices can be enumerated.

## Decision flow — run in order; any non-affirmative answer → STOP

1. **Resolve & type-check.** Resolve the argument to a path.
   - Path does not end in `.md` → **REFUSE**: "cave-compress only compresses
     Markdown (`.md`) files." Stop.

2. **Recoverability gate — run BEFORE the scope gate.** A lossy overwrite needs a
   restore point. Find the repo root and classify the target with git:

   ```bash
   root="$(git rev-parse --show-toplevel 2>/dev/null)"   # empty = not in a git repo
   git ls-files --error-unmatch -- "$path" 2>/dev/null   # exit 0 = tracked
   git status --porcelain -- "$path"                      # empty output = clean
   git check-ignore -q -- "$path"; echo $?                # 0 = gitignored
   ```

   | State | Action |
   |---|---|
   | tracked + clean | proceed — the committed blob is the restore point |
   | tracked + dirty | warn "uncommitted changes — no clean restore point"; `AskUserQuestion`; non-affirmative → STOP |
   | untracked + gitignored | warn "file is gitignored — no git restore point exists (a plain commit won't track it)"; `AskUserQuestion`; non-affirmative → STOP. Do NOT say "commit first." |
   | untracked + committable | warn "not yet committed — recommend committing first so the original is recoverable"; `AskUserQuestion`; non-affirmative → STOP |
   | not in a git repo | warn "no git repo — no restore point"; `AskUserQuestion`; non-affirmative → STOP |

3. **Scope gate (allow-list).** Evaluate the path **relative to the git repo
   root** against the three auto-allowed globs:

   | Glob | Matches |
   |---|---|
   | `**/CLAUDE.md` | any file whose basename is `CLAUDE.md`, at any depth |
   | `docs/**/*.md` | any `.md` at any depth under the repo-root `docs/` dir (incl. directly in `docs/`) |
   | `plan/**/*.md` | any `.md` at any depth under the repo-root `plan/` dir (incl. directly in `plan/`) |

   - Matches a glob → proceed (no scope confirmation).
   - No match → `AskUserQuestion`: "`<path>` is outside the auto-allowed set
     (CLAUDE.md, docs/, plan/). Compress it anyway?" — non-affirmative → STOP.

   "Non-affirmative" = anything other than an explicit yes/proceed. `AskUserQuestion`
   has no silent default; fail closed.

4. **Compress via the `compress` tool.** `Read` the file, then call the
   `mcp__plugin_cave-context_cave-context__compress` MCP tool with
   `{ text: <full file content> }`. Inspect the returned
   `{ compressed, changed, valid, errors, reason }`:
   - `valid && changed` → `Write` `compressed` back to the same path.
   - `valid && !changed` → write nothing; report "already terse — no changes."
   - `!valid` → write nothing; report `reason` (and `errors` if present). The
     original file is left untouched.
   The tool owns the caveman ruleset and performs the rewrite in an isolated
   `claude` process — do not rewrite the prose yourself.

5. **Report.** Show line/byte count before → after, a one-line summary of what was
   dropped, and whether the file is git-restorable. If no meaningful reduction is
   possible, write nothing and report "already terse — no changes."

## Caveman ruleset

The compression itself is performed by the cave-context `compress` MCP tool,
which owns the authoritative caveman ruleset (GRAMMAR + PRESERVE-VERBATIM +
MARKDOWN-STRUCTURE; governing rule: "If cutting a word loses a fact, keep it.
Compression, not amputation."). Lineage:
`https://github.com/JuliusBrussee/cavekit/blob/main/skills/caveman/SKILL.md`.
This skill only gates the file (type/recoverability/scope) and applies the
tool's result.
