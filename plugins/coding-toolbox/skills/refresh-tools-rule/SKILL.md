---
name: refresh-tools-rule
description: Refresh coding-toolbox's user-level tool-routing rule (~/.claude/rules/coding-toolbox-tools.md) from currently-detected rtk/bun/ripgrep/codebase-memory-mcp, but ONLY if that file already exists. Never installs it. Model-invocable — safe for another skill (e.g. memory-enhancement's dream) to call autonomously, since it can only ever refresh an existing file's content, never create or remove one.
allowed-tools: ["Bash(cat:*)"]
---

# Refresh coding-toolbox's tool-routing rule

Non-destructive, idempotent companion to `setup-rules` (which stays user-only):
this skill only ever rewrites an **already-installed**
`~/.claude/rules/coding-toolbox-tools.md` with fresh tool detection. It never
creates the file and never removes it, and never touches the golden-rules
file — that's the narrow, provably-safe surface that makes it acceptable for
this skill (unlike `setup-rules`' full install/remove wizard) to be
model-invocable. See `coding-toolbox/CLAUDE.md`'s "Skill design
(`refresh-tools-rule`)" section for the full rationale.

## Step 1 — Detect

<!-- coderabbit-skip: `ls`/`command -v` here run inside a dynamic-context `!` block — load-time preprocessing executed before Claude sees the content, not a Claude tool call, so `allowed-tools` has no bearing on it (cc-reference claude-code-skills-reference.md, "Dynamic context injection": "runs the shell command BEFORE Claude sees content ... preprocessing, not a Claude action"). Only the runtime Bash call in Step 2 is a model-issued tool call, and that is covered. -->
```!
echo "Installed: $(ls $HOME/.claude/rules/coding-toolbox-tools.md 2>/dev/null || echo '(none)')"
echo "rtk: $(command -v rtk >/dev/null 2>&1 && echo present || echo absent)"
echo "bun: $(command -v bun >/dev/null 2>&1 && echo present || echo absent)"
echo "ripgrep: $(command -v rg >/dev/null 2>&1 && echo present || echo absent)"
echo "codebase-memory: $(command -v codebase-memory-mcp >/dev/null 2>&1 && echo present || echo absent)"
```

If the block above rendered as literally `[shell command execution disabled by policy]`, stop and report: shell execution is disabled for skills (`disableSkillShellExecution`) — this skill can't detect or refresh safely. Do not guess; end here.

## Step 2 — Apply

- `Installed:` line does **not** mention `coding-toolbox-tools.md` → stop, no-op.
  Report "not installed — nothing to refresh." Never create the file.
- `Installed:` line **does** mention it, and at least one of `rtk`/`bun`/`ripgrep`/`codebase-memory` is `present`:
  ```bash
  cat > "$HOME/.claude/rules/coding-toolbox-tools.md" <<'EOF'
  # Tool routing

  Detected on this machine — prefer these over the generic default when available.

  | Task | Prefer | Why |
  |---|---|---|
  <one line per detected tool, from the candidate rows below, in this order>
  EOF
  ```
  Candidate rows — include only the ones detected, each as one line of the same
  heredoc before its closing `EOF`, verbatim, in this order (identical to
  `setup-rules`' own Step 4 rows — kept in sync by hand; a bats sync-guard
  pins the match):
  | Tool | Row |
  |---|---|
  | rtk | `| Shell commands (git, gh, npm, …) | \`rtk <cmd>\` | routes through the Rust Token Killer proxy — token savings on dev-op output |` |
  | bun | `| JS/TS runtime & package management | \`bun\` | faster install/run than node/npm |` |
  | ripgrep | `| Text search | \`rg\` (ripgrep) | faster, respects .gitignore |` |
  | codebase-memory | `| Code structure exploration (callers, call chains, architecture) | \`codebase-memory-mcp\` tools | graph-backed, avoids grepping the whole tree |` |
- `Installed:` line mentions it, but nothing is detected: make **no change** —
  never overwrite an existing, populated table with an empty one. Report that
  nothing was detected so the existing file was left as-is.

## Step 3 — Report

State plainly, one line: refreshed / left untouched (nothing detected) / not
installed (nothing to do).
