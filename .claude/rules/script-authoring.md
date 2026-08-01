---
paths:
  - "plugins/*/skills/**"
  - "plugins/*/commands/**"
  - "plugins/*/agents/*.md"
  - "plugins/*/bin/**"
---

# Rule: script authoring

Source: <https://code.claude.com/docs/en/skills#inject-dynamic-context>

## 1. Trivial vs substantial

- **Trivial** — a single command, or a short fixed sequence with no control
  flow (e.g. `git branch --show-current`, a handful of `command -v` checks,
  an unconditional `cp`/`rm`): stays inline.
  - **Skills and custom commands** → dynamic context injection: `` !`cmd` ``
    inline (only when `!` is at line start or after whitespace) or a
    ` ```! ` fenced block for multi-line. Runs once at load time as
    preprocessing; its stdout is spliced into the skill/command context
    before the model reads it. Keep output terse and parseable.
  - **Agents** → a short fenced `bash` block the agent runs via the Bash
    tool. Agents are not skills; `!` preprocessing does not apply to them.
  - **Degrade gracefully:** when `disableSkillShellExecution` is set, each
    `!` block is replaced with `[shell command execution disabled by
policy]` (the skill/command still loads). Handle that placeholder
    defensively — never assume the command ran. Bundled and managed skills
    are not affected by the setting.
- **Substantial** — functions, loops, conditionals, multi-step parsing:
  "a program," not "a command." Extract to a standalone file — see section 2
  (skills/commands) or section 3 (agents). Never embed real logic inline.

## 2. Substantial scripts in skills/commands → standalone file + reference doc

- **One script** in the skill/command → `<skill-dir>/<script-name>.<ext>`
  (extension matches the language already used: `.sh` bash, `.mjs` Node,
  etc.), at the skill/command's own root, alongside `SKILL.md`.
- **More than one script** → `<skill-dir>/scripts/<script-name>.<ext>` for
  all of them.
- Every such script gets a **colocated** `<script-name>.reference.md` —
  same directory as the script. This is a separate convention from the
  general `references/` subfolder (which holds conceptual/behavioral skill
  docs, governed by its own 1-file-at-root/2+-in-`references/` rule) — a
  script's reference is part of that script, not general skill knowledge,
  and never counts against that folder's file count. Template:

  ```markdown
  # <script-name> — script reference

  **Invoke:** `<interpreter> ${CLAUDE_SKILL_DIR}/[scripts/]<script-name>.<ext> <positional args>`

  ## Parameters

  | #   | Name | Format | Required | Notes |
  | --- | ---- | ------ | -------- | ----- |
  | 1   | ...  | ...    | yes/no   | ...   |

  ## Environment

  | Var | Purpose | Required |
  | --- | ------- | -------- |
  | ... | ...     | ...      |

  ## Exit codes

  | Code | Meaning | Notes |
  | ---- | ------- | ----- |
  | 0    | ok      | ...   |
  ```

  This is the **canonical** copy of the parameter/exit-code contract —
  `SKILL.md` keeps only a short pointer ("per `<script-name>.reference.md`'s
  table"), never a duplicate table. Behavior description (what the skill
  does, decision guidance per exit code) stays in `SKILL.md` — that's
  user/model-facing "what to do," not invocation "how," and doesn't move.

- The skill's own Steps section: "Read `<script-name>.reference.md`" as its
  own numbered step, placed **immediately before** the step that invokes
  the script — never earlier in the file, never assumed already cached
  from an earlier read.
- **Invocation mechanism:** write the literal `${CLAUDE_SKILL_DIR}` token in
  the invoking step's fenced command, e.g.:

  ```bash
  bash ${CLAUDE_SKILL_DIR}/<script-name>.sh <args>
  ```

  `${CLAUDE_SKILL_DIR}` is a **pre-injection text substitution** applied to
  the skill's own body before the model reads it — not a live shell
  environment variable (`$CLAUDE_PLUGIN_ROOT`/`$CLAUDE_SKILL_DIR` are
  confirmed empty inside an actual Bash-tool subprocess). Proven shipped in
  this repo: `plugins/claude-code-knowledge/skills/cc-compress/SKILL.md` —
  `node ${CLAUDE_SKILL_DIR}/scripts/compress.mjs "<absolute-filepath>" "<backup-root>"`.
  Do not use `!`-injected `$CLAUDE_PLUGIN_ROOT`/`$CLAUDE_SKILL_DIR` for this
  — that idiom has been observed rendering empty in this repo.

- **Exception — load-time `!`-injection blocks:** the mechanism above is
  proven only for Bash-tool-invoked scripts (the model reads the
  already-substituted path and issues the call itself). A script an
  `!`-block would need to invoke is a different substitution context (shell
  preprocessing runs before the model ever sees the content), with no
  shipped precedent in this repo proving `${CLAUDE_SKILL_DIR}` resolves
  there too. Do not extract a substantial `!`-block into a standalone file
  until that combination is verified working in a live session — leave it
  inline and name it as a follow-up instead.
- No `chmod +x` — invoked by explicit interpreter command, never exec'd by
  name or placed on `PATH`. This sidesteps the known `core.fileMode`
  exec-bit trap (a new file's execute bit silently uncommitted when
  `core.fileMode=false`) entirely — the one substantive difference from the
  `bin/` convention below (which requires chmod +x because those files ARE
  exec'd directly / by hook `command` fields).

## 3. Substantial scripts in agents → `bin/`

Agents are not skills — neither `${CLAUDE_SKILL_DIR}` nor `!`-injection
applies to them. A fenced bash block with real logic (loops, conditionals,
multi-step) an agent runs via the Bash tool gets extracted to the plugin's
`bin/` (chmod +x, same convention as any other `bin/` executable — see
section 5) instead of staying embedded. A short fixed command sequence
stays inline as an ordinary fenced `bash` block, unchanged.

## 4. Inject before query

When a downstream agent or script needs a fact (tool/CLI availability,
persisted state, config), compute it **once** via skill `!` injection and
pass it down in the agent prompt — do not have the callee re-query it.
Detection stays in one place (the orchestrating skill, which has the
richest context); no probe-and-soft-fail agents.

## 5. Keep a standalone `bin/` executable only when justified

Keep a `.sh`/binary under `plugins/*/bin/` ONLY when it must be:

- exec'd by name / placed on `PATH` (e.g. a PATH facade like
  `bin/git-shim/git`),
- invoked via a `.mcp.json` or hook `command` field,
- shared verbatim by multiple callers, or
- a substantial agent-fenced-bash script per section 3 above.

Such files keep their executable bit (see the bin-executable rule) **and**
get a bats test when their behavior is non-trivial (exit-code contract,
edge cases) — same bar as section 2's skill-local scripts, just a different
directory/invocation shape (exec'd by name here, never chmod'd there).

The canonical shape in this repo for a `bin/` MCP/hook entry point is an
**executable `.mjs` invoked directly** (`#!/usr/bin/env node` + `100755`) —
node-only, no wrapper. A plugin that genuinely needs bun-preferred runtime
selection MAY instead keep a `bin/mjs-launch.sh` wrapper (bun-preferred,
node fallback) as an **optional fallback**, but it is no longer the default
and carries known edge-case issues (empty PATH segment, lingering signal
forwarder); prefer the direct-`.mjs` form. See the **hooks-mcp-server**
rule.

## 6. Self-test = unit test — trivial scripts only

Running a **trivial, inline** script during development and confirming its
output **is** its unit test — no separate `.bats` test needed (see the
test-conventions rule). This exemption does **not** apply to any script
extracted per sections 2 or 3 above — those get real bats coverage like any
other standalone executable.
