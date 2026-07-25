# CLAUDE.md — coding-toolbox

Plugin that mechanically enforces "golden behavior rules" via four hooks: a `PreToolUse`
command hook (`encoding-guard.mjs`), a `Stop` `mcp_tool` hook (`interaction_gate`) and a
`PostToolUse` `mcp_tool` hook (`worktree_refresh`), both backed by a self-contained,
now-stateless MCP server (`mcp/server.mjs`), and a `PostToolUse` command hook
(`npm-ci-on-worktree.mjs`) that runs an async `npm ci` when `EnterWorktree` lands in a
`package-lock.json` project — both `PostToolUse` hooks fire on the same `EnterWorktree`
matcher, in the same `hooks.json` array. The
full golden-rules document lives, unwired, at `skills/setup-rules/references/golden-rules.md`
(moved from `hooks/SessionStart.md` when the `SessionStart` hook was removed);
`setup-rules` is the only way to get it onto a machine (user-level, every
project you open there), opt-in. The plugin's `userConfig` entries are
`npm_ci_on_worktree` (fail-open, default `true`) gating the `npm-ci-on-worktree`
hook and `worktree_refresh` (fail-open, default `true`) gating the `worktree_refresh`
hook below — the Stop gate and encoding guard have no toggle of their own.

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

## Hook design (`npm-ci-on-worktree`, do not "fix" without reading this)

