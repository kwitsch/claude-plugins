---
description: Install a user-level ~/.claude/agents/explore.md, choosing between a plain and a codebase-memory-mcp-aware variant based on whether that MCP server is detected on this machine. Run once per machine, or again after codebase-memory-mcp is installed/removed.
allowed-tools: ["Read", "Bash(mkdir:*)", "Bash(mktemp:*)", "Bash(cp:*)", "Bash(mv:*)"]
disable-model-invocation: true
---

# Set up the user-level explore agent

Installs `~/.claude/agents/explore.md` from one of two bundled variants,
picked by whether `codebase-memory-mcp` is on `PATH`. This is a user-level
file — it applies to every project you open on this machine, same as
`setup-rules`' managed files — so it stays user-only (not model-invocable).

## Step 1 — Detect

<!-- coderabbit-skip: `ls`/`command -v` here run inside a dynamic-context `!` block — load-time preprocessing executed before Claude sees the content, not a Claude tool call, so `allowed-tools` has no bearing on it (cc-reference claude-code-skills-reference.md, "Dynamic context injection": "runs the shell command BEFORE Claude sees content ... preprocessing, not a Claude action"). Only the runtime Bash calls in Step 3 are model-issued tool calls, and those are covered. -->

```!
echo "codebase-memory-mcp: $(command -v codebase-memory-mcp >/dev/null 2>&1 && echo present || echo absent)"
echo "Existing target: $(ls -la "$HOME/.claude/agents/explore.md" 2>/dev/null || echo '(none)')"
echo "Plugin root: $CLAUDE_PLUGIN_ROOT"
```

If the block above rendered as literally `[shell command execution disabled by policy]`, stop and report: shell execution is disabled for skills (`disableSkillShellExecution`) — this skill can't detect or install safely. Do not guess; end here.

## Step 2 — Decide

- `codebase-memory-mcp: present` → install `references/explore.codebase-memory.md`
  (prioritizes the codebase-memory-mcp knowledge graph, falls back to Grep/Glob/Read).
- `codebase-memory-mcp: absent` → install `references/explore.initial-haiku.md`
  (plain read-only search agent, no MCP dependency).

## Step 3 — Apply

Byte-exact `cp` of the chosen reference file — never re-typed, avoiding
transcription drift. Writes via `mktemp` + `mv` in the target directory so
the replace is atomic and never follows a symlink at that path the way a
plain `cat >` redirect would. The `mv` is gated on the `cp` succeeding, so a
failed copy never overwrites a working install with an empty temp file:

```bash
mkdir -p "$HOME/.claude/agents"
tmp="$(mktemp "$HOME/.claude/agents/.explore.md.XXXXXX")" || exit 1
cp "<plugin root resolved in Step 1>/skills/setup-explore/references/<chosen file>" "$tmp" || exit 1
mv -f "$tmp" "$HOME/.claude/agents/explore.md"
```

## Step 4 — Report

State plainly, one line: which variant was installed, why (detected /
absent), and whether this replaced an existing `~/.claude/agents/explore.md`
(per Step 1's "Existing target" line) or created a new one.
