---
paths:
  - "plugins/*/skills/**"
  - "plugins/*/commands/**"
  - "plugins/*/agents/*.md"
  - "plugins/*/bin/**"
---

# Rule: script authoring (inline-preferred)

Source: https://code.claude.com/docs/en/skills#inject-dynamic-context

## 1. Prefer inline over a bundled `.sh`

Default: put script logic where it runs, not in a separate `plugins/*/bin/*.sh`.

- **Skills and custom commands** → use **dynamic context injection**: `` !`cmd` ``
  inline (only when `!` is at line start or after whitespace) or a `` ```! `` fenced
  block for multi-line. The command runs once at load time as preprocessing; its
  stdout is spliced into the skill/command context before the model reads it. Keep
  the emitted output **terse and parseable** — it becomes context the model reasons
  over.
- **Agents** → a fenced `bash` block the agent runs via the Bash tool. Agents are
  not skills, so `!` preprocessing does **not** apply to agent definitions.
- **Degrade gracefully:** when `disableSkillShellExecution` is set, each `!` block
  is replaced with `[shell command execution disabled by policy]` (the
  skill/command still loads). Handle that placeholder defensively — never assume
  the command ran. Bundled and managed skills are not affected by the setting.

## 2. Inject before query

When a downstream agent or script needs a fact (tool/CLI availability, persisted
state, config), compute it **once** via skill `!` injection and pass it down in the
agent prompt — do not have the callee re-query it. Detection stays in one place
(the orchestrating skill, which has the richest context); no probe-and-soft-fail
agents.

## 3. Self-test = unit test (inline)

Running an inline script during development and confirming its output **is** its
unit test. Inline scripts (skill `!` blocks, agent fenced bash) get **no** separate
`.bats` test — the validation obligation is met by running it during development
and by downstream skill/agent behavior. See the test-conventions rule.

## 4. Keep a standalone executable only when justified

Keep a `.sh`/binary under `plugins/*/bin/` ONLY when it must be:

- exec'd by name / placed on `PATH` (e.g. a PATH facade like `bin/git-shim/git`),
- invoked via a `.mcp.json` or hook `command` field, or
- shared verbatim by multiple callers.

Such files keep their executable bit (see the bin-executable rule) **and** get a
bats test when their behavior is non-trivial (exit-code contract, edge cases).

The two canonical bundled-wrapper shapes in this repo are: **`bin/mjs-launch.sh`**
(bun-preferred, node fallback for `.mjs` programs — invoked via `.mcp.json`
`command`) and **`bin/bnx.sh`** (cave-context's node-only launcher for its local
`.mjs` programs — context-mode is vendored and run in-process, so there is no
npm-package launch; node only, per cave-context's explicit runtime choice). When
adding a new plugin, copy **`bin/mjs-launch.sh`** verbatim (the reusable
bun-preferred template) rather than reimplementing runtime selection from scratch.
**Do not copy `bin/bnx.sh`** — it is cave-context-specific (node-only) and not a
general template.
