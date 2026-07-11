# CLAUDE.md — coding-toolbox

Plugin that mechanically enforces "golden behavior rules" via two hooks: a `PreToolUse`
command hook (`encoding-guard.mjs`) and a `Stop` `mcp_tool` hook (`interaction_gate`),
the latter backed by a self-contained, now-stateless MCP server (`mcp/server.mjs`). The
full golden-rules document lives, unwired, at `skills/setup-rules/references/golden-rules.md`
(moved from `hooks/SessionStart.md` when the `SessionStart` hook was removed);
`setup-rules` is the only way to get it onto a machine (user-level, every
project you open there), opt-in. No userConfig.

## Hook design (do not "fix" without reading this)

**Stop → `mcp_tool` hook (no matcher — `Stop` ignores it): `tool: "interaction_gate"`**
(2026-07-01 addition, closing a gap where a turn ended with a plain-text question
instead of going through `AskUserQuestion`). Uses the documented `last_assistant_message` Stop-hook
input field — Claude's final response text, given directly, no transcript parsing
needed. Heuristic: strip fenced code blocks, take the last non-empty line; if it ends
in `?`, return `{"decision":"block","reason":"…"}` (from `HookResult`, already typed)
telling Claude to redo it via `AskUserQuestion`; otherwise `{}` (allow the stop). This
is deliberately a blunt heuristic — it will occasionally flag a rhetorical trailing
"?" as a false positive — traded for simplicity and for matching axis 1's own "no
exceptions" wording. No extra loop-guard needed: the platform's `stop_hook_active`
input and 8-consecutive-block cap already bound the worst case. Stateless — do not
add a counter here.

The `PreToolUse` entry (`hooks/encoding-guard.mjs`, matcher
`Read|Edit|Write|Bash`) is a hard deny gate and therefore a **command hook**,
not an `mcp_tool` — the event matrix forbids `mcp_tool` for hard gates (a
down server silently fails open). Zero-dep executable Node script invoked
directly (shebang + git mode `100755`). Detection is pure Node over a 64 KiB
head sample: BOM sniff → strict UTF-8 validation (ASCII never mislabeled) →
NUL-parity UTF-16 heuristic → legacy single-byte fallback; binary, empty and
missing files are safe. Bash commands get a precision-biased literal-token
analysis (heredoc-body strip, quote/substitution blanking, per-segment
content-tool deny-set plus output-redirect targets) with a
false-negatives-OK/false-positives-never contract, self-contained (no
cc-tools dependency; `cc-tools` invocations pass). Deny
is PreToolUse JSON (`permissionDecision: "deny"`) naming the encoding + an
iconv hint; every internal error exits 0 silently (fail open).

## Skill design (`fresh-branch`)

Single inline synchronous bash script (no MCP server, no subagent — same idiom
as `branch-management:new-branch`), self-detecting worktree state via `git
rev-parse --git-dir` vs `--git-common-dir`. Deliberately independent of
`branch-management` — supports a custom base/upstream and a branch+base pair,
which `new-branch` does not. Auto-stashes (`git stash push -u`) and pops
unconditionally around both paths, including the refresh-only path (now
universal for zero-argument invocations, not just inside a worktree —
2026-07-02, extended same day per user request) that creates no new branch —
never silently drops a stash on a pop conflict (exit `8`, reported). The
non-worktree branch-name collision check runs *before* any stash or checkout so
that path never has to unwind a stash from the wrong branch. See `skills/fresh-branch/SKILL.md`'s parameter table for the full worktree × arg-count truth table.

## Skill design (`fresh-pr`)

