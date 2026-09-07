# CLAUDE.md — test/coding-toolbox

## Exit codes

This plugin's review-style scripts (`bin/ci-watch.sh`, `skills/finish-pr/scripts/{apply-pr-update,finalize-pr,find-pr}.sh`, `skills/fresh-branch/fresh-branch.sh`) use a specific scheme: missing CLI → 2, no login → 3, failure/hang → 4. This is implemented only here — see `.claude/rules/test-conventions.md`'s general "Exit codes" section for the repo-wide contract-testing convention.

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
