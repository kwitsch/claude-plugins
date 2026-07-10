---
name: setup-rules
description: Install, refresh, or remove coding-toolbox's user-level rules — a copy of the golden-rules content and a tool-routing table for rtk/bun/ripgrep/codebase-memory — as always-on ~/.claude/rules/coding-toolbox-*.md files, applying to every project on this machine. Accepts a verbatim argument (e.g. "update tools rule") to apply directly, skipping the interactive prompts.
argument-hint: "[install|update|remove] [rules|tools|both]"
allowed-tools: ["AskUserQuestion", "Bash(mkdir:*)", "Bash(cp:*)", "Bash(rm:*)", "Bash(cat:*)"]
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
- `detected` = the subset of `rtk`, `bun`, `ripgrep`, `codebase-memory`
  marked `present` above

## Step 3 — Resolve answers

`$ARGUMENTS` non-empty → **Step 3a** (verbatim, skips asking). Empty → **Step 3b**
(today's interactive `AskUserQuestion` flow, unchanged).

### Step 3a — Parse verbatim arguments

Lowercase `$ARGUMENTS`, then resolve in order:

1. **Ambiguity check.** Contains a token from *both* groups below → go to
   the usage-error branch (item 4) without applying anything.
2. **Verb.** Contains any of `remove`, `uninstall`, `delete`, `disable`, `no`
   → `answer = No`. Else contains any of `install`, `add`, `enable`,
   `update`, `refresh`, `yes` → `answer = Yes`. Else → usage-error branch.
3. **Target.** Contains `tool` (covers `tool`, `tools`, `tool-routing`,
   `routing`) → `target = tools` only. Else contains `golden` or `rule`
   (covers `rule`, `rules`, `golden-rules`; only reached when no `tool`
   substring matched, so "tools rule" resolves to `tools` alone) →
   `target = rules` only. Else (contains `both`/`all`/`everything`, or no
   target keyword at all — e.g. bare `update`) → `target = both`.
4. **Usage-error branch.** State plainly (not a question — no trailing `?`):
   `Couldn't parse "<$ARGUMENTS>" — expected a verb (install/update/remove)
   and optionally a target (rules/tools/both). Examples: "install",
   "update tools rule", "remove rules rule", "remove both".` Then stop —
   no file writes, nothing asked.
5. Set the Question 1 (golden-rules) answer to `answer` when `target` is
   `rules` or `both`; leave it untouched otherwise. Set the Question 2
   (tools) answer to `answer` when `target` is `tools` or `both`; leave it
   untouched otherwise. Skip `AskUserQuestion` entirely — go straight to
   Step 4 Apply with these answers.

### Step 3b — Ask (`$ARGUMENTS` empty)

One `AskUserQuestion` call, one single-select (`multiSelect: false`) question
per artifact — mirroring `configure-branch-management`'s pattern: current
value in the header, the answer sets the new value directly. A single-select
always forces one explicit answer, so there is no end-state-toggle ambiguity
and no need for a "no changes" escape option or any cross-question
precedence rule.

Question 1 (always asked):
```
question: "Should the golden-rules rule be installed? Applies to every project on this machine."
header:   "Golden-rules rule (this machine) [currently: <installed|not installed>]"
multiSelect: false
options:
  - label: "Yes"
    description: "Copy this plugin's golden-rules content to ~/.claude/rules/coding-toolbox-rules.md (always active, every project on this machine); overwrites if already present."
  - label: "No"
    description: "Make sure it's not installed — removes it if currently present."
```

Question 2 — include **only if** `tools_installed` is true, or `detected` is
non-empty (otherwise there is nothing meaningful to install and no existing
file to offer removing, so omit this question entirely):
```
question: "Should the tool-routing rule be installed? Applies to every project on this machine."
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
- Question 2 (if asked) answered "Yes", and `detected` is **non-empty**:
  ```bash
  mkdir -p "$HOME/.claude/rules"
  cat > "$HOME/.claude/rules/coding-toolbox-tools.md" <<'EOF'
  # Tool routing

  Detected on this machine — prefer these over the generic default when available.

  | Task | Prefer | Why |
  |---|---|---|
  <one line per tool in `detected`, from the candidate rows below, in this order>
  EOF
  ```
  Candidate rows — include only the ones whose tool is in `detected`, each
  as one line of the same heredoc before its closing `EOF`, verbatim, in
  this order:
  | Tool | Row |
  |---|---|
  | rtk | `| Shell commands (git, gh, npm, …) | \`rtk <cmd>\` | routes through the Rust Token Killer proxy — token savings on dev-op output |` |
  | bun | `| JS/TS runtime & package management | \`bun\` | faster install/run than node/npm |` |
  | ripgrep | `| Text search | \`rg\` (ripgrep) | faster, respects .gitignore |` |
  | codebase-memory | `| Code structure exploration (callers, call chains, architecture) | \`codebase-memory-mcp\` tools | graph-backed, avoids grepping the whole tree |` |
- Question 2 answered "Yes", but `detected` is **empty** (only reachable when
  `tools_installed` was already true — Question 2 is otherwise skipped when
  both are false): make **no change**. Do not overwrite an existing,
  populated table with an empty one just because nothing is detected in this
  run; note in Step 5 that nothing was detected so the existing file was
  left as-is.
- Question 2 answered "No":
  ```bash
  rm -f "$HOME/.claude/rules/coding-toolbox-tools.md"
  ```
- Question 2 not asked (nothing installed, nothing detected): no action for the tools file.

## Step 5 — Report

State plainly which files were created, refreshed, removed, or left alone.
