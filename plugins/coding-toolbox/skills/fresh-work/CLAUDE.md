# CLAUDE.md — coding-toolbox skill: fresh-work

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
