# taskflow — dev notes

## Boundary rule

The plugin ships these components:

- `skills/build-task/` — the inline orchestrator skill. Branch handling, `AskUserQuestion` checkpoints, invokes the two workflows below by name, applies escalated review fixes.
- `skills/dispatch-task/` — one-step skill that dispatches `build-task` into a worktree-isolated background session. Self-contained by requirement: no reference to any other plugin, its own copy of the `claude --worktree … --bg` mechanics.
- `workflows/design-to-spec.workflow.js` + `workflows/spec-driven-delivery.workflow.js` — the two dynamic Workflow-tool scripts that do the heavy lifting. Auto-discovered from the plugin-root `workflows/` directory (no manifest field needed); run namespaced as `/taskflow:design-to-spec` / `/taskflow:spec-driven-delivery`.
- `agents/*.md` — 11 static role prompts (`planner`, `designer`, `design-reviewer`, `review-finder`, `review-verifier`, `worktree-merger`, `fix-applier`, `pr-author`, `shipper`, `ci-monitor`, `ci-fixer`), dispatched by the workflows via `agentType: 'taskflow:<name>'`. INTERNAL — each agent's own description says not to delegate to it directly.
- `bin/ship-ensure-mergeable.sh` — the plugin's first `bin/` script (Ship merge-state remediation): shipper runs it before the ci-monitor loop to auto-update a `behind` branch or auto-resolve `-X ours`-clean conflicts so CI actually starts. Zero-dep bash, `chmod +x`. No new agent — the 11-agent roster is unchanged.

Renaming the plugin requires updating the `AGENTS` map's namespace prefix in both workflow scripts to match.

Every one of the 11 agent files also carries the identical, verbatim rule "No
narrative text between tool calls — call tools silently and speak only in
your final message (the report or structured output)." as its first paragraph
after frontmatter — these agents run headless inside a Workflow, so any prose
between tool calls is pure wasted tokens no one reads; only the last message
(plain text or the schema-forced structured output) is ever consumed. Add it
to any new agent file too.

