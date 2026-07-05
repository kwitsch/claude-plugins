# CLAUDE.md — coding-toolbox

Plugin that injects and enforces "golden behavior rules" via three hooks. `SessionStart`
content is baked in (`hooks/SessionStart.md`) with no runtime state. `PreToolUse` and
`Stop` are backed by one self-contained MCP server (`mcp/server.mjs`): `PreToolUse`
carries a session-lifetime call counter throttling the reminder; `Stop` is a stateless
mechanical gate for the Interaction axis. No userConfig.

## Hook design (do not "fix" without reading this)

- **SessionStart → `command` hook: `cat` + `args:["${CLAUDE_PLUGIN_ROOT}/hooks/SessionStart.md"]`.**
  SessionStart fires *before* the MCP server connects, so an `mcp_tool` hook would fail
  open. `args` present → exec form: `cat` is spawned with the path as its argument and
  writes the file to stdout; plain stdout reaches Claude at SessionStart (no JSON wrapper
  needed). No matcher → fires on startup, resume, and compact. Do NOT replace this with a
  `.mjs` handler on the premise that "args is dropped" — it is not (cc-reference,
  `claude-code-hooks-reference.md` "Exec vs shell form": *use exec form whenever
  referencing a path placeholder*).
  (`.claude/rules/hooks-mcp-server.md`, `.claude/rules/hooks-mcp-tool-event-matrix.md`)
- **PreToolUse → `mcp_tool` hook: `server: "plugin:coding-toolbox:coding-toolbox-hooks"`,
  `tool: "golden_rules_reminder"`** (server registered in `.mcp.json` as
  `coding-toolbox-hooks`; the hook's `server` field must use the runtime-namespaced
  `plugin:coding-toolbox:coding-toolbox-hooks` form, not the bare `.mcp.json` key — see
  `.claude/rules/hooks-mcp-server.md`). Matcher `Edit|Write|NotebookEdit|Bash` —
  deliberately **excludes** `Task`/`Agent`: the reminder must not fire before subagent
  dispatch (2026-07-01 decision), so those names were dropped from the matcher entirely
  rather than special-cased in the handler — the hook never fires for that tool, no
  MCP round-trip spent. `mcp/server.mjs` keeps a module-level `callCount` for the
  process lifetime (the server stays connected for the whole session) and returns
  `additionalContext` with the reminder text only on every 10th matched call
  (`callCount % 10 === 0`); every other call returns `{}` (no opinion, fail-open
  no-op — consistent with `mcp_tool`'s soft-block-only semantics). This throttling is
  exactly the kind of per-call dynamic state a static `cat`'d JSON file cannot express,
  which is why this hook — unlike SessionStart — now uses `mcp_tool`: do not revert it
  to a `command` hook over a static file, that would drop both the throttle and the
  tool exclusion.
- **Stop → `mcp_tool` hook (no matcher — `Stop` ignores it): `tool: "interaction_gate"`**
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
  add a counter here, unlike the PreToolUse tool.

The second `PreToolUse` entry (`hooks/encoding-guard.mjs`, matcher
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
an acceleration block today.

## Skill design (`fresh-work`)

Self-contained end-to-end pipeline orchestrator (`skills/fresh-work/SKILL.md` +
five phase guides under `references/`, Read only when their phase starts):
classify → branch (`fresh-branch`) → design → **intent confirmation** → plan →
implement → **review** (`simplify`, `code-review`) → PR (`fresh-pr`); the fix
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
pipeline's one deliberate human-facing checkpoint; **Review** (step 8,
`references/reviewing.md`) runs `simplify` then `code-review --fix` (both
built-in Claude Code skills, not marketplace plugins) over the full branch
diff after Implement, each
committing its own fixes immediately (repo convention: one fix per commit,
never bundled or left pending for `fresh-pr` to pick up) before PR — `high`
effort for a Simple diff, `max` for Complex, per SKILL.md's complexity
heuristic (explicit user choice — `code-review`'s own high/max tiers trade
confidence for coverage, not diff size, so this scales the wrong axis for a
Simple diff on paper; accepted because CI and PR review downstream are the
backstop for an over-eager auto-fix, not a call `reviewing.md` should make
instead). Design doc + plan are session temp files (scratchpad dir, `mktemp`
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

## Tests

`test/coding-toolbox/test.bats` — manifest/registration invariants, content coverage,
hook wiring (SessionStart command, PreToolUse `mcp_tool`, Stop `mcp_tool`), the
SessionStart end-to-end command test, an end-to-end JSON-RPC driver against
`mcp/server.mjs` proving the PreToolUse throttle (calls 1–9 return `{}`, call 10
returns the reminder), and one proving the Stop gate blocks on a bare trailing `?`
and allows through otherwise. Coverage now also includes: a ported `ci-watch.sh`
bats suite (hermetic, stubbed `gh`/`glab`), structural assertions for
`fresh-pr/SKILL.md` and the `ci-watcher`/`pr-fixer` agent frontmatter, and the
version-bump manifest assertion. Structural assertions for
`fresh-work` (frontmatter minus `AskUserQuestion` plus a tripwire pinning that
absence, five phase references, the Intent-confirmation step and its Keypoints
dependency, the Review step's `simplify`/`code-review` ordering and
high/max effort choice, self-containment tripwire, temp-doc convention) are
included.
Run: `BATS_LIB_PATH=/usr/lib/bats bats test/coding-toolbox/`
