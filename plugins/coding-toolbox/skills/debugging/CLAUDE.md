# CLAUDE.md — coding-toolbox skill: debugging

## Skill design (`debugging`)

- Runs on the branch `fresh-work` already cut; this skill never cuts or opens anything itself.
- No `Task*` ledger: a single linear methodology, not a multi-agent orchestrator with a dispatch batch to reconcile.
- `allowed-tools` carries no `Skill`/`Agent`/`Workflow`: opening the PR stays `fresh-work`'s job (after this skill returns), and no subagents are dispatched.
- `AskUserQuestion` stays absent from `allowed-tools`: its one call site (the 3-or-more-failed-attempts "architecture in question" escalation in `references/debugging.md`) is meant to stay deliberate, not blanket-approved — same rationale as `fresh-work`'s own absence.
