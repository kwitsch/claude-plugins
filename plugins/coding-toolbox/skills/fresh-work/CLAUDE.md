# CLAUDE.md — coding-toolbox skill: fresh-work

## Skill design (`fresh-work`)

Thin dispatcher (`skills/fresh-work/SKILL.md`): classify → branch name → branch (`fresh-branch`) → dispatch → PR (`fresh-pr`). Design/Plan/Implement/Review live in `feature-development`/`debugging`; `fresh-work` does none of that itself.

- Step 4 (Dispatch) is a single `Skill` invocation of the sibling skill step 1's classify table names: `coding-toolbox:debugging` (fix) or `coding-toolbox:feature-development` (feature and refactor both — identical pipeline, only the branch prefix differs). No dedicated `refactoring` delegator skill: it added no behavior over a direct call, pure indirection.
- `fresh-pr` stays a `fresh-work`-only call site (not pushed into the sibling skills) — one place holds the "surface minor findings at the PR stage" glue.
- `allowed-tools` is `Skill`/`Read`/`ToolSearch`/the Task* set; `Read` is needed only to load the shared `references/dispatch-shared.md`. Every other tool (`Bash`, `Agent`, `Workflow`, …) moved with the logic that used it.
- `AskUserQuestion` stays deliberately absent from `allowed-tools`: its remaining call sites (missing-description ask, branch-name-collision ask) are meant to stay deliberate, not blanket-approved.
- The `AskUserQuestion` banner and Task-list core are read from `feature-development/references/dispatch-shared.md` — one shared file both skills Read instead of duplicated scaffolding text (same precedent as `setup-rules`/`refresh-tools-rule`'s `tool-routing-rows.md`). This skill's own Task-list section keeps only its step bootstrap.
- Step 4's invoked skill nests its steps under fresh-work's `in_progress` `Step 4` (`Step 4.1`…`Step 4.x`), never as independent top-level `Step 1`.. entries — those would collide with fresh-work's own step labels.
- `Step 4` legitimately stays `in_progress` for the whole nested call (it represents "waiting on the callee", not an idle task). "Exactly one in_progress" is scoped to each skill's own step-list segment, not a global count over the shared ledger — see `dispatch-shared.md`'s scoping rule and `feature-development`'s own section for the nesting rule.
