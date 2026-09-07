# CLAUDE.md — coding-toolbox skill: setup-explore

## Skill design (`setup-explore`)

Added the same day the plugin-level `explore` agent + `reroute_explore` hook
(above) were removed — that hook's own "known, accepted collision risk"
section had documented that a user-level `~/.claude/agents/explore.md` would
be silently hijacked by the reroute; this skill installs exactly that file,
so keeping both would have defeated the point. Installs
`~/.claude/agents/explore.md` (user-level, applies to every project on this
machine — same scope as `setup-rules`' managed files) from one of two
bundled `references/` variants — `explore.initial-haiku.md` (plain, no MCP
dependency) or `explore.codebase-memory.md` (prioritizes the
codebase-memory-mcp graph, falls back to Grep/Glob/Read) — chosen by one
`command -v codebase-memory-mcp` detection line in a load-time `!` block,
the same idiom `refresh-tools-rule` Step 1 already uses for the same tool.
Byte-exact `cp` of the chosen file (never re-typed, same rationale as
`setup-rules`' `golden-rules.md` copy), written via `mktemp` + `mv` in the
target directory for an atomic, symlink-safe replace, with the `mv` gated on
the `cp` succeeding (2026-07-26, CodeRabbit finding on this PR — an unguarded
`mv` would replace a working install with the empty temp file) — the write
half of
`refresh-tools-rule`'s own hardening, minus its existence-gate: unlike that
skill, this one both creates and refreshes the file, since choosing the
right variant for the machine's current state is the entire point, not a
narrow refresh-only companion to a human-only installer.
**`disable-model-invocation: true`** — unlike `refresh-tools-rule`, this
skill unconditionally creates/overwrites the target on every run rather
than only ever rewriting an already-existing file's content, so it carries
the same real, if easily reversible, effect on every-project agent
behavior that `setup-rules`' install verbs do; user-only for the same
reason. No `AskUserQuestion`: the file to install is a deterministic
function of one detection line, not a genuine choice between options, so
there is nothing to ask — Step 4 reports what was installed and why
instead.
