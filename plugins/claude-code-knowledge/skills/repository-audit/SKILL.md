---
name: repository-audit
description: Run a full repository audit of a project's Claude Code setup end to end — first flag whether the baseline memory files (a root CLAUDE.md and a .claude/rules/ directory) exist, then run the existing lsp-audit LSP-coverage pass and the memory-audit memory-quality pass in sequence (forwarding the same --fix flag and repo path), then detect the development tools the repository uses (runtimes, package managers, LSP servers — git, bash, curl and Claude Code are assumed present) and offer to create a project-level init-dev-environment skill that installs them at user level into ~/.local/bin (--fix creates it without asking), and fold all four passes into one combined report with Structure, LSP audit, Memory audit, and Dev environment sections. Reuses lsp-audit and memory-audit verbatim via the Skill tool rather than re-implementing them; the phase-1 structure check is report-only and never writes. Use when the user asks to audit, check, or fix a repository's Claude Code memory structure or dev-environment setup, or to run a full repository audit.
argument-hint: [--fix] [optional repo path]
allowed-tools: Bash, Read, Skill, AskUserQuestion
# review-skip(F1): unscoped Bash is required — the structure check runs test against an arbitrary repo root supplied at runtime, and scripts/detect-tools.mjs scans that root and, on confirmation, writes its .claude/skills/init-dev-environment/; allowed-tools only pre-approves, never restricts. No Write/Edit: the only file creation this skill performs itself goes through scripts/detect-tools.mjs; the nested lsp-audit/memory-audit own their own writes under their own frontmatter.
---

# repository-audit — full Claude Code repository audit

Give the user one entry point to audit a project's Claude Code setup end to end:
first flag whether the baseline memory files exist at the repo root, then run
the existing LSP-coverage audit and memory-quality audit in sequence, then
detect the repository's development tools and offer to generate a
project-level `init-dev-environment` skill that installs them, and fold all
four passes into one combined report. This skill reuses `lsp-audit` and
`memory-audit` verbatim via the `Skill` tool — it adds the structure-presence
check, the tool-detection phase (whose scanning and file writing live in
`scripts/detect-tools.mjs`), and the orchestration/report wrapper. **This skill
runs inline (depth 0)** — it drives two nested inline skills in the same turn
(each may raise its own `AskUserQuestion` gate) and raises its own step-6 gate;
never run it as `context: fork`.

> **Ask the user via `AskUserQuestion`.** When this skill needs a decision from
> the user and the answers are a fixed / multiple-choice set, it MUST present the
> question through the `AskUserQuestion` tool — never as plain prose that waits for
> a typed reply. Remote sessions do not reliably surface a plain-text "waiting for
> input" prompt, whereas `AskUserQuestion` raises a notification.

## 1. Parse arguments & resolve scope

`$ARGUMENTS` may contain the bare flag `--fix` (no value) and/or a repo path.
Parse and strip `--fix` first; set `$FIX` = present/absent. Whatever non-flag
text remains, trimmed, is the path; default to `.` (the current working
directory) when empty. Resolve it and call it `$ROOT`.

## 2. Check repository structure

Run this with the Bash tool, passing the resolved scope as the argument. (Runs
at runtime, not as a load-time dynamic-context injection, because the scope may
be supplied interactively.)

```bash
ROOT="${1:-.}"
[ -f "$ROOT/CLAUDE.md" ] && echo "present: CLAUDE.md" || echo "MISSING: CLAUDE.md (repo root)"
[ -d "$ROOT/.claude/rules" ] && echo "present: .claude/rules/" || echo "MISSING: .claude/rules/ directory"
```

This presence bar (root `CLAUDE.md`; `.claude/rules/` directory) is a policy this
skill declares itself — it is deliberately not drawn from `cc-reference`
(`claude-code-memory-reference.md` documents both as optional; no upstream rule
mandates their existence). A missing item is a finding for the final report:
report it as a manual to-do pointing at this plugin's own `cc-author` skill for
grounded creation — never auto-generate content for it. Phase 1 has no `--fix`
behavior of its own (missing files are never created even when `$FIX` is set) and
raises no phase-1 `AskUserQuestion` gate; `$FIX` propagates forward into the
two nested audits (steps 3–4) and also confirms the step-6 init-dev-environment
creation gate. No `Write`/`Edit` is used here.

If `$ROOT` does not resolve to an existing directory at all, say so explicitly
and stop before steps 3–6 (the two nested skills and the tool-detection phase)
— do not hand a bad path forward. (The two probes above degrade cleanly to
`MISSING` on a nonexistent root; the explicit stop is for the case where `$ROOT`
itself is not a directory.)

## 3. Run lsp-audit via the Skill tool

