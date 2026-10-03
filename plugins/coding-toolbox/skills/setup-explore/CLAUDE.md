# CLAUDE.md — coding-toolbox skill: setup-explore

## Skill design (`setup-explore`)

- Do not add a plugin-level `explore` agent or `reroute_explore` hook: it would silently hijack the user-level `~/.claude/agents/explore.md` this skill installs.
- Keep `disable-model-invocation: true` (user-only).
  - Unlike `refresh-tools-rule`, this skill unconditionally creates/overwrites its target on every run, with a real if easily reversible effect on every-project agent behavior — the same class as `setup-rules`' install verbs.
- Scope is user-level (every project on the machine, like `setup-rules`' managed files), and it both creates and refreshes: picking the right variant for the machine's current state is the whole point.
  - So there is no existence gate, unlike the refresh-only `refresh-tools-rule`.
- No `AskUserQuestion`: the file to install is a deterministic function of one `command -v codebase-memory-mcp` line, not a genuine choice — Step 4 reports what was installed and why instead.
- The apply step reuses `refresh-tools-rule`'s write hardening (byte-exact `cp`, `mktemp` + `mv` in the target directory, `mv` gated on the `cp`); see `SKILL.md` Step 3 for why each piece exists.
