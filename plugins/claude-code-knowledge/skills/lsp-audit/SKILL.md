---
name: lsp-audit
description: Audit a project's file extensions against its project-root .lsp.json and add missing LSP server entries. Scans every unique file extension, checks coverage across all servers' extensionToLanguage maps, then with --fix auto-adds entries a bundled server catalog knows, or without --fix presents the proposed additions as an AskUserQuestion multi-select and applies only the ones you pick. Extensions the catalog does not know are reported as manual to-dos, never guessed. Use when the user asks to audit, check, or fix a project's .lsp.json / LSP server coverage.
argument-hint: [--fix] [project path]
allowed-tools: Bash, Read, AskUserQuestion
# review-skip(F1): unscoped Bash is required — the audit script (scripts/audit-lsp.mjs) runs against an arbitrary project root supplied at runtime and writes that project's .lsp.json; allowed-tools only pre-approves, never restricts.
---

# lsp-audit — audit a project's .lsp.json and add missing LSP coverage

Scan every unique file extension in a project, diff that set against the coverage
already declared across all servers in the project-root `.lsp.json`, then either
auto-write the missing entries (`--fix`) or let the user pick which to add
(`AskUserQuestion` multi-select). The "which server serves which extension"
knowledge comes from a small bundled catalog; extensions the catalog does not
know are reported for manual handling, never guessed. **This skill runs inline
(depth 0)** — it interacts via `AskUserQuestion` and drives the writing script;
never run it as `context: fork`.

All scan / diff / merge / safe-write logic lives in the zero-dep
`scripts/audit-lsp.mjs`. This SKILL.md only orchestrates.

> **Ask the user via `AskUserQuestion`.** When this skill needs a decision from
> the user and the answers are a fixed / multiple-choice set, it MUST present the
> question through the `AskUserQuestion` tool — never as plain prose that waits for
> a typed reply. Remote sessions do not reliably surface a plain-text "waiting for
> input" prompt, whereas `AskUserQuestion` raises a notification.

## 1. Parse arguments

`$ARGUMENTS` may contain the bare flag `--fix` (no value) and/or a project path.
Parse and strip `--fix` first; set `$FIX` = present/absent. Whatever non-flag
text remains, trimmed, is the project path; default to `.` (the current working
directory) when empty. Resolve it and call it `$ROOT`.

## 2. Read scripts/audit-lsp.reference.md

Read `scripts/audit-lsp.reference.md` (colocated with the script) for the
script's invocation contract — the three modes, the `<project-root>` positional,
`--fix`, `--apply <exts>`, the output-JSON schemas, and the exit codes. Per its
table.

## 3. Run the audit

    node ${CLAUDE_SKILL_DIR}/scripts/audit-lsp.mjs "$ROOT"

`${CLAUDE_SKILL_DIR}` is a bare pre-injection substitution token — never a live
shell variable and never dynamic-context-injected. The script prints one JSON
object to stdout (the audit schema in the reference) and exits 0. Parse it.

## 4. Short-circuit when there is nothing to do

If the scan found no extensions, or every extension is already covered, or
`proposals` is empty and `unknown` is empty — say so plainly and stop without
touching `.lsp.json`. If `proposals` is empty but `unknown` is non-empty, report
the unknown extensions as manual to-dos and stop.

## 5. --fix path (auto-apply all)

If `$FIX` is set and `proposals` is non-empty, apply every proposal:

    node ${CLAUDE_SKILL_DIR}/scripts/audit-lsp.mjs "$ROOT" --fix

Parse the apply-summary JSON, then go to Report. If the script exits non-zero,
report its printed error and that nothing was written.

## 6. Interactive path (no --fix)

Build `AskUserQuestion` tabs from `proposals`:

- Each proposal is one selectable option, `multiSelect: true`.
- The option label begins with the extension id and names the action, e.g.
  `.py: add pylsp server (needs: pip install python-lsp-server)`,
  `.json: add jsonls server`, or `.jsonc: add to existing jsonls server`. When a
  proposal carries a `note`, fold it into the label.
- At most 4 options per tab, at most 4 tabs per call. Order proposals by
  descending `fileCount` (most-used extensions first). Issue successive calls
  when more than 4 tabs are needed. If a tab would have only one option, add an
  explicit `Skip this group` filler so every tab has at least 2 options.
- Collect the set of selected extensions and apply exactly them (comma-separated,
  no spaces):

      node ${CLAUDE_SKILL_DIR}/scripts/audit-lsp.mjs "$ROOT" --apply ".py,.go,.css"

The extension tokens are catalog-derived (each matches `^\.[A-Za-z0-9]+$`), never
raw user free-text; the script re-validates each token. Parse the apply-summary
JSON, then go to Report. If nothing was selected, report that no entry was added
and stop.

## 7. Report

Summarize:

- how many extensions are already covered;
- which entries were added (from `applied` / `createdServers` / `mergedIntoServers`);
- which proposals were skipped (interactive path — the ones the user did not pick);
- unknown extensions (no catalog server → manual to-do, from `unknown`);
- any extensions the first-registered-wins conflict rule dropped (`conflictsSkipped`);
- every surfaced install `note` (the binary a written server needs, or the
  marketplace LSP plugin the catalog recommends for `.py` / `.rs`).

For the `.lsp.json` field reference, point at
`plugins/claude-code-knowledge/skills/cc-reference/references/claude-code-plugins-lsp-reference.md`
— do not restate the schema here.
