# CLAUDE.md — coding-toolbox

Plugin that mechanically enforces "golden behavior rules" via three hooks: a `PreToolUse`
command hook (`encoding-guard.mjs`),
a `Stop` `mcp_tool` hook (`interaction_gate`) and a
`PostToolUse` `mcp_tool` hook (`worktree_refresh`), both `mcp_tool` hooks backed by
a self-contained, now-stateless MCP server (`mcp/server.mjs`). The
full golden-rules document lives, unwired, at `skills/setup-rules/references/golden-rules.md`
(moved from `hooks/SessionStart.md` when the `SessionStart` hook was removed);
`setup-rules` is the only way to get it onto a machine (user-level, every
project you open there), opt-in. The plugin's `userConfig` entry is
`worktree_refresh` (fail-open, default `true`) gating the `worktree_refresh`
hook — the Stop gate and encoding guard have no toggle of their own. (The
`npm-ci-on-worktree` hook that used to live here moved to the `npm-automations`
plugin.)

## Fixed 2026-08-22: `$CLAUDE_PLUGIN_ROOT` load-time shell injection, ported fix from taskflow

`fresh-work`, `feature-development`, `finish-pr`, `setup-rules`,
`refresh-tools-rule`, and `setup-explore` each used to capture the plugin
root via a load-time shell injection (`` !`echo "$CLAUDE_PLUGIN_ROOT"` `` as
its own line, or `echo "Plugin root: $CLAUDE_PLUGIN_ROOT"` / `"$CLAUDE_PLUGIN_ROOT"`
inside a larger ` ```! ` block / `printf`) rather than the bare
`${CLAUDE_PLUGIN_ROOT}` pre-injection text substitution. A sibling plugin,
`taskflow`, hit a confirmed, deterministic production failure from the exact
same pattern in its `dispatch-task` → `build-task` pipeline: when the
invoking skill runs inside a worktree-isolated session — which is every
session `dispatch-agent` (this plugin) or `dispatch-task` (taskflow)
launches via `claude --worktree ... --bg` — that shell injection is refused
outright as the tool_result of the `Skill` invocation itself, before the
skill's own first step ever runs, and reproduces identically on every retry
since the skill body doesn't change. `dispatch-agent` here uses the
identical `claude --worktree ... --bg` mechanism, and `fresh-work`/
`feature-development`/`finish-pr` are all freely model-invocable (no
`disable-model-invocation`), so the same exposure applied to any dispatched
session that went on to invoke one of them — see `taskflow/CLAUDE.md`'s own
"Fixed 2026-08-22" section for the full transcript evidence. `setup-rules`/
`refresh-tools-rule`/`setup-explore` carry the lower-risk fenced-block form
of the same pattern (all three are user-only wizards, never invoked from an
automated dispatch path) — fixed for consistency, not from an observed
failure. Fixed everywhere by switching to bare `${CLAUDE_PLUGIN_ROOT}` — no
shell command runs, so there is nothing left to refuse. `finish-pr`'s
`plugin_root:` fact was split out of its combined git-context `!` block
into its own bare-substitution line, since that block also computes
`current_branch`/`fetch_status`, which do need real shell execution
(`git branch --show-current`, `git fetch origin`) and stay as-is. Do not
revert any of these back to a `!`-injected form for this value — prefer the
bare form even inside plain prose, not only inside a fenced command the
model runs (see `.claude/rules/script-authoring.md`).

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

**`.mcp.json` invokes `bin/mjs-launch.sh` (not `mcp/server.mjs` directly), with
`mcp/server.mjs` as its `args`** (2026-07-16 fix — the un-migrated original
scaffold had invoked `mcp/server.mjs` directly, node-only, the only one of this
repo's four self-contained MCP servers never given the bun-preferred wrapper
`universal-lint`/`universal-format`/`claude-code-knowledge` already carry).
Unlike those three siblings, `interaction_gate` spawns no external tool at
all, so their stated rationale ("the natural place to fix PATH for the
non-interactive MCP-spawn's external tool lookups") does not transfer here —
this wrapper exists purely so the zero-dep server itself can run under `bun`
when available, for runtime parity with the rest of the repo. The wrapper is
still a byte-for-byte copy of `universal-lint`'s hardened form (PATH
**appended**, not prepended — same rationale as that plugin's own CLAUDE.md)
since its bun-discovery role is identical even though its tool-discovery role
is not. `server.mjs` itself is unchanged — no inline re-exec shim, the
wrapper is the sole runtime selector.

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

## Hook design (`worktree_refresh`)

**`PostToolUse` → `mcp_tool` hook, matcher `EnterWorktree`: `tool: "worktree_refresh"`**
(2026-07-24 addition). After `EnterWorktree` creates a _new_ worktree (`tool_input`
has no `path` key — a `path` call is a switch into an existing worktree, not a
creation), fetches and rebases it onto the repo's default branch on `origin`,
mirroring `fresh-branch`'s own `refresh_onto()` logic. Deliberately **not** a
`WorktreeCreate` hook: per the official docs, `WorktreeCreate` _replaces_ Claude
Code's entire git-worktree-creation logic globally (every worktree path — CLI
`--worktree`, subagent `isolation: worktree`, background sessions — in every
project with this plugin enabled), so a bug there would break worktree creation
everywhere, not just here. `PostToolUse`/`EnterWorktree` is scoped to worktrees
created via the `EnterWorktree` tool in a live session only — CLI/subagent/
background-session worktrees are not refreshed by this hook, an accepted scope
gap (design doc: `WorktreeCreate` would be the only way to close it, and was
rejected for the reasons above). `tool_response.worktreePath` is used as the
target directory (falls back to `cwd`) — both were confirmed, live, to already
point at the new worktree by the time `PostToolUse` fires. Fails open silently on
every non-actionable case (switch, non-worktree cwd, no remote); on fetch failure
or rebase conflict it reports via `hookSpecificOutput.additionalContext` (never
`decision: block`) — a conflict is always `git rebase --abort`ed first, so the
worktree is never left mid-rebase. Synchronous, not `async: true`: it mutates the
worktree's branch tip, and Claude must not act on the worktree before that settles.

**Every `git` call carries a per-call `timeout: 30_000`** (2026-07-25, CodeRabbit
finding on this PR). The server handles stdin messages synchronously on one thread,
so an unbounded `git` against a slow or unreachable remote would block every later
tool call on this server too, not just this hook. The bound is **per call, not per
fire** — a worst-case fire (`remote set-head`, `remote show origin`, `fetch`,
`rebase`) can still add up to a multiple of it — and a call killed by the timeout
surfaces through the same fetch-failure / rebase-report path as any other git
failure, never as a hang. `interaction_gate` calls no git at all, so the Stop gate
is unaffected by this bound.

**Fail-open toggle (`worktree_refresh`, `default: true`)** — the same fail-open
convention this plugin uses throughout: only the literal `"false"` disables. Read once at
server-start from the `CODING_TOOLBOX_WORKTREE_REFRESH` environment variable
(`.mcp.json`'s own `env` field interpolates `${user_config.worktree_refresh}`
into it) rather than argv, because this hook runs inside the long-lived
`mcp/server.mjs` process, not a fresh per-event
command spawn; official docs confirm `${user_config.*}` substitution works in
"MCP … server configs" (`.mcp.json`), not only in hook `command`/`args` —
verified NOT to work inside an `mcp_tool` hook's own `input` field in
`hooks.json` (that field only substitutes hook-event data like
`${tool_input.file_path}`), which is why the config value is threaded through
`.mcp.json`'s `env` instead. One real consequence: a `worktree_refresh` toggle
change only takes effect on the next server restart (session restart / plugin
reconnect) — the
same lag any `mcp_tool`-hook userConfig value would have, not a bug specific
to this toggle.

## Skill design (`fresh-branch`)

2026-07-25: the embedded script extracted to a standalone
`fresh-branch.sh` + colocated `fresh-branch.reference.md` per
`.claude/rules/script-authoring.md`'s updated convention.

Single synchronous bash script (now a standalone file, no MCP server, no
subagent), self-detecting worktree state via `git
rev-parse --git-dir` vs `--git-common-dir`. Supports a custom base/upstream
and a branch+base pair. Auto-stashes (`git stash push -u`) and pops
unconditionally around both paths, including the refresh-only path (now
universal for zero-argument invocations, not just inside a worktree —
2026-07-02, extended same day per user request) that creates no new branch —
never silently drops a stash on a pop conflict (exit `8`, reported). The
non-worktree branch-name collision check runs _before_ any stash or checkout so
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
resolved. No cross-plugin dependency, no code-review-rounds step (not
requested). Existing-PR handling (create if
none / update title+body via `gh api PATCH` — never `gh pr edit`, known to
silently fail on this repo's Projects-classic board — or `glab mr update` if
open / reopen-then-update if closed / report-and-stop if merged). Both agents' optional context-mode acceleration was removed
2026-07-05 (repo-wide context-mode phase-out, starting here); `rtk` was
evaluated as a replacement and found to give no measurable
benefit for most commands either agent runs (`gh run view --log-failed`,
`gh pr checks`, `gh api …` all came back byte-identical or only
cosmetically reformatted when diffed raw-vs-`rtk`; `glab`'s `ci
trace`/`api` paths remain unverified — no `glab` in the dev environment)
— **correction, 2026-07-16**: `ci-watcher`'s own bare `gh run list
--branch <branch>` call (used to find a failing run's id; distinct from
`ci-watch.sh`'s `--json`/`--jq` poll queries, which stay byte-identical
under `rtk`) does measurably benefit — 65–81% size reduction across
several real repos, run ids and pass/fail status both preserved — the
2026-07-05 test of this exact command was evidently stale (rtk version
drift since). `fresh-pr` now detects `rtk` once (`rtk_available` in its
git-context block, alongside `current_branch`/`detected_base`/etc.) and
passes it to `ci-watcher`, which prefixes only this one call with `rtk`
when available; the other command classes above remain unaccelerated.
`ci-watcher`'s `bin/ci-watch.sh` invocation is
now prefixed with `TMPDIR="<scratchpad path>"` (resolved once by
`fresh-pr`, `mktemp -d` fallback when no scratchpad is available) so the
script's own internal `mktemp` call lands in the session's scratch space
rather than shared system `/tmp` — its `TMPDIR` behavior is unchanged,
`mktemp` already prefers `$TMPDIR` when set (the script separately gained
an explicit `mktemp`-failure guard, exit `64`, documented in
`agents/ci-watcher.md`). 2026-07-25: the rebase script (previously embedded
at step 5) is now a standalone `rebase.sh` + colocated `rebase.reference.md`,
per `.claude/rules/script-authoring.md`'s updated convention; the
git-context `!`-block (the `## Git context` section) stays inline — extracting it is gated on
verifying `${CLAUDE_SKILL_DIR}` substitution inside a `!`-injection block
specifically, not yet proven in this repo. 2026-08-01: `finish-pr` became
this script's second consumer (its own new rebase-freshness-check step) —
see that skill's own CLAUDE.md section for why it stayed here rather than
moving to the plugin's `bin/`.

**CodeRabbit-readiness false-green (fixed 2026-07-11).** `ci-watcher`'s step 3
used to decide "CodeRabbit is done posting review feedback" from a blind,
LLM-judged grace period ("at most 3 polls over ~3 minutes, stop early on the
first poll that finds comments"). This false-green pattern was observed on
this plugin's own `ci-watcher` on PR #129 and again on PR #130 in the same
session, both times only caught because the
orchestrating session independently re-verified via `gh pr checks` + a
background poll of the CodeRabbit check + a GraphQL unresolved-thread count —
a workaround, not a fix. Root cause: the poll-count heuristic never looked
at the one signal that actually answers the question — CodeRabbit's own
GitHub check conclusion (deliberately excluded from step 1's real-CI verdict,
so it can't be reused there for a different purpose without a dedicated
query). Fixed at the source: `bin/ci-watch.sh` gained a second query mode,
`--coderabbit-check` (github only; usage-errors for gitlab, which has no
per-check concept for CodeRabbit — it posts only as MR discussions there),
reusing the same poll/timeout/rg_or_grep machinery to wait for that
excluded check's OWN bucket to leave `pending` — bounded by its own
`CI_WATCH_CODERABBIT_TIMEOUT` (default 600s), separate from the main
`CI_WATCH_TIMEOUT` (1800s) since it answers a different, generally
faster-resolving question. `ci-watcher.md` step 3 now calls this before its
(now single, non-looping) thread fetch; every exit code (concluded, not
found after 3 confirmations, or bounded-timeout-while-still-pending) proceeds
to the fetch regardless — the call only changes what gets noted in the
report, never whether CodeRabbit feedback is looked for.

## Skill design (`finish-pr`)

Narrower companion to `fresh-pr`: finalizes an _existing_ PR/MR rather
than opening one — rebases it onto its base (force-pushing) when the base
has moved ahead, undrafts it, turns on GitLab's delete-source-branch-on-
merge when it's off, and reconciles title/description against the actual
diff (`git log <base>..HEAD`, patch-if-wrong rather than blind
regenerate-and-overwrite). No subagent dispatch, no Task\* ledger;
`allowed-tools` carries no `Agent`/`Workflow`/Task\* grant.

**2026-08-01: its platform-detection/lookup/mutation mechanics were
extracted to three standalone scripts** (`skills/finish-pr/scripts/`, per
`.claude/rules/script-authoring.md`'s "substantial → standalone file +
colocated reference doc" convention — this skill went from zero bundled
scripts to three in one pass, so `scripts/` was used directly rather than
the single-script skill-root convention): `find-pr.sh` (platform detect +
PR/MR lookup + GitLab `.source_branch` verification — the old inline
copy of `fresh-pr` steps 7-8, now a real script instead of duplicated
prose; still not shared with `fresh-pr` itself, since that skill's own
lookup serves a different existing-or-create shape and this repo only
extracts duplication reactively), `finalize-pr.sh` (undraft +, GitLab
only, the delete-source-branch-on-merge toggle — re-fetching fresh
_inside_ the script after its own undraft call, rather than trusting a
snapshot the caller captured before that call ran), and
`apply-pr-update.sh` (writes a corrected title/description and verifies
the write landed). `allowed-tools` gained `Bash(bash:*)` for these (and,
independently, for the rebase step below) but kept
`Bash(gh:*)`/`Bash(glab:*)`/`Bash(jq:*)` too — same conservative call as
`fresh-branch` keeping `Bash(git:*)` even though `fresh-branch.sh` does its
own git calls internally, leaving room for ad hoc inspection the skill
prose doesn't itself script. What stayed inline, deliberately not
scripted: the "which state (open/closed/merged) means stop" branch (a
one-line lookup on the script's own `state:` output, not "a program"); the
`git rev-parse HEAD`/`fetch_status:`/`git log <base>..HEAD` reconcile
checks (trivial single commands per `script-authoring.md`'s trivial/
substantial line); and, above all, the actual judgment calls a script
can't make — deciding whether the title/description are stale and
composing the correction. Only that composed text crosses into a script,
as file-path parameters (`apply-pr-update.sh`'s `title-file`/`body-file`
args) — i.e. "verbatim" is extracted (the corrected text itself, and the
already-known platform/number/draft/base/head_sha fields), never the
judgment that produced it. `find-pr.sh` writes the PR/MR's _current_
title/body to its own temp files (`title_file:`/`body_file:`) for the
reconcile step to read and compare against — a different pair from
`apply-pr-update.sh`'s inputs, which the caller authors fresh with the
corrected text; each script's own `.reference.md` says so explicitly to
head off a future editor treating them as one pipeline.

**Rebase step (step 5), added 2026-08-01 — same day as the script
extraction above, on a sibling branch, then merged together:** checks
whether the PR/MR's base has moved ahead and, if so, rebases and
force-pushes autonomously — the one behavior this skill performs that
isn't purely read/toggle/PATCH, and deliberately **not** folded into a
fourth `finish-pr`-local script. Reuses `fresh-pr`'s own
`rebase.sh`/`rebase.reference.md` verbatim rather than duplicating the
fetch/merge-base/rebase logic — this **is** the "shared verbatim by
multiple callers" case `.claude/rules/script-authoring.md`'s `bin/`
section names, but the script stays put in `fresh-pr/` rather than moving
to the plugin's `bin/`: the two shared-reference precedents already in
this plugin (`dispatch-shared.md` in `feature-development/references/`,
`tool-routing-rows.md` in `setup-rules/references/`) both leave the
shared file in its original owning skill's directory and have the second
consumer reach in, rather than promoting it to a neutral location on
acquiring a second caller — `bin/` would also make it a `$PATH`-facing
executable project-wide for no reason here, and re-open the
`core.fileMode` exec-bit question this file never had to answer while
colocated in a skill directory (invoked via `bash`, not exec'd by name).
`finish-pr`'s own git-context `!` block gained a third fact,
`plugin_root:` (a plain `$CLAUDE_PLUGIN_ROOT` env-var read inside the
load-time preprocessing block — the same mechanism
`fresh-work`/`feature-development`/etc. already use for their own
`Plugin root:` context lines — not the `${CLAUDE_SKILL_DIR}` pre-injection
token, which resolves to the invoking skill's own directory and can't
address a sibling skill's file), so the step can compose
`<plugin_root>/skills/fresh-pr/rebase.sh` and `…/rebase.reference.md`
without an unverified new substitution combination. The remaining glue
around this call (the `HEAD`-match precheck, the `REBASE_RESULT=`
dispatch table, the force-push-if-rebased decision) stays inline rather
than becoming its own script — the same shape `fresh-pr`'s own step 5
already keeps inline for this identical script, per
`script-authoring.md`'s trivial/substantial line: a short dispatch on a
script's already-normalized output isn't "a program." One genuine
simplification the script extraction enabled here: this step reads
`$base`/`$head_sha` from `find-pr.sh`'s own normalized step-3 output
rather than re-deriving them per platform (`baseRefName`/`headRefOid` on
GitHub, `target_branch`/`.sha` on GitLab, as the pre-refactor prose had
to). Gated on local `HEAD` matching `$head_sha` before ever touching the
branch — the same guard the reconciliation step already needed, now
load-bearing for a second reason: without it, an autonomous force-push
could either publish local commits nobody asked this skill to push, or
clobber a push that landed after step 3's snapshot. `REBASE_RESULT=conflict`
aborts the rebase (via the script's own `git rebase --abort`) and is
reported, not treated as a hard stop — undraft, the GitLab toggle, and
reconciliation none depend on the branch having been rebased, so they
proceed normally. `REBASE_RESULT=skipped_dirty` (uncommitted local
changes present) is a deliberate no-op, not an inherited accident:
`rebase.sh` itself refuses to run against a dirty tree, and `fresh-pr`
never trips that guard because its own step 2 commits pending work
before ever calling the script — `finish-pr` has no such step, and
auto-stashing around an autonomous force-push is exactly the kind of
thing that risks eating someone's in-progress work, so the skill reports
the skip and tells the user to commit or stash and re-run rather than
silently working around it. **This flips a previously-documented
invariant:** the reconciliation step's own text used to assert "this
skill never pushes"; it now pushes exactly once, only as the direct,
autonomous consequence of its own rebase, via `--force-with-lease` (never
a bare `--force`) — never as a side effect of any other step. After a
`rebased` outcome the just-pushed local `HEAD` is treated as the new
remote head for the reconciliation step's own HEAD-match check without a
re-query (`git push` succeeding is proof enough), avoiding a second API
round trip. GitLab's delete-source-branch-on-merge is exposed by `glab mr
update --remove-source-branch`, which **toggles** the setting rather than
setting it to a fixed value — `finalize-pr.sh` only calls it when the
effective current value is off (`should_remove_source_branch` is
`false`/`null`/absent — the GitLab API's own docs show a real MR
returning `null` here — and `force_remove_source_branch` isn't `true`,
which would mean the project already forces it regardless of the per-MR
flag); calling it when already on would flip it back off. No per-PR
GitHub equivalent exists (only a repo-level "auto-delete head branches"
setting), so that half is a no-op there. Merged/closed PR/MR states both
stop before any mutation (not explicit in the original request, added so
every reachable state has a defined outcome) — reopening a closed one
stays `fresh-pr`'s job. No new `userConfig` toggle, matching every other
skill here. Its own git-context `!` block runs `git fetch origin` (unlike
a bare `git branch --show-current`) so its title/description
reconciliation step's `git log "origin/$base"..HEAD` sees a current ref
rather than a stale one — and emits that fetch's own exit status as a
`fetch_status:` line, since a discarded status would leave a failed fetch
indistinguishable from a successful one; `failed` skips only the
reconciliation step (undraft and the GitLab toggle don't depend on a
fresh `origin/$base`). `find-pr.sh` URL-encodes `$branch`
(`jq -rn --arg b "$branch" '$b|@uri'`) before either GitLab query and
verifies the matched MR's `.source_branch` before ever printing a result —
a raw `&`/`?`/`#` in a branch name would otherwise inject a query
parameter and match the wrong MR; a mismatch is a hard script error
(exit `5`), not a caller-side check, since it's a deterministic string
comparison with no judgment involved. `find-pr.sh` also gates on
`gh`/`glab` auth status _before_ the lookup call (exit `3`) — both CLIs
return non-zero for "not found" and "dead token" alike, so checking auth
first is the only way the skill can tell "no PR/MR exists" from "your
token is broken" apart. Reconciliation still treats the fetched
title/body/description and commit messages as untrusted, contributor-
controlled data to read, never as instructions, and `apply-pr-update.sh`
never inlines that text as a literal inside a double-quoted command
string when applying a correction — GitHub via `gh api -F key=@file`
(file-based field input, confirmed in `gh api`'s own docs; this is why
`-F`, not `-f`, is required there), GitLab by `cat`-ing the file straight
into a shell variable and passing it as a quoted reference (`"$title"` is
always safe regardless of content; no heredoc needed once the corrected
text already lives in a file, unlike the pre-script inline prose which had
to embed it via a quoted heredoc since there was no file to `cat`) — both
sidestep `$()`/backtick/quote re-parsing regardless of what the text
contains. `apply-pr-update.sh` verifies the applied title AND body/
description post-update, not title alone (exit `5` on mismatch).

## Skill design (`fresh-work`)

Thin dispatcher (`skills/fresh-work/SKILL.md`, five steps: classify → branch
name → branch (`fresh-branch`) → dispatch → PR (`fresh-pr`)) — a 2026-07-24
split of what used to be a single ~9-step, five-reference-file pipeline.
Design/Plan/Implement/Review (the former "design path", steps 4-9) now live
in `feature-development`/`debugging` below; `fresh-work` no longer performs
any of that itself. Step 4 (Dispatch) is a single `Skill` invocation of
whichever sibling skill step 1's classify table names — `coding-toolbox:debugging`
(fix) or `coding-toolbox:feature-development` (feature and refactor both — the
two share an identical pipeline, only the branch prefix differs). A
same-session review pass caught, later the same day, that this split
initially left `refactor` routed through a dedicated `refactoring` delegator
skill; that skill was removed and both classifications now point straight at
`feature-development` — no behavioral difference existed between the
delegator and a direct call, so the extra hop was pure indirection. `fresh-pr`
stays a `fresh-work`-only call site (not pushed into the new skills),
unchanged from before this split — one place holds the "surface minor
findings at the PR stage" glue. `allowed-tools` shrank to
`Skill`/`Read`/`ToolSearch`/the Task* set (`Read` needed only to load the
shared `references/dispatch-shared.md` below) — every other tool (`Bash`,
`Agent`, `Workflow`, …) moved with the logic that used it. `AskUserQuestion`
stays deliberately absent (same rationale as before the split — its
remaining call sites here, the missing-description ask and the
branch-name-collision ask, are meant to stay deliberate, not
blanket-approved). Its `AskUserQuestion` banner and Task-list core are read
from `feature-development/references/dispatch-shared.md` (a same-day Review
finding: the two skills carried this scaffolding text duplicated verbatim;
extracted into one shared file both Read, same precedent as
`setup-rules`/`refresh-tools-rule`'s `tool-routing-rows.md`) — this skill's
own Task-list section keeps only what's specific to it (its own step
bootstrap). Step 4's invoked skill nests its own steps under fresh-work's
still-`in_progress` `Step 4` (`Step 4.1`…`Step 4.x`) rather than creating
independent top-level `Step 1`.. entries — a same-day Review finding caught
that the original split had `feature-development` starting its own
unconditional `Step 1`, colliding with `fresh-work`'s own step numbering by
reusing the same labels. `Step 4` itself legitimately stays `in_progress` for
the whole nested call (it represents "waiting on the callee", not an idle
task) — a follow-up CodeRabbit finding on the PR caught that the fix as first
written only addressed the naming collision, not the ledger-invariant
question of what happens to the caller's own task while the callee runs; see
`dispatch-shared.md`'s scoping rule (fixed the same day: "exactly one
in_progress" is scoped to each skill's own step-list segment, not a global
count over the shared physical ledger) and `feature-development`'s own
section for the nesting rule.

## Skill design (`feature-development`)

Split out of `fresh-work` 2026-07-24 (was its design-path pipeline, steps
4-9) alongside `debugging` (the fix path). Owns both the `feature` and
`refactor` classifications directly (the two share an identical pipeline —
only the branch prefix differs, decided by `fresh-work` before this skill is
invoked); a dedicated `refactoring` delegator skill existed briefly the same
day and was removed once Review flagged it as pure indirection with no
behavioral difference from a direct call — see `fresh-work`'s own section.
Owns the pipeline: `skills/feature-development/SKILL.md` + four phase guides
under `references/` (moved verbatim from `fresh-work`, Read only when their
phase starts) run design → **intent confirmation** → plan → implement →
**review** (combined review workflow). `fresh-work` still owns classify/branch/PR
— this skill is invoked (Skill tool) once a branch already exists, and
returns to `fresh-work` afterward without opening a PR itself; `debugging`'s
own verify step (new test passes, suite green, symptom gone) covers a single
targeted fix, where this skill's Review is scoped to the design path's
larger, multi-task diffs. **Step numbering nests under a caller's active
step** when invoked from `fresh-work` (`Step 4.1`…`Step 4.5` under
`fresh-work`'s `Step 4: Dispatch`, recursing one further level for
Implement's own per-wave `Step N.1…N.x`), falling back to independent
top-level `Step 1`…`Step 5` only when invoked standalone with no caller step
`in_progress` — fixed the same day a same-session Review pass caught the
original unconditional top-level numbering colliding with `fresh-work`'s own
step numbers. `fresh-work`'s `Step 4` task is never suspended or completed
early to make room for this — it legitimately stays `in_progress` for the
whole nested call, since `references/dispatch-shared.md`'s "exactly one
in_progress" rule is scoped to each skill's own step-list segment of the
shared ledger, not a global count across it (a CodeRabbit finding on the PR
caught that nesting the _numbering_ alone, without stating this lifecycle
explicitly, left the actual ledger-invariant question — what happens to the
caller's task while the callee runs — unanswered). Adapted
from superpowers'
brainstorming / writing-plans / subagent-driven-development — with the full
line-by-line human spec-review gate, execution-choice handoffs, and
cross-plugin references removed (the bats self-containment tripwire greps
the skill dir for `superpowers|branch-management`). Two narrower
steps were reintroduced later (2026-07-03, into the original `fresh-work`),
distinct from what was removed: **Intent confirmation** (this skill's own
step 2) shows the design doc's mandatory Keypoints section and asks
`AskUserQuestion` whether to proceed — the pipeline's one deliberate
human-facing checkpoint (hardened 2026-07-07: the Keypoints output is now a
mandatory numbered pre-step — read fresh from the spec temp path, emitted as
its own plain-text message before the `AskUserQuestion` call — made
explicitly distinct from the generic Task-list step-start announcement,
after a regression where the confirmation question was asked without the
design summary ever being shown); **Review** (step 5, `references/reviewing.md`)
runs ONE combined read-only review workflow over the full branch diff after
Implement — 2026-07-11, replacing the former `simplify`-then-`code-review
--fix` built-in-skill pair after observing both live: `code-review`'s cleanup
finder carries all four `simplify` lenses verbatim, so the pair did the
cleanup work twice, the first time entirely unverified (an earlier analysis
had rejected exactly this consolidation over altitude coverage + redundancy;
the explicit user decision to merge compensates both, as noted below).
Structure: correctness angles (3 at `high` effort for a Simple diff, 5 plus a
gap-hunt sweep at `max` for Complex, per this skill's own complexity
heuristic) plus one finder PER cleanup lens
(reuse/simplification/efficiency/altitude/CLAUDE.md-conventions — per-lens
granularity deliberately kept from `simplify`, unlike the built-in's single
merged cleanup finder), every candidate location-group verified
(CONFIRMED/PLAUSIBLE/REFUTED — cleanup findings are now verified before
apply, which `simplify` never did), a synthesizer that flags
`reversesDecision` findings against the plan/spec temp docs; all workflow
agents are pinned `model: 'sonnet'`. This skill then escalates flagged
findings via `AskUserQuestion`, applies the rest inline (keeping `simplify`'s
skip rule), and commits correctness and cleanup fixes as two separate
commits — a deliberate override of the repo's usual "one fix per commit,
never bundled" convention, at category granularity, never left pending for
`fresh-pr` to pick up. Prompt texts (correctness angles A–E, cleanup lenses,
verdict ladder) are vendored verbatim from the built-in `/code-review`
workflow and `/simplify` skill — lineage recorded only here, same precedent
as the `ci-watch.sh` port; the Agent-engine fallback batches finders then
verifiers under the subagent-reconciliation gate. Reviewing's Scope-phase
`DIFF_CMD` (the exact `git diff <base>...HEAD` every finder re-runs) was
evaluated for an rtk prefix (2026-07-16) and rejected: `rtk git diff`
silently truncates large hunks past a threshold (reproduced on this repo's
own commit `cb93fbb`, dropping 341 real added lines behind a truncation
placeholder) — the same risk that already rules out rtk for a reviewer's
`git show`; `DIFF_CMD` is therefore left unprefixed, so whether a run gets
rtk-compaction stays contingent on the operator's own environment (a personal
`rtk hook claude` PreToolUse hook gives it for free on some machines, not by
design of this plugin). Deliberately given up: the second independent
cleanup pass over already-fixed code; downstream CI + PR review stay the
backstop for an over-eager auto-fix. Design doc + plan are session temp files
(scratchpad dir, `mktemp` fallback), never committed. Design and Plan
(2026-07-03) each self-review **always**; consulting the advisor is their own
on-demand judgment call (a genuine uncertainty, or the task turning out more
complex than expected) — no longer a fixed pipeline step, no clean-room fork.
`AskUserQuestion` is deliberately absent from this skill's own
`allowed-tools` (it only pre-approves; `.claude/rules/skill-md-authoring.md`
— it does NOT restrict the tool) — its remaining call sites (a design
open-point clarification, the intent gate, the Review step's design-reversal
escalation, the advisor protocol's own decision-conflict escalation whenever
Design or Plan consults it) are meant to stay deliberate, not
blanket-approved; do not "fix" this by re-adding it, and re-check this list
if a new call site is added (the missing-work-description/branch-name-collision
asks and the fix path's 3-or-more-attempts escalation now belong to
`fresh-work`/`debugging` respectively — see their own sections).
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
a real dependency. This skill's own Task-list integration section separately
requires a one-line step-start announcement before each top-level step (and
each Implement wave) begins, so a long-running pipeline is never silent.
The Workflow-engine script inlines `planPath`/`constraints`/`tasks` as JS
literals rather than passing them via the Workflow tool's `args` parameter
(`references/implementing.md`, 2026-07-03) — `args` was observed twice to
arrive `undefined` inside the script even when supplied correctly, on both a
fresh call and a `resumeFromRunId` retry. `waves` is not part of that
inlining — it's derived inside the script by a plain `computeWaves(tasks)`
function (2026-07-05 simplify pass), so the wave-leveling arithmetic is never
hand-computed by the model and pasted in as a literal. `tasks`
itself is sourced (2026-07-11) from the plan's mandatory `## Machine-readable tasks`
JSON block, authored by the Plan phase in the same pass that writes the prose tasks
(`references/planning.md`), so this skill no longer re-parses its own plan
prose into the structured task list — the one genuine robustness gain a full
Plan+Implement workflow merge was reached for, captured without merging the phases
(the merge was analysed and rejected: it would regress the highest-leverage step by
pinning Plan to a zero-context Sonnet agent for ~zero determinism gain, since
Implement is already a Workflow).

**Design and Plan dispatch codebase exploration to the `explore` agent, never
inline Grep/Glob/Read** (fixed the same day `setup-explore` was added — the
Simple-complexity default previously told both phases to explore "yourself,
inline, no subagents," which meant this skill's own model, not a cheap
haiku-pinned search specialist, did every raw Grep/Glob/Read call itself).
`references/designing.md`'s step 1 now dispatches the `explore` agent (Agent
tool, `subagent_type: explore`) even in the Simple case — only the remaining
steps (writing the doc, etc.) stay inline; Complex work dispatches several in
parallel, one per touched subsystem. `references/planning.md` has no explicit
explore step of its own (it drafts from the already-explored design doc), but
any fresh codebase fact Planning still needs — an exact signature, a file's
current contents, an existing pattern — routes through the same `explore`
dispatch under "File structure first," never a direct tool call. `Grep`/`Glob`
stay in this skill's own `allowed-tools` regardless — Implement and Review
still have legitimate inline uses for them (e.g. reviewing.md's finder-agent
prompts instruct their own dispatched subagents to Grep, a different tool
grant than this orchestrating skill's own calls) — only Design/Plan's own
codebase-understanding step is restricted.

## Skill design (`debugging`)

Split out of `fresh-work` 2026-07-24 (was its fix path, steps 4-5).
Single-step skill (`skills/debugging/SKILL.md` + `references/debugging.md`,
moved verbatim — only its Exit section's wording changed, since PR is no
longer this skill's own next step): root-cause investigation → pattern
analysis → hypothesis/testing → failing-test-first implementation → verify,
all on the branch `fresh-work` already cut, adapted (via the original
`fresh-work`) from superpowers' `systematic-debugging` — lineage detail
recorded in `feature-development`'s section above, not repeated here. No
Task* ledger: a single linear methodology, not a multi-agent orchestrator
with a dispatch batch to reconcile. `allowed-tools` carries no
`Skill`/`Agent`/`Workflow`: this skill never opens the PR itself (that stays
`fresh-work`'s job, invoked after this skill returns) and never dispatches
subagents. `AskUserQuestion` stays absent from `allowed-tools` (its one call
site — the 3-or-more-attempts escalation, architecture-in-question — stays
deliberate, same rationale as `fresh-work`'s own absence).

## Skill design (`bump-version`)

2026-07-25: `bump-version.sh` extracted to a standalone file +
colocated `bump-version.reference.md` doc per
`.claude/rules/script-authoring.md`'s updated convention — the
heredoc-to-temp-file / `PART`/`SCRATCHPAD_DIR` placeholder-substitution
workaround this section used to describe no longer applies, the file
has real argv.

`bump-version.sh` detects exactly one
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
to file edits only. The one temp file the script itself creates (the
lock-sync log, via its own internal `mktemp` call) is routed into the
session scratchpad the same TMPDIR-propagation way as `fresh-pr`'s
`ci-watcher` dispatch above — an `export TMPDIR=` line the caller sets
before running the script, needing no change to the script itself.

**Marketplace-plugin support (`0.24.0`).** The cascade gained one new candidate,
checked **first**: `.claude-plugin/plugin.json`. Inside a plugin directory the
plugin manifest is the authoritative version location (this repo's
`.claude/rules/plugin-versioning.md`: a plugin's version lives only there), so a
`package.json` that happens to sit beside it must not win — precedence here is a
deliberate rule, not an accident, and the sibling `package.json` is left stale on
purpose. No new parsing code: `detect_json`/`write_json` are reused verbatim (a
`plugin.json` is JSON with a top-level `"version": "X.Y.Z"`, and both accept a
path containing a directory segment), and detection stays cwd-only — a fixed
cwd-relative subpath, never an upward walk, so the caller `cd`s into
`plugins/<name>` (an argv change, a `.git`-bounded walk to the marketplace root,
and an implicit walk-up-to-the-containing-plugin were all considered and
rejected; `Bash(cd:*)` was added to `allowed-tools` for the documented
invocation). Second new branch: a plugin-marketplace repo root
(`.claude-plugin/marketplace.json` present, no `plugin.json` of its own) is
refused with exit `3` and a message naming `plugins/<name>/`. It **must** sit
before `detect_json "package.json"` — this repo's own root `package.json` has no
`"version"` key at all (`grep -c '"version"' package.json` → `0`), and
`detect_json` hard-exits `4` from inside itself in that case, so a later-placed
guard would be dead code; exit `3` is reused rather than adding a code, since
SKILL.md maps every unknown non-zero code to "report stderr and stop" anyway.
`marketplace.json` is never written — only a `[ -f … ]` existence test — and is
explicitly not a lock file to propagate into, so `plugin` joins `maven|plain` in
the `no_convention` sync bucket (`sync_lock` never runs on this path, making
exits `6`/`7` unreachable there); a bats tripwire pins that every mention of
`marketplace.json` in the script is a comment, that existence test, or the error
message. The write `case` gained a `*)` arm (`internal error: no writer for
kind=…`, exit `5`) — not speculative hardening but a confirmed silent-failure
class: a patched script that added `kind="plugin"` to the cascade but not to
this `case` printed all four output lines including `new: 0.24.0` and exited `0`
while writing nothing, because an unmatched `case` succeeds and the trailing
`|| { … exit 5; }` therefore never fires (same family as the `ba868ee`
silent-version-corruption fix). The sync `case` deliberately gets no default arm
— an unmatched kind there leaves the truthful-enough `no_lockfile` default and
corrupts nothing. No `kind:` line was added to stdout: SKILL.md keys its
plugin-specific guidance off the reported `file:` path suffix instead, keeping
the four-line contract stable for existing callers and the script free of this
repo's own conventions. Both conventions the script cannot mechanically enforce
stay caller-side prose in SKILL.md — updating the plugin's own
`test/<name>/*.bats` version-pin assertion in the same commit, and judging "bump
once per unreleased release, not per commit" — because this skill still performs
no git operations at all and the pin's location/literal is repo-specific
knowledge it cannot derive.

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

## Skill design (`refresh-tools-rule`)

2026-07-10: split out of the `setup-rules` design during `fresh-work`'s
Review step. The original plan for `dream`'s tools-rule sync (see
`memory-enhancement/CLAUDE.md`) was to drop `disable-model-invocation` from
`setup-rules` itself so `dream` could call it directly with the verbatim mode
above (`args: "update tools rule"`) — a genuine "single source of truth"
option the user picked at the `fresh-work` intent-confirmation gate. An
altitude review during the same pipeline's Review step flagged the real cost:
that would open _every_ verb this skill supports — including destructive
`remove`/install on a machine-wide dotfile — to autonomous invocation by any
model turn in any session, to serve one narrow, non-destructive internal
caller. Re-surfaced to the user, who chose to split instead: `setup-rules`
keeps `disable-model-invocation: true` (its install/remove verbs stay
human-only), and this new skill carries no such flag — safe to be
model-invocable specifically _because_ its entire behavior is provably
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

## Skill design (`setup-explore`)

Added the same day the plugin-level `explore` agent + `reroute_explore` hook
(above) were removed — that hook's own "known, accepted collision risk"
section had documented that a user-level `~/.claude/agents/explore.md` would
be silently hijacked by the reroute; this skill installs exactly that file,
so keeping both would have defeated the point. Installs
`~/.claude/agents/explore.md` (user-level, applies to every project on this
machine — same scope as `setup-rules`' managed files) from one of two
bundled `references/` variants — `explore.initial-haiku.md` (plain, no MCP
dependency) or `explore.codebase-memory.md` (prioritizes the
codebase-memory-mcp graph, falls back to Grep/Glob/Read) — chosen by one
`command -v codebase-memory-mcp` detection line in a load-time `!` block,
the same idiom `refresh-tools-rule` Step 1 already uses for the same tool.
Byte-exact `cp` of the chosen file (never re-typed, same rationale as
`setup-rules`' `golden-rules.md` copy), written via `mktemp` + `mv` in the
target directory for an atomic, symlink-safe replace, with the `mv` gated on
the `cp` succeeding (2026-07-26, CodeRabbit finding on this PR — an unguarded
`mv` would replace a working install with the empty temp file) — the write
half of
`refresh-tools-rule`'s own hardening, minus its existence-gate: unlike that
skill, this one both creates and refreshes the file, since choosing the
right variant for the machine's current state is the entire point, not a
narrow refresh-only companion to a human-only installer.
**`disable-model-invocation: true`** — unlike `refresh-tools-rule`, this
skill unconditionally creates/overwrites the target on every run rather
than only ever rewriting an already-existing file's content, so it carries
the same real, if easily reversible, effect on every-project agent
behavior that `setup-rules`' install verbs do; user-only for the same
reason. No `AskUserQuestion`: the file to install is a deterministic
function of one detection line, not a genuine choice between options, so
there is nothing to ask — Step 4 reports what was installed and why
instead.

## Skill design (`dispatch-agent`)

Single-step skill, no extracted script (`skills/dispatch-agent/SKILL.md` only): dispatch a
real, independent, worktree-isolated background Claude Code session (`claude --worktree <name>
--bg`, tracked via `claude agents`/`claude logs`/`claude attach`/`claude stop`/`claude rm`) —
not the in-session `Agent` tool, which the user explicitly rejected during design (it
dispatches a subagent of the current conversation, not a separate session).

**Third design revision: dropped the pre-dispatch "sync the current branch" step entirely**
(`git fetch origin` + `git merge --ff-only @{u}`, previously step 1). It never fed the dispatch
— `claude --worktree` bases every new worktree off `origin/<default-branch>`, never the current
branch, so the sync's only effect was a side benefit: keeping the _current_ session's branch
from going stale. Asked directly whether to keep that side benefit or simplify to a single
step, the user chose to remove it — this narrows the skill to exactly what dispatch requires,
at the cost of that no-longer-automatic freshening (a plain `fresh-branch` covers it when
wanted). `allowed-tools` lost its `Bash(git:*)` grant along with it — nothing left in this
skill calls `git`.

**Second design revision (post-ship, same PR): switched from a hand-created worktree back to
the native `claude --worktree` flag, deliberately giving up "current branch as base."** The
first cut (see git history on this file/PR for the superseded prose) rejected `--worktree`
because it bases a new worktree off `origin/<default-branch>`, not the current branch — smoke-tested
and confirmed — and hand-rolled `git worktree add -b <name> <path> HEAD` instead, anchored on
the primary checkout (`realpath "$(git rev-parse --git-common-dir)/..")`) to avoid nesting.
Asked directly whether to keep that base-branch-preserving hand-roll or simplify onto the
native flag and accept `origin/<default-branch>` as the dispatched session's base, the user
chose the latter. This is a **recorded decision reversal**, not a bug fix — a future editor
re-introducing manual `git worktree add` "to fix the wrong base branch" would be undoing an
explicit choice, not restoring one. Upside of the reversal: `claude --worktree` already places
new worktrees as siblings under the primary checkout (verified — no nesting issue even from
inside another worktree), and a worktree it creates is tracked by the CLI's own job-state, so
`claude rm <id>` now fully removes it (unlike a hand-created one, which needed a separate `git
worktree remove`).

The prompt is embedded verbatim inside a quoted heredoc and read back via direct command
substitution (`"$(cat <<'EOF' … EOF)"`, no intermediate temp file) — so arbitrary **prompt**
content can't break the command (the heredoc's quoted delimiter is what buys this; it says
nothing about other values substituted elsewhere in the same command — see the `--model`/
`--effort` validation note below), and there's nothing left on disk to leak if the dispatch
fails after the heredoc is written (an earlier draft wrote the prompt to a `mktemp` file
first; under `set -e` a failing dispatch skipped the cleanup `rm -f`, leaking the prompt to
disk on every failed dispatch — fixed by removing the intermediate file entirely rather than
adding a `trap`). The worktree/session name still composes a 3-6-English-word slug of the
prompt (same convention as `fresh-work`'s own branch-naming step) with a `$(date +%s)-$RANDOM`
suffix for uniqueness (CodeRabbit finding, PR #156: a bare `$(date +%s)` alone only resolves to
the second, so two same-second dispatches of the same prompt would collide; `$RANDOM` closes
that gap without adding retry logic) — a bare timestamp was also readable only by attaching to
each session to read its prompt. `allowed-tools` carries `Bash`/`AskUserQuestion` only — no
`Agent`, no `Skill`. It was **widened from the old narrow `Bash(claude:*)` to bare `Bash` on
2026-08-19**: step 1's Bash call is a compound script (`set -e`, a
`name="…-$(date +%s)-$RANDOM"` assignment whose command substitution is not a known-safe
leading assignment, then `claude … --bg`), and the permission matcher splits on separators and
requires every sub-command to be covered independently (`.claude/rules` → the settings
reference's "Per-tool specifiers": "matches each subcommand independently") — so
`Bash(claude:*)` alone never auto-approved the dispatch, and it stalled on a permission prompt
(or was denied) with nobody present to answer. An earlier revision of this doc called that
stall "an accepted consequence of the narrow allowed-tools list, not a gap to fix by widening
it"; that stance is **reversed** — the narrow grant was the bug. The task/prompt text's own
safety still comes from the single-quoted heredoc, not the tool matcher, so widening the grant
adds no real exposure (same shape as the pipeline skills `build-task`/`feature-development`,
which already declare bare `Bash`).

**`--model`/`--effort`/`--permission-mode` on the dispatched session** (added post-ship, same
PR, per user request): `$prompt` may optionally start with `--model=<model>` and/or
`--effort=<effort>` (any order) — the skill parses and strips these itself before dispatch
(there's no `arguments:` frontmatter mechanism for optional flags mixed into a single
free-text arg; `arguments: prompt` still binds the whole raw input to `$prompt`), defaulting
to `sonnet`/`xhigh` when either is omitted. **Both are validated against `^[A-Za-z0-9._-]+$`
before being substituted into the command** (CodeRabbit finding, PR #156: unlike the prompt,
which is protected by the heredoc, `--model`/`--effort` were being interpolated as bare
double-quoted shell arguments — a value containing `$()`, backticks, or an embedded quote
would have executed as shell, not been treated as inert text) — a value failing that check is
reported before ever reaching the command line, not left to surface as a `claude` launch
failure. `--permission-mode auto` is **always** set explicitly,
unconditionally — not left to whatever the CLI's own default happens to be for a `--bg`
session, since the dispatched session has nobody present to answer an interactive approval
prompt. Verified live (dispatch, check result, cleanup) with the default `sonnet`/`xhigh`
pair.

## Tests

`test/coding-toolbox/` — split into one `.bats` file per thematic group (one
hook or skill each) instead of a single monolithic suite, once the latter grew
past 2200 lines. `test_helper.bash` holds what's genuinely shared across
groups — `common_setup` (isolated `$MOCKBIN`/`$HOME`, `$PLUGIN`/`$HOOKS`/`$SCRIPTS`),
`rg_or_grep` (used almost everywhere), and `make_stub` (used by both
`fresh-pr.bats`'s `ci-watch.sh` coverage and `bump-version.bats`) — every other
helper function (`setup_worktree_fixture`, `run_freshbranch`, `run_rebase`,
`encoding_guard`, …) stayed local to the one file that uses it,
not hoisted. Each `.bats` file starts with `load 'test_helper'` and its own
`setup() { common_setup; }`. `bats test/coding-toolbox/` (below) already runs
every `.bats` file in the directory — this is the same invocation CI uses
(`.github/workflows/test.yml`'s `pnpm exec bats "test/${{ matrix.plugin }}/"` targets
the directory, not a filename), so the split needed no CI change. Grouping:
`manifest.bats` (plugin.json/marketplace/root-README/test.yml-matrix invariants
plus generic README structure checks — content not owned by one skill/hook),
`golden-rules.bats`, `mcp-server.bats` (shared `coding-toolbox-hooks` MCP server
plumbing: `hooks.json`/`.mcp.json` validity, `mcp/server.mjs` + `bin/mjs-launch.sh`,
the `tools/list` roll-up), `stop-hook.bats` (`interaction_gate`), `worktree-refresh.bats`,
`encoding-guard.bats`, `fresh-branch.bats`,
`fresh-pr.bats` (also owns `ci-watch.sh` and the `ci-watcher`/`pr-fixer` agents —
they're fresh-pr's own bundled components, not worth a further split),
`finish-pr.bats` (also owns its three bundled `scripts/*.sh`), `fresh-work.bats`,
`feature-development.bats`, `debugging.bats`, `bump-version.bats`, `setup-rules.bats`,
`refresh-tools-rule.bats`, `setup-explore.bats`, `dispatch-agent.bats`. A handful of assertions that were
appended to the end of the original file long after their own skill/hook's main
block (e.g. a `plugin.json description mentions X` check, or a `README lists X`
check) moved to that skill/hook's own file rather than staying grouped by their
original append order — thematic coherence over historical position.

Content coverage, unchanged by the split: manifest/registration invariants, content coverage
for the relocated `golden-rules.md`, hook wiring (PreToolUse `command`, Stop
`mcp_tool`), an end-to-end JSON-RPC driver against `mcp/server.mjs` proving the Stop
gate blocks on a bare trailing `?`
and allows through otherwise. Coverage also includes: a ported `ci-watch.sh`
bats suite (hermetic, stubbed `gh`/`glab`), structural assertions for
`fresh-pr/SKILL.md` and the `ci-watcher`/`pr-fixer` agent frontmatter, and the
version-bump manifest assertion. `finish-pr`'s three scripts each get
hermetic exit-code/output coverage (real git repo + stubbed `gh`/`glab`,
same idiom as `fresh-pr`'s `ci-watch.sh` suite) — `find-pr.sh`'s platform
anchor-match/ambiguous-host/not-found/source_branch-mismatch/cli_unavailable
paths, `finalize-pr.sh`'s three-way GitLab toggle decision
(forced/already_on/enabled) plus its GitHub no-op, and
`apply-pr-update.sh`'s apply+verify success and verify-mismatch paths —
plus structural assertions (each script + colocated `.reference.md` exists,
`SKILL.md` reads each reference doc immediately before invoking that
script, `allowed-tools` carries `Bash(bash:*)`, self-containment tripwire).
`test_helper.bash`'s tool-forwarding loop gained `jq` for this suite's
hermetic script runs (a real, deterministic, non-networked tool, same
category as the `git`/`sed`/`awk` already forwarded there — not a
suite-local helper, since any future suite invoking a jq-using script
benefits identically). Structural assertions for
`fresh-work` (frontmatter minus `AskUserQuestion` plus a tripwire pinning that
absence, the classify table naming its sibling skills, step ordering
Classify/Branch name/Branch/Dispatch/PR, self-containment tripwire) now cover
only its own 5-step dispatcher shape (2026-07-24 split) — the design-path
coverage that used to live here (five — now four — phase references, the
Intent-confirmation step and its Keypoints dependency, the Review step's
combined-workflow structure with per-lens cleanup finders/sonnet model
pin/`reversesDecision` escalation/category commits, high/max effort choice,
temp-doc convention) moved to `feature-development`'s own structural
assertions, and `debugging` gets its own (frontmatter, root-cause/failing-test
content, self-containment tripwire). `refresh-tools-rule` gets structural
assertions (exists,
model-invocable frontmatter — i.e. no `disable-model-invocation` key — no
`rm`/install-path command anywhere in the file, the existence-gate present,
its four `command -v` detection lines present) plus an assertion that both it
and `setup-rules` reference the shared `tool-routing-rows.md` file rather than
inlining the candidate-rows table themselves. `bin/mjs-launch.sh` gets the
same structural + runtime-selection coverage as its `universal-lint`
counterpart (executable, bash shebang, missing-arg exit 64, neither/node/bun
PATH-selection cases, PATH-append order, and an end-to-end launch of
`mcp/server.mjs` through the wrapper). `setup-explore` gets structural
assertions (exists, `disable-model-invocation: true`, the `command -v
codebase-memory-mcp` detection line present, both reference files present
and named for their variant, the skill's apply step reads from
`references/` rather than inlining either file's body, and both bundled
reference files themselves carry `name: explore` frontmatter). `dispatch-agent`
gets structural assertions (exists, frontmatter naming `prompt` plus the required
`Bash`/`AskUserQuestion` `allowed-tools` entries, self-containment
tripwire, body mentions of `claude --worktree`/`--bg` and the `--model`/`--effort` defaults
and `--permission-mode auto`) — no script-extraction
coverage, since the skill's own git/CLI orchestration stays inline per
`.claude/rules/script-authoring.md`'s trivial/substantial threshold.
`setup-rules`' extracted `parse-args.sh` gets hermetic exit-code/output
coverage (pure string processing, no stubs needed — every verb/target
ambiguity path, the destructive-no-target case, the `uninstall`/`install`
substring-collision regression, case-insensitivity) plus structural
assertions (reference doc present, `SKILL.md` reads it before invoking,
`Bash(bash:*)` present, not executable, tripwire that the old inline
verb/target prose no longer appears in `SKILL.md`) — replacing, not
supplementing, the presence-only greps that used to cover this prose.
Run: `BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/coding-toolbox/`