Self-contained PR-lifecycle skill: inline synchronous git/gh/glab
orchestration (`skills/fresh-pr/SKILL.md`, same idiom as `fresh-branch`) for
commit→rebase→push→PR-open-or-refresh, then a Task*-ledger-tracked goal loop
dispatching two plugin-local agents — `agents/ci-watcher.md` (read-only,
polls `bin/ci-watch.sh`, collects open CodeRabbit threads plus any attached
"Prompt for AI Agents" text) and `agents/pr-fixer.md` (applies justified
fixes, commits, never pushes, always annotates skipped findings in code) —
until CI is green and, only if CodeRabbit ever comments, its threads are
resolved. Deliberately independent of `branch-management`: `bin/ci-watch.sh`
is a near-verbatim port of `branch-management/bin/ci-watch.sh` (same exit
contract), and the two agents port `branch-management`'s
`ci-monitor`/`review-fixer` logic — no cross-plugin dependency, no
code-review-rounds step (not requested). Existing-PR handling (create if
none / update title+body via `gh api PATCH` — never `gh pr edit`, known to
silently fail on this repo's Projects-classic board — or `glab mr update` if
open / reopen-then-update if closed / report-and-stop if merged) has no
`branch-management:new-pr` equivalent. Both agents' optional context-mode acceleration was removed
2026-07-05 (repo-wide context-mode phase-out, starting here); `rtk` was
evaluated as a replacement and found to give no measurable benefit for any
command either agent actually runs (`gh run view --log-failed`, `gh run
list`, `gh pr checks` all came back byte-identical or only cosmetically
reformatted when diffed raw-vs-`rtk`; `glab`'s `ci trace`/`api` paths are
unverified — no `glab` in the dev environment) — so neither agent carries
an acceleration block today. `ci-watcher`'s `bin/ci-watch.sh` invocation is
now prefixed with `TMPDIR="<scratchpad path>"` (resolved once by
`fresh-pr`, `mktemp -d` fallback when no scratchpad is available) so the
script's own internal `mktemp` call lands in the session's scratch space
rather than shared system `/tmp` — its `TMPDIR` behavior is unchanged,
`mktemp` already prefers `$TMPDIR` when set (the script separately gained
an explicit `mktemp`-failure guard, exit `64`, documented in
`agents/ci-watcher.md`).

## Skill design (`fresh-work`)

