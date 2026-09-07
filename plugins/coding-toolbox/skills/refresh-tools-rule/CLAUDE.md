# CLAUDE.md — coding-toolbox skill: refresh-tools-rule

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
