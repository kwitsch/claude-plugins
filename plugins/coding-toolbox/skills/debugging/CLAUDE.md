# CLAUDE.md — coding-toolbox skill: debugging

## Skill design (`debugging`)

Split out of `fresh-work` 2026-07-24 (was its fix path, steps 4-5).
Single-step skill (`skills/debugging/SKILL.md` + `references/debugging.md`,
moved verbatim — only its Exit section's wording changed, since PR is no
longer this skill's own next step): root-cause investigation → pattern
analysis → hypothesis/testing → failing-test-first implementation → verify,
all on the branch `fresh-work` already cut (lineage: adapted via the original
`fresh-work` from an external systematic-debugging methodology; see git
history for the source). No
`Task*` ledger: a single linear methodology, not a multi-agent orchestrator
with a dispatch batch to reconcile. `allowed-tools` carries no
`Skill`/`Agent`/`Workflow`: this skill never opens the PR itself (that stays
`fresh-work`'s job, invoked after this skill returns) and never dispatches
subagents. `AskUserQuestion` stays absent from `allowed-tools` (its one call
site — the 3-or-more-attempts escalation, architecture-in-question — stays
deliberate, same rationale as `fresh-work`'s own absence).
