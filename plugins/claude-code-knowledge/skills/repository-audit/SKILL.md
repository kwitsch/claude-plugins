---
name: repository-audit
description: Run a full repository audit of a project's Claude Code memory surface end to end — first flag whether the baseline memory files (a root CLAUDE.md and a .claude/rules/ directory) exist, then run the existing lsp-audit LSP-coverage pass and the memory-audit memory-quality pass in sequence (forwarding the same --fix flag and repo path), and fold all three passes into one combined report with Structure, LSP audit, and Memory audit sections. Reuses lsp-audit and memory-audit verbatim via the Skill tool rather than re-implementing them; the phase-1 structure check is report-only and never writes. Use when the user asks to audit, check, or fix a repository's Claude Code memory structure / run a full repository audit.
argument-hint: [--fix] [optional repo path]
allowed-tools: Bash, Read, Skill, AskUserQuestion
# review-skip(F1): unscoped Bash is required — the structure check runs `test`/`find` against an arbitrary repo root supplied at runtime; allowed-tools only pre-approves, never restricts. No Write/Edit: phase 1 is report-only; the nested lsp-audit/memory-audit own their own writes under their own frontmatter.
---

# repository-audit — full Claude Code memory-surface audit

Give the user one entry point to audit a project's Claude Code memory surface
end to end: first flag whether the baseline memory files exist at the repo root,
then run the existing LSP-coverage audit and memory-quality audit in sequence,
and fold all three passes into one combined report. This skill reuses
`lsp-audit` and `memory-audit` verbatim via the `Skill` tool — it adds only the
structure-presence check and the orchestration/report wrapper. **This skill runs
inline (depth 0)** — it drives two nested inline skills in the same turn (each
may raise its own `AskUserQuestion` gate); never run it as `context: fork`.

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
raises no phase-1 `AskUserQuestion` gate; `$FIX` only propagates forward into the
two nested audits (steps 3–4). No `Write`/`Edit` is used here.

If `$ROOT` does not resolve to an existing directory at all, say so explicitly
and stop before invoking the two nested skills (steps 3–4) — do not hand a bad
path forward. (The two probes above degrade cleanly to `MISSING` on a
nonexistent root; the explicit stop is for the case where `$ROOT` itself is not
a directory.)

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

## 5. Combined report

Emit one final report with exactly three named sections, in this order:

1. **Structure** — the step-2 findings (present/missing `CLAUDE.md` and
   `.claude/rules/`), with the manual-to-do note (pointing at `cc-author`) for
   any missing item.
2. **LSP audit** — carry forward `lsp-audit`'s already-emitted report content
   from step 3.
3. **Memory audit** — carry forward `memory-audit`'s already-emitted report
   content from step 4.

This is a recap/wrapper, not a re-derivation — no structured data crosses the
inline nested-skill boundary, so the aggregation is narrative prose that folds
forward what each nested skill already printed. If a nested skill invocation is
unavailable or fails mid-flow, report in the combined report which phase failed
and continue to the remaining phases where still possible; never silently drop
the failed phase, and never fabricate a report section for a phase that did not
actually run.
