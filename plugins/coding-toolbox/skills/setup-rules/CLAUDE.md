# CLAUDE.md — coding-toolbox skill: setup-rules

## Skill design (`setup-rules`)

User-only (`disable-model-invocation: true` — a side-effecting
project-config wizard, not named `configure-*` but carrying the flag
anyway) wizard that installs/refreshes/removes two always-on
`~/.claude/rules/coding-toolbox-*.md` files (moved from project-scoped
`.claude/rules/` 2026-07-10 — user-level rules apply to every project on
this machine, confirmed against the memory-reference cc-reference doc):
a byte-exact `cp` of the
skill's own `references/golden-rules.md` (never re-typed, avoiding
transcription drift) and a generated tool-routing table naming
whichever of `rtk`/`bun`/`rg`/`codebase-memory-mcp` are on `PATH`.
Detection (both installed-file glob and tool `PATH` presence) runs via
one load-time fenced ` ```! ` dynamic-context block (one shell
invocation for all six facts, not six separate `!` injections), not a
bundled script — per `script-authoring.md`'s "inject before query" the
facts are static before the first question, so they're computed once
at load time. Asks one `AskUserQuestion` call per run, but as **two
independent single-select questions** (one per artifact) rather than
a single `multiSelect` question — this skill's own per-toggle
idiom (current value in the header, e.g. `"Golden-rules
rule [currently: installed]"`, the answer sets the new value
directly). This was a deliberate revision during Review: the original
draft used one `multiSelect` question with action-framed rows
(Install/Remove/Refresh) plus a permanent "no changes" escape option
and cross-row precedence rules, invented specifically because
`AskUserQuestion` has no pre-selected-option field — two independent
review passes (reuse, altitude) flagged that as reinventing machinery
the sibling skill's per-toggle single-select pattern already provides
for free, since a single-select forces one explicit answer with no
ambiguous/unanswered state, so no escape option or precedence rule is
needed at all. The tool-routing question is asked only when it has
something to say (already installed, or at least one tool detected);
answering "Yes" always (re)writes fresh content, covering both install
and refresh with one action. File mutations go through `Bash` (`cp`,
`rm`, a quoted `cat <<'EOF'` heredoc) rather than the `Write`/`Edit`
tools. Neither managed file carries a `paths:` frontmatter key —
confirmed against the memory-reference cc-reference doc that a
`.claude/rules/*.md` file without `paths` loads unconditionally, same
priority as `.claude/CLAUDE.md`. A verbatim `$ARGUMENTS` mode (Step 3a)
parses a whole-word-equality verb+target grammar (`install`/`update`/`refresh`
vs `remove`/`uninstall`/etc.; `tools` vs `rules`/`golden`, else both) to
resolve the same two yes/no answers Step 3b's `AskUserQuestion` produces,
without asking — exact-word matching, not a raw substring check, deliberately:
a code-review pass on this branch caught that substring matching made
`uninstall` self-collide with the `install` keyword it contains, and made the
documented `routing` synonym never actually match `tool`; both are fixed by
matching whole words against each list instead. A destructive (`remove`-family)
verb with no explicit target word is also a hard usage-error rather than
defaulting to "both", per the same review pass — silently deleting every
managed file from one ambiguous word would be a real footgun a bare `install`
defaulting to "both" is not. This mode exists for a human typing e.g.
`/coding-toolbox:setup-rules update tools rule` directly (`disable-model-invocation`
blocks the _model_, not the user) — it was **not**, in the end, the mechanism
that lets `memory-enhancement:dream` refresh the tools rule; see
`refresh-tools-rule` below for why that stayed a separate skill instead of
loosening this one's invocation control. Step 1 detection also flags a
leftover project-level `.claude/rules/coding-toolbox-*.md` from before the
user-level move (`stale_project_level`) — informational only, surfaced once in
Step 5's report; this skill never reads, writes, or removes it, since
migrating or deleting a prior install was an explicit non-goal, not an
oversight (this very repo's own `.claude/rules/` carried exactly this leftover
from before the move — removed manually in this same PR once the user-level
copy took over, not by any automated migration this skill performs).

