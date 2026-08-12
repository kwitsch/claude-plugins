# taskflow — dev notes

## Boundary rule

The plugin ships these components:

- `skills/build-task/` — the inline orchestrator skill. Branch handling, `AskUserQuestion` checkpoints, invokes the two workflows below by name, applies escalated review fixes.
- `skills/dispatch-task/` — one-step skill that dispatches `build-task` into a worktree-isolated background session. Self-contained by requirement: no reference to any other plugin, its own copy of the `claude --worktree … --bg` mechanics.
- `workflows/design-to-spec.workflow.js` + `workflows/spec-driven-delivery.workflow.js` — the two dynamic Workflow-tool scripts that do the heavy lifting. Auto-discovered from the plugin-root `workflows/` directory (no manifest field needed); run namespaced as `/taskflow:design-to-spec` / `/taskflow:spec-driven-delivery`.
- `agents/*.md` — 12 static role prompts (`planner`, `designer`, `design-reviewer`, `review-finder`, `review-verifier`, `worktree-merger`, `fix-applier`, `pr-author`, `shipper`, `ci-monitor`, `ci-fixer`, `cache-probe`), dispatched by the workflows via `agentType: 'taskflow:<name>'`. INTERNAL — each agent's own description says not to delegate to it directly.

Renaming the plugin requires updating the `AGENTS` map's namespace prefix in both workflow scripts to match.

Every one of the 12 agent files also carries the identical, verbatim rule "No
narrative text between tool calls — call tools silently and speak only in
your final message (the report or structured output)." as its first paragraph
after frontmatter — these agents run headless inside a Workflow, so any prose
between tool calls is pure wasted tokens no one reads; only the last message
(plain text or the schema-forced structured output) is ever consumed. Add it
to any new agent file too.

