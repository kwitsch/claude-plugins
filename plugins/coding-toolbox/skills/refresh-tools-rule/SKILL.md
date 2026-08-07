---
name: refresh-tools-rule
description: Refresh coding-toolbox's user-level tool-routing rule (~/.claude/rules/coding-toolbox-tools.md) from currently-detected rtk/bun/ripgrep/codebase-memory-mcp, but ONLY if that file already exists. Never installs it. Model-invocable — safe for another skill (e.g. memory-enhancement's dream) to call autonomously, since it can only ever refresh an existing file's content, never create or remove one.
allowed-tools: ["Read", "Bash(cat:*)", "Bash(mktemp:*)", "Bash(mv:*)"]
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
echo "Plugin root: $CLAUDE_PLUGIN_ROOT"
```

If the block above rendered as literally `[shell command execution disabled by policy]`, stop and report: shell execution is disabled for skills (`disableSkillShellExecution`) — this skill can't detect or refresh safely. Do not guess; end here.

## Step 2 — Apply

- `Installed:` line does **not** mention `coding-toolbox-tools.md` → stop, no-op.
  Report "not installed — nothing to refresh." Never create the file.
- `Installed:` line **does** mention it, and at least one of `rtk`/`bun`/`ripgrep`/`codebase-memory` is `present`. Run this as **one** command — it
  re-verifies the target is still an existing, non-symlink regular file
  immediately before writing (closing the gap between Step 1's detection,
  which ran at load time, and this apply step), and replaces its contents
  atomically via write-to-a-same-directory-temp-file-then-`mv`. This never
  creates the target if the recheck fails and never follows a symlink at that
  path the way a plain `cat >` redirect would (a `mv` onto an existing path
  replaces whatever is there — including a symlink itself — rather than
  writing through it):

  ```bash
  target="$HOME/.claude/rules/coding-toolbox-tools.md"
  if [ -f "$target" ] && [ ! -L "$target" ]; then
    tmp="$(mktemp "$HOME/.claude/rules/.coding-toolbox-tools.md.XXXXXX")" || exit 1
    cat > "$tmp" <<'EOF'
  # Tool routing

  Detected on this machine — prefer these over the generic default when available.

  | Task | Prefer | Why |
  |---|---|---|
  <one line per detected tool, from the candidate rows file below, in this order>
  EOF
    mv -f "$tmp" "$target"
  else
    echo "not installed (or not a plain file) — nothing to refresh"
  fi
  ```

  Candidate rows — Read `<plugin root resolved in Step 1>/skills/setup-rules/references/tool-routing-rows.md`
  for the exact rows to include (only those detected, verbatim, in that
  file's order) — the same file `setup-rules` reads, single source of
  truth, never inlined here.

- `Installed:` line mentions it, but nothing is detected: make **no change** —
  never overwrite an existing, populated table with an empty one. Report that
  nothing was detected so the existing file was left as-is.

## Step 3 — Report

State plainly, one line: refreshed / left untouched (nothing detected) / not
installed (nothing to do).