**2026-08-01: Step 3a's verb+target parser extracted to `parse-args.sh` +
colocated `parse-args.reference.md`** — a repo-wide audit of every
coding-toolbox skill against `script-authoring.md`'s trivial/substantial line
(prompted by the same pass that had already extracted `finish-pr`'s scripts)
confirmed this prose was genuinely substantial (two independent multi-list
whole-word lookups, an ambiguity check per axis, a verb-conditioned default,
a usage-error branch) and, unlike most of the plugin's other skills audited
the same pass, not yet extracted. The prose itself moves out entirely — no
duplicate copy stays behind — replaced by "Read `parse-args.reference.md`"
then a single invocation step. `parse-args.sh` prints `golden_rules:`/`tools:`
as lowercase `yes`/`no`/`unset` (matching this plugin's existing key-value
stdout convention, e.g. `find-pr.sh`'s `draft: true`) rather than the
`Yes`/`No` capitalization the old prose used for the `AskUserQuestion` option
labels — those two are a different vocabulary (machine-readable script
output vs. human-facing option text) and were never required to match case.
Bats coverage (`test/coding-toolbox/setup-rules.bats`) invokes the real
script across every case named in this section's own prose (ambiguous verb,
ambiguous target, destructive-with-no-target, substring-collision
regression, case-insensitivity) — replacing, not supplementing, the old
presence-only greps for the prose phrases that moved out, plus a line-count
bound on Step 3a's own section (tripwire against a future re-inlining using
different wording than the exact old phrases).

**Argument-passing design wrinkle, and a same-day correction.** `$ARGUMENTS`
is a pre-injection text substitution (same mechanism as `${CLAUDE_SKILL_DIR}`,
per `skill-md-authoring.md`), so by the time the invoking step is read, the
placeholder has already been replaced with the user's literal, possibly
adversarial text — passing it as a bare `"$ARGUMENTS"` shell argument would
embed that text unescaped into a live Bash tool call. The first draft solved
this by reusing `dispatch-agent`'s heredoc-embedding idiom
(`$(cat <<'SETUP_RULES_ARGS_EOF' … EOF)`); a same-day max-effort code-review
pass over this branch's diff (5 correctness angles, independently verified)
confirmed a real gap in that idiom neither this file nor `dispatch-agent`'s
own design notes had previously named: a **fixed, predictable heredoc
delimiter can itself be collided** — an argument-text line that exactly
equals the delimiter terminates the heredoc early, and every subsequent line
of the (adversarial) text is then parsed as ordinary shell input in the same
Bash-tool invocation, not inert data. Fixed by dropping the heredoc
entirely: Step 3a now writes `$ARGUMENTS`'s literal text to a fresh `mktemp`
file via the `Write` tool, then invokes `parse-args.sh <path>` — the script's
own contract changed from "verbatim text as `$1`" to "a file path as `$1`,
read the text from it" (new exit `6` for a missing/unreadable path, distinct
from `2`-`5`'s parse rejections, since a script-invocation failure and a
usage error are different classes of stop and must not be reported as if
each were the other). No shell ever parses the argument text as syntax this
way, only as file content — the same pattern this plugin's `finish-pr`
already uses for other free-form text (`apply-pr-update.sh`'s title/body
files) — closing the class of bug entirely rather than picking a
harder-to-guess delimiter. `dispatch-agent`'s own instance of the same
fixed-delimiter idiom was **not** touched by this fix (out of scope for this
branch); it remains a known, unaddressed sibling exposure. The same review
pass also caught that the "simplify"-stage swap of `tr '[:upper:]'
'[:lower:]'` for bash's `${raw,,}` (see below) introduced two real
regressions — a Turkish/Azerbaijani-locale case-folding bug (`I` → dotless
`ı`, not `i`, under `LC_CTYPE=tr_TR`) and a hard Bash-≥4 dependency (breaks
under macOS's stock `/bin/bash` 3.2) — neither reproducible in this sandbox
(only C-family locales installed, a single modern bash available) but both
structurally real and traced to the same line; fixed together by reverting
to `tr` with explicit `A-Z`/`a-z` byte ranges (portable to any POSIX shell,
locale-independent — unlike the `[:upper:]`/`[:lower:]` POSIX classes the
very first draft used, which are themselves locale-sensitive) rather than
`[:upper:]`/`[:lower:]` or `${var,,}`.