Both workflow scripts also dispatch several roles with a **fully inline
prompt and no `agentType`** at all (so no plugin agents/_.md system prompt
backs them): design-to-spec's scout, codebase explorer
(`agentType: "Explore"`, the built-in agent — a foreign system prompt this
plugin doesn't own, so only the per-call prompt text can carry the rule),
spec writer, and spec reviewer; spec-driven-delivery's
plan checker, per-task implementer, per-task reviewer, per-task fixer, the
Review phase's scope-gathering agent, and its synthesizer. Each script
defines its own `const NO_NARRATION = "…"` (identical wording to the
agents/_.md rule) right after its `AGENTS` map, and every one of those inline
prompts is prefixed with it. Add the same prefix to any new inline
(non-`agentType`) prompt in either script.

## `workflows/` is a documented plugin component

This is the first plugin in the repo to ship a `workflows/` directory. It is
a real, documented Claude Code plugin component (auto-discovered like
`skills/`/`agents/`; see the curated `claude-code-plugins-reference.md`) —
`plugins/CLAUDE.md`'s structure table just predated it and now carries a
`workflows/` row (added alongside this plugin). Treat this plugin's use of
the directory as the standard, not an exception.

## userConfig

No `userConfig` in `plugin.json` — deliberate, see the `taskflow` entry in
`.claude/rules/plugin-userconfig.md`'s no-toggle exceptions: `build-task` only
ever runs on invocation — by the user directly, or by the model choosing to
invoke it. `dispatch-task` carries `disable-model-invocation: true` (added
2026-08-12 — it launches an unattended, `--permission-mode auto` background
session, so only an explicit user invocation may start one, never the
model's own judgment). Neither skill ever runs from a hook or other
unattended trigger, so there is no automatic/background behavior for a
toggle to suppress. (`dispatch-task` itself launches an unattended
background session once invoked, but the invocation that starts it is never
automatic.)

## Model assignment

Sonnet- and Haiku-tier roles use bare aliases (`sonnet`/`haiku` — each floats
to the newest model in that family). That is still the rule: pinned IDs caused
problems in practice and were removed in favor of aliases across the board
(commit `c66f3ea`).

**Opus tier is a deliberate, narrow exception as of 2026-08-12:** every
Opus-tier value is pinned to `claude-opus-4-8` because the `opus` alias
currently resolves to Opus 5, which has severe latency problems. Revisit and
return these to the bare `opus` alias once that is fixed. Pinned entries — all
of them, nothing else:

- `workflows/design-to-spec.workflow.js` → `MODELS.designer`
- `workflows/spec-driven-delivery.workflow.js` → `MODELS.planner`,
  `MODELS.synthesizer`, and `IMPL_MODEL.complex` (the per-task-complexity tier
  that `implModel()`/`fixModel()` resolve for `complexity === "complex"` tasks)
- `agents/designer.md` and `agents/planner.md` frontmatter `model:`

The `MODELS` object at the top of each workflow script is still the single
place to change an assignment; agent frontmatter `model:` fields must be kept
in sync with the corresponding workflow's default when an agent is also invoked
directly outside its workflow's normal path.

## Skill design (dispatch-task)

`skills/dispatch-task/SKILL.md` is a one-step skill: it dispatches
`/taskflow:build-task <task text>` into a new worktree-isolated background
session (`claude --worktree <name> --model "sonnet" --effort "xhigh"
--permission-mode auto --bg`, both overridable via `--model=`/`--effort=`) and
reports the CLI's own session id. Load-bearing decisions:

- **A deliberate fork of `coding-toolbox:dispatch-agent`, not a call into it.**
  taskflow carries its own inline copy of the dispatch mechanics so the plugin
  gains no cross-plugin dependency and keeps working when that plugin is not
  installed. The cost is accepted and permanent: neither copy inherits the
  other's future fixes. A bats tripwire greps `skills/dispatch-task/` for
  references to any other plugin and must find none — do not "deduplicate" this
  by calling the other skill.
- **`disable-model-invocation: true`** (added 2026-08-12): this skill launches
  an unattended, full-`--permission-mode auto` background session — per
  `.claude/rules/skill-invocation-control.md`'s "explicit reason" carve-out
  (deploy/destructive-side-effect skills stay user-only), only an explicit
  user invocation may start one, never the model's own judgment.
- **`--model=`/`--effort=` overrides (2026-08-30, was fixed `sonnet`/`medium`).**
  dispatch-task now accepts the same optional `--model=`/`--effort=` override flags as
  `coding-toolbox:dispatch-agent`, both defaulting `sonnet`/`xhigh`; the resolved values are
  validated against `^[A-Za-z0-9._-]+$` before substitution, so no override can skip the
  check. The default effort rose `medium`→`xhigh` for parity with dispatch-agent. (The
  cross-plugin naming here is allowed — this bullet lives in the plugin-root CLAUDE.md; the
  self-containment tripwire only scans the skill dir.)
- **`--permission-mode auto` always**, and the task text always travels inside a
  quoted heredoc read back by direct command substitution — no temp file, so a
  dispatch failing under `set -e` leaves nothing on disk to leak.
- **Reverted 2026-08-19: back to the fixed `DISPATCH_TASK_PROMPT_EOF`
  delimiter.** The 2026-08-12 "fresh delimiter per invocation" mandate (invent
  a ≥20-character token verified absent from the task text, reproduce it
  identically in the open and close lines) was itself the launch-failure bug:
  the model had to write the invented token identically **twice**, and any
  mismatch left the heredoc unterminated, so the `$(cat <<'…' … )"` command
  substitution broke and the background job either failed to start or launched
  with a mangled/empty prompt. The theoretical exposure it closed — a task
  containing a line exactly equal to `DISPATCH_TASK_PROMPT_EOF` — is
  vanishingly unlikely and is the same residual risk `coding-toolbox:dispatch-agent`
  has always accepted with its own fixed delimiter; the single-quoted heredoc
  already blocks all shell expansion of the task text. Reliability of a
  fixed, always-matching terminator wins over guarding that corner.
- **Fixed 2026-08-12: the payload cuts its own `feature/<slug>` branch first.**
  `claude --worktree` bases the new worktree on `origin/<default branch>` —
  unless this project's `worktree.baseRef` setting is `"head"` (not the
  default `"fresh"`), in which case it bases it on the dispatching session's
  own current `HEAD` instead (see the `worktree.baseRef` bullet below). Either
  way it checks the worktree out under an auto-generated branch NAME, never
  literally the base branch by name — `build-task`'s step 1 only cuts
  `feature/<slug>` when the current branch name equals `BASE_BRANCH` exactly,
  so without this fix the "otherwise, stay on the current branch" path fired
  on every dispatch and shipped from the ugly auto-generated branch instead,
  regardless of which base it started from. The payload's first instruction
  is now `git checkout -b "feature/<same-slug>"`, run by the new session
  itself (full `--permission-mode auto` tooling) — this skill's own Bash
  calls still never touch `git`, see below.
- **`worktree.baseRef` (CodeRabbit finding, PR #193 — this repo's own bundled
  `claude-code-knowledge` reference cache was stale on this exact setting;
  verified against the live `code.claude.com/docs/en/worktrees` doc before
  fixing).** `claude --worktree`'s base is controlled by the `worktree.baseRef`
  setting (`settings.json`), default `"fresh"` (branch from the repo's default
  branch on `origin`). A project that sets it to `"head"` instead gets every
  new worktree — `--worktree`, `EnterWorktree`, and subagent `isolation:
worktree` alike — branched from local `HEAD` where it runs, carrying
  unpushed commits/feature-branch state. This skill does not, and should not,
  try to override or second-guess that project-level choice; it only needs to
  document the conditional behavior accurately (this doc and `SKILL.md` used
  to claim the default-branch base unconditionally) rather than assume
  `"fresh"`. The `feature/<slug>` branch-cut fix above already behaves
  correctly under either mode without any further code change.
- **Unattended checkpoints:** `build-task` funnels every human decision through
  `AskUserQuestion`, so a dispatched run may pause at one with nobody present.
  The skill's report step says so and points at `claude attach <id>`; the
  dispatched prompt itself is the bare command plus the task text, with no
  autonomy nudging added.
- **This skill's own Bash never touches `git`:** `claude --worktree` starts the
  worktree with a clean tree regardless of its base (`origin/<default
branch>` or local `HEAD` per `worktree.baseRef` above), which already
  satisfies `build-task`'s clean-`git status` precondition (the `git checkout
-b` runs in the _dispatched_ session, not here).
- **`allowed-tools` is bare `Bash` (widened 2026-08-19), not `Bash(claude:*)`.**
  Step 1's Bash call is a compound script — `set -e`, a
  `name="…-$(date +%s)-$RANDOM"` assignment (its `$(date …)` command
  substitution is not a known-safe leading assignment), `[[ "$name" =~ … ]]`,
  then `claude … --bg`. The Bash permission matcher splits on separators and
  requires every sub-command to be covered independently (see the settings
  reference's "Per-tool specifiers"), so a narrow `Bash(claude:*)` never
  auto-approved the dispatch and it stalled on a permission prompt / was
  denied with nobody present — the actual "background job doesn't start"
  failure. Bare `Bash` matches the pipeline skills `build-task` /
  `feature-development`; task-text safety comes from the single-quoted heredoc,
  not the tool matcher, so widening adds no real exposure. `coding-toolbox:dispatch-agent`
  carried the identical latent gap and was widened in the same change.

## Generated pipeline artifacts are always English

The draft/spec/plan files the designer, spec writer, and planner write
(`draft-<slug>.md`, `spec-<slug>.md`, `plan-<slug>.md`, per `SKILL.md`'s
Session temp files section) are always written in English, regardless of
`$task_description`'s language — enforced by an explicit instruction in
`agents/designer.md`, `agents/planner.md`, and the inline spec-writer prompt
in `workflows/design-to-spec.workflow.js` (there is no dedicated agent file
for the spec writer). These files are read only by other agents in the
pipeline, never shown to the user directly, so a consistent working language
matters more than mirroring the request's language. This does not extend to
the final human-facing report the orchestrator gives the user (`SKILL.md`
step 5) or to reviewer finding text, neither of which are addressed here.

## Resuming inside an existing worktree/PR

`SKILL.md` step 1 only cuts a new `feature/<slug>` branch when the current
branch IS the base branch; otherwise it stays on the current branch,
including when build-task is invoked inside an already-checked-out worktree
that has an open PR/MR for its branch — Ship's create-or-update (`shipper.md`,
via `gh pr view <branch>`) then updates that PR/MR rather than opening a new
one. `fix-applier.md` and `worktree-merger.md` correspondingly check "is the
named work/merge-target branch checked out here" (`git branch
--show-current`), never "is this the primary repo root, not a worktree" —
the latter would incorrectly abort (fix-applier) or silently merge into the
wrong branch (worktree-merger) in exactly this resumed-worktree case.
Verified 2026-08-07: a non-isolated `agent()`/Agent-tool dispatch from a
worktree-isolated session correctly resolves `pwd` and `git
rev-parse --show-toplevel` to that worktree, not the primary repo root — so
no explicit checkout-path threading is needed for this to work. (A prior,
unrelated finding about _bridge_/remote-control sessions defaulting subagent
cwd to the primary root does not apply to this dispatch path — don't conflate
the two.)

## Fixed 2026-08-22: `build-task` hard-failed on every `dispatch-task` run

`SKILL.md`'s `## Plugin context` section used to capture the plugin root via
a load-time shell injection — `` Plugin root: !`echo "$CLAUDE_PLUGIN_ROOT"` ``
— rather than the bare `${CLAUDE_PLUGIN_ROOT}` pre-injection text
substitution already used elsewhere in this same file (the fallback
invocation step). Directly confirmed against real transcripts from several
`dispatch-task`-launched runs: invoking the Skill tool for `taskflow:build-task`
inside a worktree-isolated session (every `dispatch-task` run, by design)
comes back with the exact same "too complex to verify that it stays inside
the worktree" refusal `.claude/rules/script-authoring.md` already documents
for worktree-isolated Bash-tool calls — as the tool_result for the `Skill`
invocation itself, before step 1 ever executes. The precise static rule the
guard applies isn't confirmed from harness source (this repo's own prior art
on the Bash tool's out-of-worktree-path handling doesn't obviously predict
it for a bare `echo $VAR`), but the practical effect is: this exact line, in
this exact context, failed deterministically on every observed invocation —
because the skill body doesn't change between retries, retrying reproduced
the identical refusal every time, unlike a model-phrased Bash call that can
just be retried differently. One observed session retried three times, gave
up on the `Skill` tool entirely, and worked around it by manually
`find`/`cat`-ing `SKILL.md` out of the plugin cache and following it as
plain text; another retried until the user told it to stop. Fixed by
switching the line to bare `${CLAUDE_PLUGIN_ROOT}`: no shell command runs at
all, so whatever the guard's exact rule is, there is nothing left for it to
refuse. Do not revert this to a `!`-injected form — see the same rule file's
now-updated note.

