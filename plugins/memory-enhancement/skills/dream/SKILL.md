---
name: dream
description: Consolidates this project's auto-memory files (~/.claude/projects/<project>/memory/) in four phases -- orient, gather signal from recent session transcripts, consolidate (merge duplicates, drop stale entries, resolve contradictions, author a new memory file for any signal with no existing memory home -- or, when the cwd is a graphmind-registered project, save it to graphmind memory instead), update the MEMORY.md index. Optionally compresses touched detail files caveman-style via cc-knowledge's cc-compress when that plugin is enabled (silent no-op otherwise). Surgical -- only touches files that need a change. Trigger on natural language such as "dream", "run a dream", "dream cycle", "consolidate my memory", "clean up my memory files", "did I forget to save something as memory", "check for missed learnings" -- no slash command needed.
allowed-tools: Read, Write, Edit, Bash, Skill, AskUserQuestion
---

# dream — memory consolidation cycle

Four required phases, run in order. Surgical: a
file that needs no change is left byte-for-byte alone — this is not a
rewrite-every-run pass.

## Phase 1 — Orient

Locate the memory directory from this session's own auto-memory
system-prompt block (the line stating "persistent, file-based memory system
at `<path>`") — never recompute it from `cwd`, and never read
`.claude/settings*.json` or `~/.claude/settings.json` to search for it (those
files can carry unrelated credentials/config that has no business in this
skill's context). If that block is absent this session (auto-memory
disabled, or an older Claude Code without the feature), report that
auto-memory's location cannot be determined this way and stop — nothing to
dream about.

Read `MEMORY.md` and list every topic file in the memory directory.

Then run `graphmind which` once via the Bash tool in the session's current
working directory (no `cd`). Exit 0 → **graphmind mode**: note the printed
slug for the report. Any other outcome (exit 1 = this directory is not
registered, command not found = graphmind not installed, any other error)
→ graphmind mode off: the cycle runs exactly as described below with no
graphmind step and no note about it. Do not re-run the probe later in this
cycle.

## Phase 2 — Gather signal

`<project-dir>` = the parent of the memory directory (same directory that
holds this project's own `<uuid>.jsonl` session transcripts). Using `rg`
(ripgrep), scan the **8 most recent** `<project-dir>/*.jsonl` files (sorted
by mtime, descending) — main-session transcripts only, never subagent
transcripts under `<uuid>/subagents/` — for targeted correction/preference/
decision markers. Never fully read a transcript file. Example keyword set
(bilingual, case-insensitive, extend as useful — this is a starting point
not an exhaustive list): `no,|don't|instead|actually|stop doing|nein|nicht|
eigentlich|stattdessen|merke dir|remember that|from now on`. Note any hits
that look like a real correction, preference change, decision, or recurring
pattern worth reflecting in memory.

## Phase 3 — Consolidate

For each memory file that needs a change based on phase 1's read and phase
2's signal — merge duplicate memories, drop stale or superseded entries,
resolve contradictions preferring the most recent evidence (an unresolvable
contradiction gets noted in the file itself rather than blocking or asking).
A phase 2 signal with no existing memory home — a correction, preference,
or decision with no file to fold into — is a _new finding_. In graphmind
mode it is saved per **New findings in graphmind mode** below instead of as
a file. Otherwise it is authored as a brand-new file via this session's own
auto-memory system prompt's two-step save process (pick the fitting type:
user/feedback/project/reference; write frontmatter
`name`/`description`/`metadata.type`; for feedback/project types structure
the body with **Why:** and **How to apply:** lines). Steps 1-3 apply to
files only:

1. If the file already exists, copy the pre-dream version to a sibling
   `<file>.bak` next to it (backup "daneben", not session-temp — this is
   dream's own backup, separate from `cc-compress`'s). A brand-new file has
   nothing to back up — skip this step for it.
2. Write the consolidated (or newly-authored) content.
3. If the file is anything **other than** `MEMORY.md`: check whether
   `cc-knowledge:cc-compress` is among this session's available
   skills (no hard dependency — `cc-knowledge` is an optional
   integration). **Not available → silent no-op**: keep the
   consolidated-but-uncompressed content as final, no note in the summary,
   no different from a cycle that never attempted compression. **Available →**
   copy the just-written consolidated content to a second sibling backup,
   `<file>.pre-compress.bak` (distinct from the pre-dream `.bak` — this is
   the actual rollback point for a failed compression; restoring from the
   pre-dream `.bak` instead would silently discard this cycle's
   consolidation work). Extract the file's reference set with `rg -o
   '\[\[[^]]+\]\]|\b[\w-]+\.md\b' <file> | sort -u` (wikilinks plus
   bare-`.md` filenames — `cc-compress`'s path-preservation check does not
   protect either, only slash-containing paths and full URLs). Invoke
   `cc-knowledge:cc-compress` (Skill tool) on it with `--confirmed`
   (memory files live outside any git repo, so `cc-compress`'s own
   git-recoverability gate would otherwise ask every time; this dream
   cycle's own backups already cover rollback). After compressing, run the
   same `rg -o ... | sort -u` command against the compressed result and
   `diff` the two sorted lists. Any difference (a missing or altered entry)
   → restore the file from `<file>.pre-compress.bak` (not the pre-dream
   `.bak`), and note _that_ skip in the session summary (this one is a real,
   file-specific finding — unlike `cc-compress` simply being unavailable).
   Either way (compression accepted or rolled back), delete
   `<file>.pre-compress.bak` once its job is done — only the pre-dream
   `.bak` persists as the lasting rollback record.

**New findings in graphmind mode.** For each new finding:

1. Dedup: `graphmind memory search "<3-6 distinctive keywords>" --limit 5 --max-chars 200`.
   If a result already captures the finding (even paraphrased), skip it
   and count it as a duplicate. If the search itself fails, treat it as no
   duplicate and continue to step 2.
2. Save with the type from the table, the content passed through a quoted
   heredoc so no shell expansion touches it (never put a line consisting
   solely of `EOF` inside the content):

   ```bash
   graphmind memory add --type <type> "$(cat <<'EOF'
   <one self-contained statement; for feedback- or project-like findings add a "Why:" and a "How to apply:" sentence>
   EOF
   )"
   ```

   | Finding (auto-memory type it would have had)      | graphmind flags           |
   | ------------------------------------------------- | ------------------------- |
   | feedback (correction, preference, way of working) | `--type convention`       |
   | project (decision, project state)                 | `--type decision`         |
   | reference describing a defect or failure mode     | `--type bug`              |
   | reference, any other                              | `--type pattern`          |
   | user (facts about the user, cross-project)        | `--type context --global` |

   Never pass `--priority` or `--slug`.
3. Non-zero exit from `memory add` → save that finding as a new file via
   the two-step save instead (the normal path above, steps 1-3) and note
   the fallback, with the error line, in the report.

graphmind entries get no `.bak`, no cc-compress and no `MEMORY.md` line.

Files that need no change: leave alone entirely — do not open, backup, or
touch them.

## Phase 4 — Update the MEMORY.md index

Re-derive `MEMORY.md` from the current set of memory files (after phase 3's
changes), one line per entry: `- [Title](file.md) — one-line hook`. Keep it
under **200 lines / 25KB** (the documented load cutoff — content beyond this
never loads at session start). Write it directly — **do not** run it through
`cc-compress`: its bullets are bare-filename markdown links with no leading
path separator, which is exactly the gap phase 3 step 3 works around for
other files, and there is no backup-and-diff step protecting the index
itself, so it must never risk a reworded filename.

## Report

One short summary: files merged/dropped/changed/created, files left
untouched, files compressed vs. rolled back after a failed compression (with
why — cc-compress simply being unavailable is not itself called out, per
phase 3), the final `MEMORY.md` line count; in graphmind mode, also: the
slug, findings added to graphmind, findings skipped as graphmind
duplicates, and any findings that fell back to files (with the error).
Nothing about graphmind when the mode is off.
