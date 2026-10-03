# CLAUDE.md — coding-toolbox skill: refresh-tools-rule

## Skill design (`refresh-tools-rule`)

### Why a separate skill

- Do not fold this into `setup-rules` by dropping its `disable-model-invocation`.
  - That would open every `setup-rules` verb, including destructive `remove`/install on a machine-wide dotfile, to autonomous invocation by any model turn in any session — to serve one narrow, non-destructive caller.
  - `setup-rules` keeps its install/remove verbs human-only; this skill carries no such flag.
- Model-invocable is safe only because the whole behavior is non-destructive.
  - It hard-gates on `~/.claude/rules/coding-toolbox-tools.md` **already existing**, so it can never opt a machine into anything.
  - From there it only rewrites that one file from current `PATH` detection, and never removes it.
  - Never add a create or remove path (a bats test pins that no `rm`/install command appears).
- Intended caller is `memory-enhancement:dream`, invoked with no arguments: the one action is always "refresh if installed, else no-op".

### Shared rows, duplicated scaffolding

- Candidate table rows live only in `skills/setup-rules/references/tool-routing-rows.md`, read by both this skill and `setup-rules` Step 4.
  - One file removes the drift risk outright; duplicated rows behind a bats sync-guard would only detect it after the fact.
  - Sharing a bundled reference costs nothing within one plugin, unlike the genuinely cross-plugin `ci-watch.sh` port.
- The heredoc scaffolding (`# Tool routing` header, `Detected on this machine…` line, the table's own header/divider) stays written out in both skills: small and stable, not worth extracting.
  - Only the row content that changes when a tool is added or reworded is shared.
- The four `command -v` detection lines stay inline: trivial one-liners.
