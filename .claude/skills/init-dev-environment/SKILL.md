---
name: init-dev-environment
description: Install the development tools this repository uses (node pnpm dprint) at user level — never root or sudo, preferring ~/.local/bin — checking each tool first and installing only the missing ones. git, bash, curl and Claude Code are assumed present and never checked. Use when setting up a fresh development environment for this repository, or when one of these tools is reported missing.
---

# init-dev-environment — install this repository's development tools

The `repository-audit` skill of the cc-knowledge plugin generated this
skill from the tools it detected in this repository (node pnpm); `dprint` and its step-4 check were added by hand and are lost on regeneration. To regenerate
it after the repository's tools change, delete this directory and run
repository-audit again. Everything installs at user level — never as root,
never via `sudo`, never by editing a shell startup file — into, or symlinked
into, `~/.local/bin`. A tool that is already usable is never reinstalled.

> **Ask the user via `AskUserQuestion`.** When this skill needs a decision from
> the user and the answers are a fixed / multiple-choice set, it MUST present the
> question through the `AskUserQuestion` tool — never as plain prose that waits for
> a typed reply. Remote sessions do not reliably surface a plain-text "waiting for
> input" prompt, whereas `AskUserQuestion` raises a notification.

## 1. Plan

Run with the Bash tool:

    bash ${CLAUDE_SKILL_DIR}/install.sh --dry-run node pnpm dprint

`${CLAUDE_SKILL_DIR}` is a bare pre-injection substitution token — never a live
shell variable. Each output line is `present: <id>`, `missing: <id>` or
`FAILED: <id> (unknown tool id)`. If no line is `missing:`, report that the
development environment is complete and stop.

## 2. Confirm

Ask one `AskUserQuestion`, single-select, header `Install`. The question names
the missing tool ids and notes that a missing prerequisite runtime is installed
along with a tool that needs it (`go` for `gopls`, `uv` for `pylsp`/`python`/`python3`,
`node` for `pnpm`/`yarn`, `cargo` for `rust-analyzer`). Options:

- `Install` — "Install the missing tools now at user level."
- `Cancel` — "Install nothing."

On `Cancel`, report the step-1 plan and stop without installing.

## 3. Install

Run with the Bash tool, passing a raised `timeout` (600000 ms) or
`run_in_background` — the toolchain downloads can exceed the default two-minute
limit and a killed installer stops mid-chain:

    bash ${CLAUDE_SKILL_DIR}/install.sh node pnpm dprint

If it still times out, rerun the same command: tools that are already usable
are skipped.

## 4. Verify dprint

Unless `dprint` reported `FAILED:`, run with the Bash tool from the repository
root (`${CLAUDE_SKILL_DIR}/../../..`):

    dprint --version && dprint check

A non-zero `dprint --version` means the binary is not usable (or not on PATH —
see the `note:` line). `dprint check` failing with formatting diffs is not an
install failure: report the unformatted files and leave fixing them to the user
(`dprint fmt`).

## 5. Report

Report every output line (`present:`, `installed:`, `FAILED:`) and the step-4 dprint version and check result, quoting the
installer's error output for each failed tool. Exit code 1 means at least one
tool failed. If a `note:` line lists tools that are not on PATH (found only via
`~/.local/bin`, `~/.cargo/bin` or `~/.bun/bin`), tell the user to add those
directories to their shell profile — never edit shell startup files. This note
also appears when a tool is already installed but off the user's PATH, so the
Plan step's `present:` lines alone do not prove the shell can find it.

Not installed by this skill (install manually): none