Invoke skill `claude-code-knowledge:lsp-audit` with `args` set to the
re-serialized resolved invocation: `--fix $ROOT` when `$FIX` is set, else
`$ROOT`. It runs inline in the same turn, plays out its own steps (including its
own `AskUserQuestion` gate when `$FIX` is absent), and emits its own report. Do
not attempt to parse a return value from the `Skill` tool call — inline skills
produce none.

## 4. Run memory-audit via the Skill tool

After step 3's inline flow fully resolves, invoke skill
`claude-code-knowledge:memory-audit` the same way, with `args` set to
`--fix $ROOT` when `$FIX` is set, else `$ROOT`. Sequential only — never dispatch
steps 3 and 4 concurrently or interleaved.

## 5. Read scripts/detect-tools.reference.md

Read `scripts/detect-tools.reference.md` (colocated with the script) for the
script's invocation contract — the audit and `--write` modes, the
`<project-root>` positional, the output-JSON schemas, and the exit codes. Per
its table.

## 6. Detect development tools and offer init-dev-environment

Only after step 4's inline flow fully resolves — step 3's lsp-audit may just
have added `.lsp.json` servers such as `pylsp` or `gopls` — run:

    node ${CLAUDE_SKILL_DIR}/scripts/detect-tools.mjs "$ROOT"

`${CLAUDE_SKILL_DIR}` is a bare pre-injection substitution token — never a live
shell variable and never dynamic-context-injected. The script prints one JSON
object to stdout (the audit schema in the reference). Parse it, then:

- **Non-zero exit** — record the printed stderr for the Dev environment section,
  write nothing, and go to step 7.
- **`tools` is empty** — no question, nothing written. Record "no tools beyond
  the assumed-present git, bash, curl, Claude Code" plus every `manual` entry as
  a manual to-do (this covers the manual-only case too — there is nothing the
  generated skill could install).
- **`skillExists` is true** — no question, nothing written. Record "`<skillDir>`
  already exists, left untouched. To regenerate it from the current detection,
  delete that directory and run repository-audit again." Also `Read`
  `<skillDir>/SKILL.md` and compare its `description` tool list with the
  detected `tools` ids — an earlier run's generated `install.sh` or lsp-audit's
  additions can add a tool the existing skill lacks. Name every detected id it
  does not list as missing from the existing skill (still nothing written).
- **Otherwise, gate.** When `$FIX` is set, skip the question entirely and treat
  it as confirmed. Otherwise ask one `AskUserQuestion` — single-select, header
  `Dev env`, question "Create a project-level init-dev-environment skill that
  installs <comma-separated tool ids> at user level (~/.local/bin)?", options:
  - `Create init-dev-environment skill` — "Writes
    .claude/skills/init-dev-environment/ (SKILL.md + install.sh). Installs
    nothing now."
  - `Skip` — "Write nothing." (record: skipped by the user)

If confirmed, run the write and parse its JSON:

    node ${CLAUDE_SKILL_DIR}/scripts/detect-tools.mjs "$ROOT" --write

- **`wrote: true`** — record the created path and the next step: review and
  commit the directory, then run `/init-dev-environment` to install. When
  `skillsDirCreated` is true, add that Claude Code must be restarted first — a
  newly created top-level `.claude/skills/` directory is only picked up at
  session start.
- **`wrote: false`** (the tree changed between the two calls) — record the
  outcome the fields show (`skillExists` true, or `tools` empty), exactly as
  above.
- **Non-zero exit** — record the error, and that nothing was written.

Never run the generated `install.sh` from this skill.

## 7. Combined report

Emit one final report with exactly four named sections, in this order:

1. **Structure** — the step-2 findings (present/missing `CLAUDE.md` and
   `.claude/rules/`), with the manual-to-do note (pointing at `cc-author`) for
   any missing item.
2. **LSP audit** — carry forward `lsp-audit`'s already-emitted report content
   from step 3.
3. **Memory audit** — carry forward `memory-audit`'s already-emitted report
   content from step 4.
4. **Dev environment** — the step-6 findings and outcome: each detected tool id
   with its `evidence`; every `manual` entry as a manual to-do; and the outcome
   — created (with the path and next steps, including the restart note when
   `skillsDirCreated` is true), skipped by the user, already exists (left
   untouched, naming any detected tool it lacks), nothing installable detected, or failed (with the error).

This is a recap/wrapper, not a re-derivation — no structured data crosses the
inline nested-skill boundary, so the LSP audit and Memory audit sections are
narrative prose that folds forward what each nested skill already printed; the
Dev environment section comes from step 6's parsed script output. If a nested
skill invocation or the step-6 script is unavailable or fails mid-flow, report
in the combined report which phase failed and continue to the remaining phases
where still possible; never silently drop the failed phase, and never fabricate
a report section for a phase that did not actually run.
