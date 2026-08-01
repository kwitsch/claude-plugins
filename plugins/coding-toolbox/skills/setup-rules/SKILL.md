---
name: setup-rules
description: Install, refresh, or remove coding-toolbox's user-level rules — a copy of the golden-rules content and a tool-routing table for rtk/bun/ripgrep/codebase-memory — as always-on ~/.claude/rules/coding-toolbox-*.md files, applying to every project on this machine. Accepts a verbatim argument (e.g. "update tools rule") to apply directly, skipping the interactive prompts.
argument-hint: "[install|update|remove] [rules|tools|both]"
disable-model-invocation: true
allowed-tools: ["AskUserQuestion", "Read", "Write", "Bash(mkdir:*)", "Bash(cp:*)", "Bash(rm:*)", "Bash(cat:*)", "Bash(bash:*)", "Bash(mktemp:*)"]
---

# Set up coding-toolbox user-level rules

Installs, refreshes, or removes two always-on (no `paths:` key — such rule
files load unconditionally) user-level rule files, applying to every project
you open on this machine:

- `~/.claude/rules/coding-toolbox-rules.md` — a byte-exact copy of this
  skill's own `references/golden-rules.md` content.
- `~/.claude/rules/coding-toolbox-tools.md` — a tool-routing table naming
  whichever of `rtk`/`bun`/`rg`/`codebase-memory-mcp` are on this machine's
  `PATH`.

Note: the coding-toolbox plugin does not inject these rules automatically —
this skill is the only way to get them onto this machine.

> **Ask the user via `AskUserQuestion`.** Present the Step 3 question(s)
> through the `AskUserQuestion` tool — never plain prose waiting for a typed
> reply.

## Step 1 — Detect

<!-- coderabbit-skip: `ls`/`command -v` here run inside a dynamic-context `!` block — load-time preprocessing executed before Claude sees the content, not a Claude tool call, so `allowed-tools` has no bearing on it (cc-reference claude-code-skills-reference.md, "Dynamic context injection": "runs the shell command BEFORE Claude sees content ... preprocessing, not a Claude action"). Only the runtime Bash calls in Step 4 are model-issued tool calls, and those are covered. -->

```!
echo "Installed: $(ls $HOME/.claude/rules/coding-toolbox-*.md 2>/dev/null || echo '(none)')"
echo "Stale project-level: $(ls .claude/rules/coding-toolbox-*.md 2>/dev/null || echo '(none)')"
echo "rtk: $(command -v rtk >/dev/null 2>&1 && echo present || echo absent)"
echo "bun: $(command -v bun >/dev/null 2>&1 && echo present || echo absent)"
echo "ripgrep: $(command -v rg >/dev/null 2>&1 && echo present || echo absent)"
echo "codebase-memory: $(command -v codebase-memory-mcp >/dev/null 2>&1 && echo present || echo absent)"
echo "Plugin root: $CLAUDE_PLUGIN_ROOT"
```

If the block above rendered as literally `[shell command execution disabled by policy]`, stop and tell the user: shell execution is disabled for skills (`disableSkillShellExecution`) — setup-rules can't detect or install safely. Do not guess install state; end here.

## Step 2 — Derive state

- `rules_installed` = the `Installed:` line contains `coding-toolbox-rules.md`
- `tools_installed` = the `Installed:` line contains `coding-toolbox-tools.md`
- `stale_project_level` = the `Stale project-level:` line is not `(none)` —
  a leftover from before rules moved to the user level; this skill never
  reads, writes, or removes these project-level files, only flags them in
  Step 5 if present
- `detected` = the subset of `rtk`, `bun`, `ripgrep`, `codebase-memory`
  marked `present` above

## Step 3 — Resolve answers