Self-contained end-to-end pipeline orchestrator (`skills/fresh-work/SKILL.md` +
five phase guides under `references/`, Read only when their phase starts):
classify → branch (`fresh-branch`) → design → **intent confirmation** → plan →
implement → **review** (combined review workflow) → PR (`fresh-pr`); the fix
path swaps design/plan/implement for `references/debugging.md` and skips
Review — debugging.md's own verify step
(new test passes, suite green, symptom gone) already covers a single targeted
fix, where Review's whole-diff pass is scoped to the design path's larger,
multi-task diffs. Adapted from superpowers' brainstorming /
writing-plans / subagent-driven-development / systematic-debugging and
superpowers-automation's new-work — with the full line-by-line human
spec-review gate, execution-choice handoffs, and cross-plugin references
removed (the bats self-containment tripwire greps the skill dir for
`superpowers|branch-management`; lineage is recorded only here). Two narrower
steps were reintroduced later (2026-07-03), distinct from what was removed:
**Intent confirmation** (SKILL.md step 5) shows the design doc's mandatory
Keypoints section and asks `AskUserQuestion` whether to proceed — the
pipeline's one deliberate human-facing checkpoint (hardened 2026-07-07: the
Keypoints output is now a mandatory numbered pre-step — read fresh from the
spec temp path, emitted as its own plain-text message before the
`AskUserQuestion` call — made explicitly distinct from the generic Task-list
step-start announcement, after a regression where the confirmation question
was asked without the design summary ever being shown); **Review** (step 8,
`references/reviewing.md`) runs ONE combined read-only review workflow over
the full branch diff after Implement — 2026-07-11, replacing the former
`simplify`-then-`code-review --fix` built-in-skill pair after observing both
live: `code-review`'s cleanup finder carries all four `simplify` lenses
verbatim, so the pair did the cleanup work twice, the first time entirely
unverified (an earlier analysis had rejected exactly this consolidation over
altitude coverage + redundancy; the explicit user decision to merge
compensates both, as noted below). Structure: correctness angles (3 at
`high` effort for a Simple diff, 5 plus a gap-hunt sweep at `max` for
Complex, per SKILL.md's complexity heuristic) plus one finder PER cleanup
lens (reuse/simplification/efficiency/altitude/CLAUDE.md-conventions —
per-lens granularity deliberately kept from `simplify`, unlike the built-in's
single merged cleanup finder), every candidate location-group verified
(CONFIRMED/PLAUSIBLE/REFUTED — cleanup findings are now verified before
apply, which `simplify` never did), a synthesizer that flags
`reversesDecision` findings against the plan/spec temp docs; all workflow
agents are pinned `model: 'sonnet'`. The orchestrator then escalates flagged
findings via `AskUserQuestion`, applies the rest inline (keeping `simplify`'s
skip rule), and commits correctness and cleanup fixes as two separate
commits — a deliberate override of the repo's usual "one fix per commit,
never bundled" convention, at category granularity, never left pending
for `fresh-pr` to pick up. Prompt texts
(correctness angles A–E, cleanup lenses, verdict ladder) are vendored
verbatim from the built-in `/code-review` workflow and `/simplify` skill —
lineage recorded only here, same precedent as the `ci-watch.sh` port; the
Agent-engine fallback batches finders then verifiers under the
subagent-reconciliation gate. Deliberately given up: the second independent
cleanup pass over already-fixed code; downstream CI + PR review stay the
backstop for an over-eager auto-fix. Design doc + plan are session temp files (scratchpad dir, `mktemp`
fallback), never committed. Design and Plan (2026-07-03) each self-review
**always**; consulting the advisor is their own on-demand judgment call (a
genuine uncertainty, or the task turning out more complex than expected) —
no longer a fixed pipeline step, no clean-room fork.
`AskUserQuestion` is deliberately
absent from `SKILL.md`'s `allowed-tools` (it only pre-approves;
`.claude/rules/skill-md-authoring.md` — it does NOT restrict the tool) — its
remaining call sites (missing work description, branch-name collision, a design
open-point clarification, the intent gate, the Review step's design-reversal
escalation, the advisor protocol's own decision-conflict escalation whenever
Design or Plan consults it, and the fix path's 3-or-more-attempts escalation)
are meant to stay deliberate, not blanket-approved; do not "fix" this by
re-adding it, and re-check this list if a new call site is added.
Implementation is "workflow-driven development": a deterministic per-task
implement→review→fix loop, grouped into dependency waves computed from each
task's declared `Files`/`Interfaces` (`references/implementing.md`'s
Parallelism analysis, 2026-07-05) — a wave of size 1 (the common case) is
byte-for-byte the original sequential flow; a wave with 2+ independent
tasks dispatches concurrently (Workflow-tool `parallel()`, or a batched
multi-block Agent-tool message in the fallback engine), each implementer
isolated in its own git worktree (same-tree concurrent self-commits would
silently corrupt commit boundaries through the shared git index — disjoint
files alone do not make that safe) and self-reporting its branch/worktree
path via structured output, followed by a `git merge --no-ff` merge-back of
every approved task before the next wave starts; a merge conflict is a hard
stop, never auto-resolved, since it can only mean the wave analysis missed
a real dependency. `SKILL.md`'s Task-list integration section separately
requires a one-line step-start announcement before each top-level step (and
each Implement wave) begins, so a long-running pipeline is never silent.
The Workflow-engine script inlines `planPath`/`constraints`/`tasks` as JS
literals rather than passing them via the Workflow tool's `args` parameter
(`references/implementing.md`, 2026-07-03) — `args` was observed twice to
arrive `undefined` inside the script even when supplied correctly, on both a
fresh call and a `resumeFromRunId` retry. `waves` is not part of that
inlining — it's derived inside the script by a plain `computeWaves(tasks)`
function (2026-07-05 simplify pass), so the wave-leveling arithmetic is never
hand-computed by the model and pasted in as a literal.

## Skill design (`bump-version`)