**PostToolUse → `command`: `matcher: "EnterWorktree"`, `command:
"${CLAUDE_PLUGIN_ROOT}/hooks/npm-ci-on-worktree.mjs"`, `args:
["${user_config.npm_ci_on_worktree}"]`, `timeout: 300`, `async: true`.**
Fires after every successful `EnterWorktree` call (creating a new worktree or
switching into an existing one) — a fresh worktree's `node_modules` is
gitignored, so this proactively starts installing it. Checks only
`<cwd>/package-lock.json` (the hook's `cwd` is the _live_ session working
directory — confirmed against the official hooks doc during design: "Current
working directory when the hook is invoked", a point-in-time snapshot that
updates on `cd`/worktree-switch, not a fixed project root;
`${CLAUDE_PROJECT_DIR}` is a distinct, separately-documented env var for
that). If present, runs `npm ci` there via `spawnSync`. Silent on success and
on every guard miss (disabled, no `cwd`, no lockfile, `npm` process killed by
its own timeout) — the two exceptions are a real `npm ci` failure (truncated
stdout+stderr as `additionalContext`) and `npm` missing entirely from `PATH`
(a one-line note, so an nvm/volta shell that never sourced `npm` for however
Claude Code was launched doesn't leave this feature invisibly dead forever).

**Command, not `mcp_tool`, despite this plugin already running an MCP server
for the Stop hook** (`.claude/rules/hooks-mcp-server.md`'s decision tree
otherwise prefers reusing it for a plugin with 2+ hooks). `mcp_tool` has no
`async` field (`hooks-mcp-tool-event-matrix.md`'s `mcp_tool`
`GLOBAL_MECHANICS`: only `server`/`tool`/`input`) — a synchronous JSON-RPC
round-trip would block the agent loop for the full `npm ci` duration,
contradicting the user's explicit "async" request. Same `command` + `async:
true` idiom as `universal-lint`'s `lint-file.mjs`, not a hand-rolled detached
child process — `async: true` already gives fire-and-forget semantics for
free.

**`args` is deliberately exec-form (`["${user_config.npm_ci_on_worktree}"]`),
not a shell string** — per `.claude/rules/hooks-json-authoring.md`: "Use exec
form (`"args": []`) when referencing path variables" / user_config
substitutions, same as `memory-enhancement`'s `check-dream-due.mjs`. If a
future review pass proposes collapsing this into the `command` string, that
is the same false schema claim this repo's own memory already documents
recurring across review passes — refute it by this citation, don't
re-litigate it.

**Fail-open toggle (`npm_ci_on_worktree`, `default: true`) — a deliberate
exception to `plugin-userconfig.md`'s state-creating-toggle recommendation.**
That rule recommends fail-closed here specifically because `npm ci` creates
external state (`node_modules`, network I/O) — the same shape as the rule's
own "auto-creates a folder" example. The initial design draft was
fail-closed for exactly that reason; the user explicitly asked for fail-open
instead at this feature's intent-confirmation gate, accepting the trade-off
(an old Claude Code build that can't resolve `${user_config.*}` placeholders
leaves the raw placeholder string, which is not the literal `"false"` and so
is treated as enabled — worst case is an unwanted background `npm ci`, not
data loss). Do not "fix" this to fail-closed without re-confirming with the
user first.

**Async despite mutating state whose ordering could matter.**
`.claude/rules/hooks-mcp-server.md`'s general guidance is to stay
synchronous when a hook "mutates state whose ordering relative to the next
tool call matters" — installing `node_modules` is exactly that (the agent
could try `npm test` before install finishes). Going async anyway is the
user's explicit, literal request ("async npm ci"), not an oversight.

No monorepo/nested-workspace lockfile walk (root of the entered worktree
only) and no concurrency guard against two overlapping `EnterWorktree` calls
into the same directory (`npm ci` is safe to re-run — always a clean
wipe+reinstall from the lockfile, so the worst case is wasted work, not
corruption) — both matched to the user's literal ask, not oversights.

**`npm ci` unconditionally deletes `node_modules` before reinstalling, and
this hook fires on switching into an _existing_ worktree too**, not only on
creation — re-entering a worktree while something in it is mid-run against
that `node_modules` (e.g. this very repo's own
`BATS_LIB_PATH="$PWD/node_modules"` bats invocation, or a live `tsc`/`npm
test`) would have its dependency tree pulled out from under it. Accepted,
not guarded: a guard would contradict `npm ci`'s own contract, and the user
asked for the simple, literal version — this is a deliberate consequence,
not a silent one; do not "fix" it with a running-process check without
re-confirming with the user first.

**The hook trusts the `PostToolUse` event's `cwd` field as-is, with no
cross-check against `EnterWorktree`'s own reported path.** A 2026-07-24
Review pass flagged this as a speculative (not confirmed) risk: if
`EnterWorktree` ever fires in a context where `cwd` tracking itself is wrong
(this repo's own memory documents a _different_, already-verified-absent
case — a linked/bridge session's Agent-tool subagents defaulting to the
primary repo root — but the platform could in principle have other,
undiscovered cases), `npm ci` would run — and wipe `node_modules` — in the
wrong directory. No practical mitigation exists without parsing
`EnterWorktree`'s free-text result (rejected during design as more fragile
than trusting `cwd`, see this file's design-doc citation above) or adding a
path-shape sanity check that would break the documented "switch into an
arbitrary existing worktree via `path`" case. Accepted as an unaddressed,
documented risk rather than defended against speculatively.

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

**Fail-open toggle (`worktree_refresh`, `default: true`)** — same convention as
`npm_ci_on_worktree` above: only the literal `"false"` disables. Read once at
server-start from the `CODING_TOOLBOX_WORKTREE_REFRESH` environment variable
(`.mcp.json`'s own `env` field interpolates `${user_config.worktree_refresh}`
into it) rather than argv, because this hook — unlike `npm-ci-on-worktree` —
runs inside the long-lived `mcp/server.mjs` process, not a fresh per-event
command spawn; official docs confirm `${user_config.*}` substitution works in
"MCP … server configs" (`.mcp.json`), not only in hook `command`/`args` —
verified NOT to work inside an `mcp_tool` hook's own `input` field in
`hooks.json` (that field only substitutes hook-event data like
`${tool_input.file_path}`), which is why the config value is threaded through
`.mcp.json`'s `env` instead. One real consequence: unlike `npm-ci-on-worktree`'s
per-event argv (always current), a `worktree_refresh` toggle change only takes
effect on the next server restart (session restart / plugin reconnect) — the
same lag any `mcp_tool`-hook userConfig value would have, not a bug specific
to this toggle.

## Skill design (`fresh-branch`)

2026-07-25: the embedded script extracted to a standalone
`fresh-branch.sh` + colocated `fresh-branch.reference.md` per
`.claude/rules/script-authoring.md`'s updated convention.

Single inline synchronous bash script (no MCP server, no subagent — same idiom
as `branch-management:new-branch`), self-detecting worktree state via `git
rev-parse --git-dir` vs `--git-common-dir`. Deliberately independent of
`branch-management` — supports a custom base/upstream and a branch+base pair,
which `new-branch` does not. Auto-stashes (`git stash push -u`) and pops
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
git-context `!`-block (line 26) stays inline — extracting it is gated on
verifying `${CLAUDE_SKILL_DIR}` substitution inside a `!`-injection block
specifically, not yet proven in this repo.

**CodeRabbit-readiness false-green (fixed 2026-07-11).** `ci-watcher`'s step 3
used to decide "CodeRabbit is done posting review feedback" from a blind,
LLM-judged grace period ("at most 3 polls over ~3 minutes, stop early on the
first poll that finds comments"). This is the same instance of the
false-green pattern documented for `branch-management`'s `ci-monitor`
(originally PR #86, re-observed on this plugin's own `ci-watcher` on PR #129
and again on PR #130 in the same session, both times only caught because the
orchestrating session independently re-verified via `gh pr checks` + a
background poll of the CodeRabbit check + a GraphQL unresolved-thread count —
a workaround, not a fix). Root cause: the poll-count heuristic never looked
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
report, never whether CodeRabbit feedback is looked for. `branch-management`
carries the same latent heuristic in its independent `ci-monitor.md` copy,
deliberately left unfixed here (out of scope — no dependency between the two
plugins; port the same fix there separately if it recurs on that plugin).

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
brainstorming / writing-plans / subagent-driven-development and
superpowers-automation's new-work — with the full line-by-line human
spec-review gate, execution-choice handoffs, and cross-plugin references
removed (the bats self-containment tripwire greps the skill dir for
`superpowers|branch-management`; lineage is recorded only here). Two narrower
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
one load-time fenced ` ```! ` dynamic-context block (one shell
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
`mcp/server.mjs` through the wrapper).
Run: `BATS_LIB_PATH="$PWD/node_modules" npx bats test/coding-toolbox/`