**Fixed 2026-08-23 (follow-up): the 2026-08-22 fix reintroduced the same
failure through its own cautionary example.** The warning paragraph that fix
added to `SKILL.md`'s `## Plugin context` section quoted the anti-pattern
verbatim inside a double-backtick code span — but the load-time `!`-injection
preprocessor does **not** respect markdown code spans: any
exclamation-then-backtick sequence at line start or after whitespace is
executed as a live shell injection, prose or not. Confirmed against the
transcript of a fresh `dispatch-task` run on the fixed 1.4.1 cache
(`taskflow-build-https-proxy-config-wizard-…`): the `Skill` tool_result was
the identical worktree-guard refusal, before step 1 ever executed. Fixed by
rewording the warning to describe the pattern without ever writing the
two-character sequence, and hardening the bats tripwire from the old
line-start anchor (which deliberately — and wrongly — excused the prose
mention) to a zero-occurrence assertion over both `build-task` and
`dispatch-task` skill bodies. Rule: **never write a literal
exclamation-backtick sequence anywhere in any SKILL.md**, including examples,
quotes, and code spans.

A related, lower-severity finding from the same investigation: the harness's
worktree-isolation guard also refuses some Bash-tool calls containing
multi-statement/piped/command-substitution constructs unrelated to git,
independent of this fix — this is nondeterministic (depends on how a given
turn happens to phrase its own Bash call) and self-recovers in every
observed case (the model retries with simpler, separate commands), unlike
the deterministic `Plugin root:` failure above. Left unaddressed for now —
no single prompt wording reliably prevents a model from ever writing a
compound Bash call, and the observed cases did not block a pipeline.

## Tests

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/taskflow/
```

The suite is structural: plugin manifest invariants (no `userConfig`), the
`build-task` skill frontmatter + reference files, presence and frontmatter of
all 11 agents (including the least-privilege `tools:` allowlist on the 4
read-only-declared agents: `design-reviewer`, `review-finder`,
`review-verifier`, `ci-monitor`), both
`workflows/*.workflow.js` files' `export const meta` shape, the Opus-tier pin
(all four `MODELS`/`IMPL_MODEL` values, both agent frontmatter fields, the
comment blocks, the four docs, plus a whole-plugin sweep for a surviving bare
`opus`), and `dispatch-task`'s frontmatter, self-containment tripwire and
dispatch-command literals.

## Linting

`workflows/*.workflow.js` are excluded from the repo's `eslint.config.mjs`
(root `ignores`) — Workflow-tool scripts run inside an implicit async
wrapper, so top-level `await`/`return` are valid there but not parseable as a
standalone ES module.
