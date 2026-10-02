# CLAUDE.md — coding-toolbox skill: setup-rules

Behavior lives in `SKILL.md`, `parse-args.sh` and `parse-args.reference.md`; this file holds the standing rules, rationale and pitfalls.

## Skill design (`setup-rules`)

### Install target and files

- Keep `disable-model-invocation: true`: a side-effecting config wizard — not named `configure-*`, but it carries the flag anyway.
- Rules install at user level (`~/.claude/rules/coding-toolbox-*.md`), so they apply to every project on the machine.
- Install the golden-rules file as a byte-exact `cp` of `references/golden-rules.md`, never re-typed: avoids transcription drift.
- Neither managed file carries `paths:` frontmatter: a `.claude/rules/*.md` without `paths` loads unconditionally, same priority as `.claude/CLAUDE.md`.
- Mutate the managed files through `Bash` (`cp`, `rm`, a quoted `cat <<'EOF'` heredoc), not the `Write`/`Edit` tools.
- `stale_project_level` (a leftover project-level `.claude/rules/coding-toolbox-*.md` from before the user-level move) is informational only, surfaced once in Step 5.
  - Never read, write or remove it: migrating or deleting a prior install is an explicit non-goal, not an oversight.

### Detection

- One load-time fenced `!` block computes all six facts (one shell invocation, not six injections), with no bundled script.
  - The facts are static before the first question, so `script-authoring.md`'s "inject before query" applies.

### Questions (Step 3b)

- Ask two independent single-select questions (one per artifact), with the current value in the header (e.g. `Golden-rules rule [currently: installed]`) and the answer setting the new value directly. Never one `multiSelect`.
  - `AskUserQuestion` has no pre-selected-option field; a `multiSelect` would need action-framed rows, a permanent "no changes" escape and cross-row precedence rules to compensate.
  - A single-select forces one explicit answer with no unanswered state, so none of that is needed.
- Ask the tool-routing question only when it has something to say (already installed, or at least one tool detected).
- Answering "Yes" always (re)writes fresh content, so install and refresh are one action.

### Verbatim `$ARGUMENTS` mode (Step 3a)

- The mode exists for a human typing e.g. `/coding-toolbox:setup-rules update tools rule` — `disable-model-invocation` blocks the model, not the user.
  - It is **not** how `memory-enhancement:dream` refreshes the tools rule: that is the separate `refresh-tools-rule`, kept separate rather than loosening this skill's invocation control.
- Keep the grammar in `parse-args.sh`; never re-inline it into SKILL.md (a bats tripwire bounds Step 3a's length).
- Match verbs and targets as exact whole words, never substrings: a substring check made `uninstall` collide with `install` and the `routing` synonym never match `tool`.
- A destructive (`remove`-family) verb with no explicit target is a usage error (exit `5`), never "both": silently deleting every managed file from one ambiguous word is a footgun that a bare `install` defaulting to "both" is not.
- Pass `$ARGUMENTS` via a fresh `mktemp` file written with the `Write` tool, then `parse-args.sh <path>` — never as a bare shell argument or inside a heredoc.
  - `$ARGUMENTS` is a pre-injection text substitution, so the placeholder is already the user's literal, possibly adversarial text.
  - A fixed heredoc delimiter can be collided: a text line equal to it ends the heredoc early and every later line runs as ordinary shell input.
  - A file makes the text content, never syntax (same pattern as `finish-pr`'s `apply-pr-update.sh` title/body files). `dispatch-agent` still uses the heredoc idiom; see its `CLAUDE.md`.
- Keep exit `6` (missing/unreadable path: the script itself failed) distinct from `2`-`5` (the input was rejected): never report one as the other.
- Lowercase with `tr 'A-Z' 'a-z'`, not `${var,,}` or `tr '[:upper:]' '[:lower:]'`.
  - `${var,,}` needs Bash 4+ (macOS ships 3.2).
  - The POSIX classes are locale-sensitive: `I` folds to dotless `ı` under `LC_CTYPE=tr_TR`.
- Script stdout uses lowercase `yes`/`no`/`unset` (this plugin's key-value convention, e.g. `find-pr.sh`'s `draft: true`), deliberately not the `Yes`/`No` capitalization of the `AskUserQuestion` option labels — different vocabularies, never required to match case.
