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
allowed-tools: ["Read", "Write", "Edit", "AskUserQuestion", "Glob", "Bash(git:*)"]
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

4. **Compress.** Read the file, rewrite its prose under the ruleset below, `Write`
   it back to the same path. Apply PRESERVE-VERBATIM and MARKDOWN-STRUCTURE rules
   strictly.

5. **Report.** Show line/byte count before → after, a one-line summary of what was
   dropped, and whether the file is git-restorable. If no meaningful reduction is
   possible, write nothing and report "already terse — no changes."

## Caveman ruleset

Source: `https://github.com/JuliusBrussee/cavekit/blob/main/skills/caveman/SKILL.md`.
Governing rule: "If cutting a word loses a fact, keep it. Compression, not amputation."

### GRAMMAR
- Drop articles (a/an/the).
- Drop filler (just, really, basically, simply, actually).
- Drop aux verbs where a fragment works (is/are/was/were/being).
- Drop pleasantries. No hedging (might, perhaps, could be worth).
- Fragments fine.
- Short synonyms: fix > implement, big > extensive, run > execute.

### SYMBOLS (use only where they increase clarity — do not symbol-spam prose)
```
→  leads to / becomes       ∴  therefore         ∀  for all / every
∃  exists / some            !  must / required    ?  may / optional / unknown
⊥  never / forbidden / nil  ≠  not equal          ∈  in          ∉  not in
≤  at most                  ≥  at least           &  and          |  or
§  section reference
```

### PRESERVE VERBATIM (hard rule — never compress)
- Fenced & inline code blocks / snippets.
- Paths (`src/auth/mw.go`), URLs, identifiers (function/variable/env names).
- Numbers, versions, error-message strings.
- SQL, regex, JSON, YAML — and the file's own **YAML frontmatter** (byte-for-byte).
- Quoted strings.

### MARKDOWN STRUCTURE (preserve)
Keep heading levels, list nesting, tables, and link targets intact. Compress the
*text within* the structure — never the structure itself.

### SHAPES (conditional — apply ONLY if the file already uses them)
The trigger is the file's own existing conventions, NOT its directory. If the file
already uses these shapes, keep/extend them; otherwise leave prose as prose.
```
Invariant:  V<n>: <subject> <relation> <condition>
Bug row:    id|date|cause|fix          (status markers: x done, ~ wip, . todo)
Task row:   id|status|task|cites       (escape a literal | as \|)
Interface:  <kind>: <name> → <shape>   e.g.  api: POST /x → 200 {id}
```
Do NOT impose shapes on prose `CLAUDE.md` / general docs that don't already use
them — that changes meaning, not just density.

### BOUNDARIES (write normal English; do not compress)
- A section the file explicitly marks as prose for external readers.
- Commit-message or diff-comment text quoted inside the doc.

### WHEN UNSURE
If cutting a word loses a fact, keep it. Caveman is compression, not amputation.