Same inline-script idiom as `fresh-branch`/`fresh-pr`/`fresh-work`: a single
embedded bash script run via the Bash tool, no bundled `.sh`, no MCP server,
no subagent, model maps its exit code — with one deliberate invocation
difference: it is run via a quoted-heredoc-to-temp-file
(`cat > "$BUMP" <<'BUMPVERSION_EOF' ... BUMPVERSION_EOF; bash "$BUMP" <arg>`),
never `bash -c '<script>' _ <arg>`. The script's `awk`/`trap`/`sed` lines
contain single-quoted regions (and a comment with a literal apostrophe)
that break an outer `bash -c '...'` wrapper — confirmed during planning by
literally attempting it (fails with a syntax error before the first real
line). A quoted heredoc delimiter preserves every character verbatim, no
per-region quote conversion needed, so this isn't a style choice —
`fresh-branch`'s simpler script gets away with `bash -c '...'` only because
its inner single-quoted regions happen to be trivially convertible;
bump-version's aren't, so it uses the safer form. Detects exactly one
version file per
invocation, cwd only, by fixed precedence (`package.json` →
`composer.json` → `pom.xml` → `VERSION`) — mirrors a `version.sh`-style
helper's file-check order (its env-var-based checks and its
documented-but-never-implemented `gradle.properties` check are both
deliberately not mirrored — the latter is a docstring/code mismatch in the
reference script; this skill follows the working code, not the
aspirational comment). Bumps the named segment and zeros every segment to
its right; only bare `MAJOR.MINOR.PATCH` is supported (leading zeros like
`09` are rejected too — invalid per the semver spec, and would otherwise hit
bash's octal-literal arithmetic and silently corrupt the version), a
prerelease/build suffix is a hard error. Version extraction never depends on
`jq`/`xidel` — a targeted regex captures the value, and both detection and
write-back address the **specific line number** the match was found on
(never a whole-file first-match search) so a same-shaped `"version"` field
nested inside e.g. `overrides`/`resolutions` is never confused with the
project's own; for JSON files the top-level field is picked as whichever
`"version"` match has the shallowest line indentation (a nested field is
always indented more in a normally-formatted file), with a single match
always winning outright — a CodeRabbit review on this branch's PR (#121)
confirmed a file with NO indentation at all (still multi-line, just
unindented) ties every match at indentation 0, and the original
first-tie-wins logic silently picked whichever came first in the file,
which could be the wrong (nested) one; fixed by treating 2+ matches tied at
the shallowest indentation as ambiguous and failing loudly via
`require_bare_semver`/the no-match check instead of guessing. Best-effort
still: a file where indentation doesn't reflect nesting is exactly the case
this can't disambiguate — the fix is "don't guess," not "handle it." `pom.xml`
support is explicit best-effort:
it skips past a leading `<parent>…</parent>` block before searching for the
first `<version>` tag, so a parent POM's version is never mistaken for the
project's own — still a regex heuristic, not real XML parsing, confirmed
with the user during design as an accepted trade-off over adding an
XML-parser dependency. Lock-file sync is intentionally asymmetric and
documented as such in the skill body: `npm i --package-lock-only` genuinely
rewrites the bumped version into `package-lock.json`, but `composer update
--lock` does **not** propagate anything — `composer.lock` carries no
root-project version field, that command only refreshes the lock's
content-hash to silence composer's drift warning — kept anyway (user
confirmed at the design intent-confirmation gate) but never presented as
equivalent to the npm case. No git operations — this skill only edits
files in the working tree, unlike `fresh-branch`/`fresh-pr`/`fresh-work`;
composability with those is preserved by keeping this skill's blast radius
to file edits only. Both temp files this skill creates (`$BUMP`, and the
lock-sync log inside it) are routed into the session scratchpad the same
TMPDIR-propagation way as `fresh-pr`'s `ci-watcher` dispatch above — an
`export TMPDIR=` line the caller substitutes before running the script,
needing no change to the script itself.

## Skill design (`setup-rules`)

User-only (`disable-model-invocation: true`, same precedent as
`branch-management:clean-branches` — a side-effecting project-config
wizard, not named `configure-*` but carrying the flag anyway) wizard
that installs/refreshes/removes two always-on
`~/.claude/rules/coding-toolbox-*.md` files (moved from project-scoped
`.claude/rules/` 2026-07-10 — user-level rules apply to every project on
this machine, confirmed against the memory-reference cc-reference doc):
a byte-exact `cp` of the
skill's own `references/golden-rules.md` (never re-typed, avoiding
transcription drift) and a generated tool-routing table naming
whichever of `rtk`/`bun`/`rg`/`codebase-memory-mcp` are on `PATH`.
Detection (both installed-file glob and tool `PATH` presence) runs via
one load-time fenced `` ```! `` dynamic-context block (one shell
invocation for all six facts, not six separate `!` injections), not a
bundled script — per `script-authoring.md`'s "inject before query" the
facts are static before the first question, so they're computed once
at load time. Asks one `AskUserQuestion` call per run, but as **two
independent single-select questions** (one per artifact) rather than
a single `multiSelect` question — reusing
`branch-management:configure-branch-management`'s established
per-toggle idiom (current value in the header, e.g. `"Golden-rules
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
tools, mirroring `configure-branch-management`'s `jq`/`mv`/`printf`-only
file writes. Neither managed file carries a `paths:` frontmatter key —
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
blocks the *model*, not the user) — it was **not**, in the end, the mechanism
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