`$ARGUMENTS` non-empty → **Step 3a** (verbatim, skips asking). Empty → **Step 3b**
(today's interactive `AskUserQuestion` flow, unchanged).

### Step 3a — Parse verbatim arguments

1. Read `parse-args.reference.md` for the exact parameter/exit-code
   contract.
2. Write `$ARGUMENTS`'s literal text to a fresh temp file, then run the
   script against that file's path — never embed the text directly into a
   Bash tool call, whether as a bare argument or inside a heredoc.
   `$ARGUMENTS` is a pre-injection text substitution, so by the time this
   line is read the placeholder has already been replaced with the user's
   literal, possibly-adversarial text; a heredoc's own delimiter can be
   collided with adversarial input (a body line matching the delimiter
   terminates it early, turning the rest of the text into ordinary shell
   input in the same command). Writing the raw bytes to a file sidesteps
   this entirely — no shell ever parses the argument text as syntax, only
   as file content — the same pattern this plugin's `finish-pr` already
   uses for other free-form text (`apply-pr-update.sh`'s title/body files):
   ```bash
   mktemp "${TMPDIR:-/tmp}/setup-rules-args.XXXXXX"
   ```
   Then use the `Write` tool to write `$ARGUMENTS`'s literal text (exact
   bytes, nothing added) to the path `mktemp` just printed, then:
   ```bash
   bash ${CLAUDE_SKILL_DIR}/parse-args.sh <path-from-mktemp>
   ```
3. Exit `0` → take the printed `golden_rules:`/`tools:` values directly
   (each `yes`/`no`/`unset` — `unset` means "leave this answer untouched").
   Skip `AskUserQuestion` entirely — go straight to Step 4 Apply with these
   answers.
   Exit `2`/`3`/`4`/`5` → relay the script's stderr message verbatim
   (already phrased as a complete, non-question statement) and **stop** —
   no file writes, nothing asked.
   Any other exit code (`6`, or an un-enumerated shell-level failure — the
   script missing, a permission error): this is `parse-args.sh` itself
   failing, not a usage rejection of the input — report that plainly
   (never relay it as if it were a parse/usage error) and **stop**.

### Step 3b — Ask (`$ARGUMENTS` empty)

One `AskUserQuestion` call, one single-select (`multiSelect: false`) question
per artifact: current value in the header, the answer sets the new value
directly. A single-select
always forces one explicit answer, so there is no end-state-toggle ambiguity
and no need for a "no changes" escape option or any cross-question
precedence rule.

Question 1 (always asked):

```
question: "Should the golden-rules rule be installed?"
header:   "Golden-rules rule (this machine) [currently: <installed|not installed>]"
multiSelect: false
options:
  - label: "Yes"
    description: "Copy this plugin's golden-rules content to ~/.claude/rules/coding-toolbox-rules.md (always active); overwrites if already present."
  - label: "No"
    description: "Make sure it's not installed — removes it if currently present."
```

Question 2 — include **only if** `tools_installed` is true, or `detected` is
non-empty (otherwise there is nothing meaningful to install and no existing
file to offer removing, so omit this question entirely):

```
question: "Should the tool-routing rule be installed?"
header:   "Tool-routing rule (this machine) [currently: <installed|not installed>]"
multiSelect: false
options:
  - label: "Yes"
    description: "Write/refresh ~/.claude/rules/coding-toolbox-tools.md now from current detection (detected: <comma list of detected, or "none — existing file left untouched if none detected">)."
  - label: "No"
    description: "Make sure it's not installed — removes it if currently present."
```

## Step 4 — Apply

- Question 1 answered "Yes":
  ```bash
  mkdir -p "$HOME/.claude/rules"
  cp "<plugin root resolved in Step 1>/skills/setup-rules/references/golden-rules.md" "$HOME/.claude/rules/coding-toolbox-rules.md"
  ```
- Question 1 answered "No":
  ```bash
  rm -f "$HOME/.claude/rules/coding-toolbox-rules.md"
  ```
- Question 1 `unset` (Step 3a only): no action for the golden-rules file —
  leave it as detected in Step 1.
- Question 2 (if asked) answered "Yes", and `detected` is **non-empty**:
  ```bash
  mkdir -p "$HOME/.claude/rules"
  cat > "$HOME/.claude/rules/coding-toolbox-tools.md" <<'EOF'
  # Tool routing

  Detected on this machine — prefer these over the generic default when available.

  | Task | Prefer | Why |
  |---|---|---|
  <one line per tool in `detected`, from the candidate rows file below, in this order>
  EOF
  ```
  Candidate rows — Read `<plugin root resolved in Step 1>/skills/setup-rules/references/tool-routing-rows.md`
  for the exact rows to include (only those whose tool is in `detected`,
  verbatim, in that file's order) — single source of truth, also read by
  `refresh-tools-rule`, never inlined here.
- Question 2 answered "Yes", but `detected` is **empty**: make **no change**
  in either case below. If `tools_installed` was already true (the only way
  Step 3b reaches this — it skips Question 2 entirely when both are false):
  don't overwrite an existing, populated table with an empty one; note in
  Step 5 that nothing was detected so the existing file was left as-is. If
  `tools_installed` was false (only reachable via Step 3a's untargeted
  install/update, which defaults to `tools: yes` regardless of `detected`):
  don't create a tools-rule file when nothing was actually detected; note
  in Step 5 that nothing was detected so no file was created.
- Question 2 answered "No":
  ```bash
  rm -f "$HOME/.claude/rules/coding-toolbox-tools.md"
  ```
- Question 2 not asked (nothing installed, nothing detected): no action for
  the tools file.
- Question 2 (Step 3a only) `unset`: no action for the tools file — leave it
  as detected in Step 1.

## Step 5 — Report

State plainly which files were created, refreshed, removed, or left alone.
If `stale_project_level` is true, add one line: a project-level rule file
from before the user-level move still exists at `.claude/rules/coding-toolbox-*.md`
and still loads in this project alongside the user-level one — this skill
never touches it automatically; remove it manually if it's no longer wanted.