Both workflow scripts also dispatch several roles with a **fully inline
prompt and no `agentType`** at all (so no plugin agents/_.md system prompt
backs them): design-to-spec's scout/top-up-scout, codebase explorer
(`agentType: "Explore"`, the built-in agent — a foreign system prompt this
plugin doesn't own, so only the per-call prompt text can carry the rule),
Explore-cache writer, spec writer, and spec reviewer; spec-driven-delivery's
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
session (`claude --worktree <name> --model "sonnet" --effort "medium"
--permission-mode auto --bg`) and reports the CLI's own session id. Load-bearing
decisions:

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
- **`sonnet`/`medium` are fixed constants, not flags** — the whole argument is
  the task description. The `^[A-Za-z0-9._-]+$` validation rule is stated in the
  skill anyway, so a future override cannot skip it.
- **`--permission-mode auto` always**, and the task text always travels inside a
  quoted heredoc read back by direct command substitution — no temp file, so a
  dispatch failing under `set -e` leaves nothing on disk to leak.
- **Fixed 2026-08-12: the heredoc delimiter is chosen fresh per invocation,
  never a fixed literal.** The invoking model reads the whole task text first
  and picks a ≥20-character delimiter verified absent from it, instead of the
  old fixed `DISPATCH_TASK_PROMPT_EOF` literal — closing the gap where a task
  description containing a line exactly equal to that fixed terminator would
  end the heredoc early and have its remainder parsed as shell input in the
  _dispatching_ session. `coding-toolbox:dispatch-agent` still carries the
  original fixed-delimiter form — out of scope for this fix, a known,
  unaddressed sibling exposure (see that plugin's own CLAUDE.md).
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
- **No `git`, hence no `Bash(git:*)` grant:** `claude --worktree` starts the
  worktree with a clean tree regardless of its base (`origin/<default
branch>` or local `HEAD` per `worktree.baseRef` above), which already
  satisfies `build-task`'s clean-`git status` precondition.

## Explore-result cache

`workflows/design-to-spec.workflow.js` PHASE 1 caches the joined exploration
reports for the session, so a resume round does not re-run the up-to-4 `sonnet`
explorers. Every point below is load-bearing:

- **Derived path, never an arg:**
  `EXPLORE_CACHE_PATH = DRAFT_PATH.replace(/\.md$/i, "") + ".explore-" + taskKey(TASK) + ".md"`.
  `skills/build-task/SKILL.md` builds the `args` object literal in prose at two
  independent resume call sites (step 2's question loop, step 3's
  intent-correction loop); a new required-on-resume key would have to be added
  to both, and missing one would silently break exactly that path. So
  `decodeArgs`'s `required` array stays `["TASK", "DRAFT_PATH", "SPEC_PATH"]`
  and the task identity is hashed into the file name instead of compared as
  text an agent echoes back.
- **The script never touches the filesystem.** Cache read
  (`explore-cache:probe`, `haiku`) and cache write (`explore-cache:write`,
  `sonnet`) are `agent()` dispatches, per the no-FS contract in the file's own
  header. `FINGERPRINT_CMD` is one constant shared by both prompts, so probe
  and writer can never diverge. The probe runs as `agentType:
'taskflow:cache-probe'` (`agents/cache-probe.md`, `tools: ["Bash",
"Read"]`) — it needs `Bash` for `FINGERPRINT_CMD` but never `Write`/`Edit`,
  unlike the general-purpose-tooled writer. The write is dispatched
  concurrently with the first designer call (`parallel()` in Phase 2) only on
  a miss/fresh round, since Design only needs `explorationBlock` there and
  never reads `EXPLORE_CACHE_PATH` itself; on a cache-hit top-up round
  (`needsSerialWrite`), the designer's `explorationBlock` instructs it to
  read that same file for the earlier-cached sections, so the write is
  awaited first to avoid a torn read. The writer reuses the probe's
  already-computed fingerprint on any RESUME round instead of re-running
  `FINGERPRINT_CMD` a second time. A null/`blocked` writer result gets one
  script-enforced retry (`writeCache()`) only in idempotent `create` mode —
  `append` is not idempotent (a blind retry risks duplicating the new
  section), so it keeps only the writer's own single-turn `wc -l` self-check.
- **One gate for cached data:**
  `const cachedAreas = cacheHit ? parsedAreas : [];` (`test/taskflow/test.bats`
  pins that literal line). `probe.found === true` only certifies "the header
  parsed" — a fingerprint mismatch or a `declaredLines !== actualLines`
  mismatch still returns a populated `areas` array. `covered`, `budget`,
  `coverageNote`, `areaLine`, the `log()` lines and `explorationBlock` read
  `cachedAreas` only. Without the gate a miss round would filter freshly
  scouted subsystems against stale names and write an `AREAS` manifest naming
  areas it never explored.
- **`LINES` is the fidelity guard.** A workflow script cannot write files, so
  the ~20-30k-character exploration blob has to pass through an LLM's output.
  The script computes the expected total line count in pure JS and dictates it
  to the writer; the next probe compares it to `wc -l`. A mismatch invalidates
  the cache rather than trusting a truncated body.
- **Every uncertainty degrades to the old behavior** — full exploration. Probe
  failure, fingerprint mismatch, mangled cache, and a failed write are all
  logged and continue; the cache never blocks or fails a run.
- **Cache growth is bounded** by `MAX_TOTAL_EXPLORE_AREAS = 6` — the running
  total per session, not "4 + at most 2 more": a single resume round's actual
  top-up is `min(6 - areas already cached, MAX_PARALLEL_EXPLORES)`, which can
  exceed 2 when the first scout used fewer than `MAX_PARALLEL_EXPLORES = 4`;
  per-round parallelism stays at that same cap.

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

## Tests

```bash
BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/taskflow/
```

The suite is structural: plugin manifest invariants (no `userConfig`), the
`build-task` skill frontmatter + reference files, presence and frontmatter of
all 12 agents (including the least-privilege `tools:` allowlist on the 5
read-only-declared agents: `design-reviewer`, `review-finder`,
`review-verifier`, `ci-monitor`, `cache-probe`), both
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