## Skill design (`refresh-tools-rule`)

2026-07-10: split out of the `setup-rules` design during `fresh-work`'s
Review step. The original plan for `dream`'s tools-rule sync (see
`memory-enhancement/CLAUDE.md`) was to drop `disable-model-invocation` from
`setup-rules` itself so `dream` could call it directly with the verbatim mode
above (`args: "update tools rule"`) — a genuine "single source of truth"
option the user picked at the `fresh-work` intent-confirmation gate. An
altitude review during the same pipeline's Review step flagged the real cost:
that would open *every* verb this skill supports — including destructive
`remove`/install on a machine-wide dotfile — to autonomous invocation by any
model turn in any session, to serve one narrow, non-destructive internal
caller. Re-surfaced to the user, who chose to split instead: `setup-rules`
keeps `disable-model-invocation: true` (its install/remove verbs stay
human-only), and this new skill carries no such flag — safe to be
model-invocable specifically *because* its entire behavior is provably
non-destructive: it hard-gates on `~/.claude/rules/coding-toolbox-tools.md`
**already existing** (Step 1 detection), and from there only ever rewrites
that one file's content from current `PATH` detection — it never creates the
file (so it can't be used to silently opt a machine into anything) and never
removes it. Its four `command -v` detection lines stay inline (trivial,
one-liners, not worth extracting), but the four candidate table rows are
**not** duplicated inline — both this skill and `setup-rules`' own Step 4
`Read` the same bundled `skills/setup-rules/references/tool-routing-rows.md`
file for them, a single source of truth for the rows specifically rather
than two hand-maintained copies (a code-review pass on this branch replaced
an earlier draft that did duplicate the rows behind a bats sync-guard test —
extracting them removes the drift risk entirely instead of just detecting it
after the fact, since both skills live in the same plugin and sharing a
bundled reference file costs nothing here, unlike the genuinely cross-plugin
`ci-watch.sh` port). The surrounding heredoc scaffolding (`# Tool routing`
header, the `Detected on this machine…` line, the table's own `| Task |
Prefer | Why |` header/divider) is still written out in both skills — small,
stable, and not worth extracting; only the row content that actually changes
when a tool is added or reworded lives in the one shared file.
`memory-enhancement:dream`'s optional Phase 5 is this skill's only caller so
far, invoking it with no arguments (there is nothing to choose — the one
action is always "refresh if installed, else no-op").

## Tests

`test/coding-toolbox/test.bats` — manifest/registration invariants, content coverage
for the relocated `golden-rules.md`, hook wiring (PreToolUse `command`, Stop
`mcp_tool`), an end-to-end JSON-RPC driver against `mcp/server.mjs` proving the Stop
gate blocks on a bare trailing `?`
and allows through otherwise. Coverage now also includes: a ported `ci-watch.sh`
bats suite (hermetic, stubbed `gh`/`glab`), structural assertions for
`fresh-pr/SKILL.md` and the `ci-watcher`/`pr-fixer` agent frontmatter, and the
version-bump manifest assertion. Structural assertions for
`fresh-work` (frontmatter minus `AskUserQuestion` plus a tripwire pinning that
absence, five phase references, the Intent-confirmation step and its Keypoints
dependency, the Review step's combined-workflow structure (per-lens cleanup
finders, sonnet model pin, `reversesDecision` escalation, category commits) and
high/max effort choice, self-containment tripwire, temp-doc convention) are
included. `refresh-tools-rule` gets structural assertions (exists,
model-invocable frontmatter — i.e. no `disable-model-invocation` key — no
`rm`/install-path command anywhere in the file, the existence-gate present,
its four `command -v` detection lines present) plus an assertion that both it
and `setup-rules` reference the shared `tool-routing-rows.md` file rather than
inlining the candidate-rows table themselves.
Run: `BATS_LIB_PATH=/usr/lib/bats bats test/coding-toolbox/`
