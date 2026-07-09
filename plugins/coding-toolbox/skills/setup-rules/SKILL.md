---
name: setup-rules
description: Install, refresh, or remove coding-toolbox's project-level rules — a copy of the golden-rules content and a tool-routing table for rtk/bun/ripgrep/codebase-memory — as always-on .claude/rules/coding-toolbox-*.md files in the current project.
argument-hint: ""
disable-model-invocation: true
allowed-tools: ["AskUserQuestion", "Bash(mkdir:*)", "Bash(cp:*)", "Bash(rm:*)", "Bash(cat:*)"]
---

# Set up coding-toolbox project rules

Installs, refreshes, or removes two always-on (no `paths:` key — such rule
files load unconditionally) project rule files:

- `.claude/rules/coding-toolbox-rules.md` — a byte-exact copy of this
  plugin's own `hooks/SessionStart.md` golden-rules content.
- `.claude/rules/coding-toolbox-tools.md` — a tool-routing table naming
  whichever of `rtk`/`bun`/`rg`/`codebase-memory-mcp` are on this machine's
  `PATH`.

> **Ask the user via `AskUserQuestion`.** Present the Step 4 question through
> the `AskUserQuestion` tool — never plain prose waiting for a typed reply.

## Step 1 — Detect

```
Installed: !`ls .claude/rules/coding-toolbox-*.md 2>/dev/null || echo "(none)"`
rtk: !`command -v rtk >/dev/null 2>&1 && echo present || echo absent`
bun: !`command -v bun >/dev/null 2>&1 && echo present || echo absent`
ripgrep: !`command -v rg >/dev/null 2>&1 && echo present || echo absent`
codebase-memory: !`command -v codebase-memory-mcp >/dev/null 2>&1 && echo present || echo absent`
Plugin root: !`echo "$CLAUDE_PLUGIN_ROOT"`
```

If any line above is literally `[shell command execution disabled by
policy]`, stop and tell the user: "Shell execution is disabled for skills
(`disableSkillShellExecution`) — setup-rules can't detect or install
safely." Do not guess install state; end here.

## Step 2 — Derive state

- `rules_installed` = the `Installed:` line contains `coding-toolbox-rules.md`
- `tools_installed` = the `Installed:` line contains `coding-toolbox-tools.md`
- `detected` = the subset of `rtk`, `bun`, `ripgrep`, `codebase-memory`
  marked `present` above

## Step 3 — Report detected state

Print one plain status line (not a question), e.g.:

```
Detected: golden-rules rule <installed|not installed>; tool-routing rule
<installed|not installed>. Tools on this machine: <comma-separated list, or "none">.
```

## Step 4 — Ask

Build the multiSelect from only the rows whose condition holds, in this
fixed order, always ending with the last row:

```
AskUserQuestion:
  question: "Which coding-toolbox project rules should be installed/removed?"
  header:   "Setup rules"
  multiSelect: true
  options:
    - [if !rules_installed] label: "Install golden-rules project rule"
      description: "Copies this plugin's golden-rules content to .claude/rules/coding-toolbox-rules.md (always active)."
    - [if rules_installed] label: "Remove golden-rules project rule (currently installed)"
      description: "Deletes .claude/rules/coding-toolbox-rules.md."
    - [if !tools_installed and detected is non-empty] label: "Install tool-routing rule (detected: <comma list of detected>)"
      description: "Writes .claude/rules/coding-toolbox-tools.md with a routing row per detected tool."
    - [if tools_installed] label: "Refresh tool-routing rule (re-detect rtk/bun/rg/codebase-memory)"
      description: "Rewrites .claude/rules/coding-toolbox-tools.md from the current detection above."
    - [if tools_installed] label: "Remove tool-routing rule (currently installed)"
      description: "Deletes .claude/rules/coding-toolbox-tools.md."
    - label: "No changes — leave everything as is"
      description: "Make no changes, regardless of what else is selected."
```

The final "No changes" row is always present, so the question always has at
least 2 options (the golden-rules row alone contributes exactly one of its
two variants unconditionally).

## Step 5 — Apply

Precedence: if "No changes" is among the selections (alone or with others),
do nothing and go to Step 6 reporting "no changes made".

Otherwise, for each selected option:

- **Install golden-rules project rule:**
  ```bash
  mkdir -p .claude/rules
  cp "<plugin root resolved in Step 1>/hooks/SessionStart.md" .claude/rules/coding-toolbox-rules.md
  ```
- **Remove golden-rules project rule:**
  ```bash
  rm -f .claude/rules/coding-toolbox-rules.md
  ```
- **Install/Refresh tool-routing rule** (skip this if "Remove tool-routing
  rule" is also selected — remove wins):
  ```bash
  mkdir -p .claude/rules
  cat > .claude/rules/coding-toolbox-tools.md <<'EOF'
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
- **Remove tool-routing rule:**
  ```bash
  rm -f .claude/rules/coding-toolbox-tools.md
  ```

## Step 6 — Report

State plainly which files were created, refreshed, removed, or left alone.
