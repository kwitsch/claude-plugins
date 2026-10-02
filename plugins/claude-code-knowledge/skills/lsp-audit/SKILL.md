---
name: lsp-audit
description: Audit a project's file extensions against the .lsp.json of its project-scope lsp plugin (.claude/skills/lsp/, created on first write) and add missing LSP server entries. A legacy project-root .lsp.json, which Claude Code no longer loads, is migrated into that plugin as its starting config and then deleted. Scans every unique file extension, checks coverage across all servers' extensionToLanguage maps, then with --fix auto-migrates and auto-adds the entries a bundled server catalog knows. Without --fix, it confirms the migration and presents the proposed additions as an AskUserQuestion multi-select, applying only the ones you pick. Extensions the catalog does not know are reported as manual to-dos, never guessed. Use when the user asks to audit, check, or fix a project's .lsp.json / LSP server coverage, or to move a project-root .lsp.json into a plugin.
argument-hint: [--fix] [project path]
allowed-tools: Bash, Read, AskUserQuestion
# review-skip(F1): unscoped Bash is required — the audit script (scripts/audit-lsp.mjs) runs against an arbitrary project root supplied at runtime, writes that project's .claude/skills/lsp/ plugin files, and deletes a migrated legacy project-root .lsp.json; allowed-tools only pre-approves, never restricts.
---

# lsp-audit — audit a project's lsp plugin and add missing LSP coverage

Scan every unique file extension in a project, diff that set against the coverage
already declared across all servers in `<project>/.claude/skills/lsp/.lsp.json` —
the config of a project-scope skills-directory plugin named `lsp`, which the
script creates on its first write. Any legacy project-root `.lsp.json` is included
in that diff too: Claude Code no longer loads that root file, so every write
migrates it into the plugin and deletes it. Then either auto-write the missing
entries (`--fix`) or let the user pick which to add (`AskUserQuestion`
multi-select). The "which server serves which extension" knowledge comes from a
small bundled catalog; extensions the catalog does not know are reported for
manual handling, never guessed. **This skill runs inline (depth 0)** — it
interacts via `AskUserQuestion` and drives the writing script; never run it as
`context: fork`.

All scan / diff / merge / safe-write / migrate logic lives in the zero-dep
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
object to stdout (the audit schema in the reference) and exits 0. Parse it. If
the script exits non-zero, report its stderr error, say that nothing was written
or deleted, and stop.

## 4. Short-circuit when there is nothing to do

When `legacyRootLspJson` is true, never short-circuit — a root `.lsp.json` is
waiting to be migrated; continue to step 5 or step 6.

When `legacyRootLspJson` is false: if the scan found no extensions, or every
extension is already covered, or `proposals` is empty and `unknown` is empty —
say so plainly and stop without writing anything. If `proposals` is empty but
`unknown` is non-empty, report the unknown extensions as manual to-dos and stop.

## 5. --fix path (auto-apply all)

Run when `$FIX` is set and step 4 did not stop. It applies every proposal and,
when `legacyRootLspJson` is true, migrates the root `.lsp.json` into the plugin
and deletes it with no confirmation, because `--fix` is the consent:

    node ${CLAUDE_SKILL_DIR}/scripts/audit-lsp.mjs "$ROOT" --fix

Parse the apply-summary JSON, then go to Report. If the script exits non-zero,
report its printed error and that nothing was written or deleted.

## 6. Interactive path (no --fix)

1. If `legacyRootLspJson` is true, first ask one `AskUserQuestion` single-select
   (`multiSelect: false`):
   - Question: `Claude Code no longer loads the project-root .lsp.json. Migrate it into .claude/skills/lsp/ and delete the root file?`
   - Options: `Migrate and delete the root file` and `Leave it untouched (no changes)`.
   - On `Leave it untouched (no changes)`, report the audit result, note that the
     root file stays unloaded by Claude Code, and stop — no write-mode call.
2. If `proposals` is non-empty, build `AskUserQuestion` tabs from `proposals`:
   - Each proposal is one selectable option, `multiSelect: true`.
   - The option label begins with the extension id and names the action, e.g.
     `.py: add pylsp server (needs: pip install python-lsp-server)`,
     `.json: add jsonls server`, or `.jsonc: add to existing jsonls server`. When a
     proposal carries a `note`, fold it into the label.
   - At most 4 options per tab, at most 4 tabs per call. Order proposals by
     descending `fileCount` (most-used extensions first). Issue successive calls
     when more than 4 tabs are needed. If a tab would have only one option, add an
     explicit `Skip this group` filler so every tab has at least 2 options.
3. Apply exactly the selected extensions (comma-separated, no spaces). When the
   migration was accepted but nothing was picked, pass the empty list, which
   migrates the root file and adds nothing:

       node ${CLAUDE_SKILL_DIR}/scripts/audit-lsp.mjs "$ROOT" --apply ".py,.go,.css"
       node ${CLAUDE_SKILL_DIR}/scripts/audit-lsp.mjs "$ROOT" --apply ""

   The extension tokens are catalog-derived (each matches `^\.[A-Za-z0-9]+$`),
   never raw user free-text; the script re-validates each token. Parse the
   apply-summary JSON, then go to Report. If the script exits non-zero, report its
   printed error and that nothing was written or deleted.

4. If nothing was picked and no migration is pending, report that no entry was
   added and stop.

## 7. Report

Summarize:

- how many extensions are already covered;
- which entries were added (from `applied` / `createdServers` / `mergedIntoServers`);
- which proposals were skipped (interactive path — the ones the user did not pick);
- unknown extensions (no catalog server → manual to-do, from `unknown`);
- any extensions the first-registered-wins conflict rule dropped (`conflictsSkipped`);
- every surfaced install `note` (the binary a written server needs, or the
  marketplace LSP plugin the catalog recommends for `.py` / `.rs`);
- whether the legacy root `.lsp.json` was migrated and deleted (`migratedFromRoot`);
- when `wrote` is true:
  - the config now lives in `<ROOT>/.claude/skills/lsp/` and loads as
    `lsp@skills-dir` only in a session whose primary working directory is
    `<ROOT>`, after the workspace trust dialog;
  - restart Claude Code (a new plugin loads next session) or run
    `/reload-plugins` after a change;
  - commit `.claude/skills/lsp/` so worktrees and teammates get it.

For the `.lsp.json` field reference, point at
`plugins/claude-code-knowledge/skills/cc-reference/references/claude-code-plugins-lsp-reference.md`
— do not restate the schema here.
