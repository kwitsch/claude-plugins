# coding-toolbox

## Install

```
/plugin install coding-toolbox@kwitsch-plugins
```

## Skills

| Skill | What it does |
|---|---|
| `fresh-branch` | Refresh the current branch onto its default base with no arguments (in any context), or cut a new branch off an optional custom base outside a worktree, or refresh onto an explicit base inside a linked git worktree. Auto-stashes/pops uncommitted changes around the operation. |
| `fresh-pr` | Commit pending work, rebase onto an updated base, push, and open or refresh a PR/MR (GitHub and GitLab) — then drive it to CI-green (and, if CodeRabbit participates, all review threads resolved) via bundled `ci-watcher`/`pr-fixer` agents. No dependency on `branch-management`. |
| `fresh-work` | Run one unit of work end-to-end from a one-line description: classify (fix/refactor/feature), branch via `fresh-branch`, design + plan as session temp files with inline advisor review, implement task-by-task via workflow-driven development (Workflow tool, Agent fallback); fix path: systematic debugging instead, finish via `fresh-pr`. Fully self-contained. |

## Agents

| Agent | Model | Role |
|---|---|---|
| `ci-watcher` | sonnet | read-only: watches CI via `bin/ci-watch.sh`, collects open CodeRabbit PR threads (including any attached AI-agent fix prompt) |
| `pr-fixer` | opus | verifies CI/CodeRabbit findings against the code, applies justified fixes, commits (never pushes), always annotates skipped findings in code |

## What it does

Injects a compact "golden behavior rules" contract into every Claude Code session,
re-surfaces a short reminder before consequential tool calls, and mechanically enforces
the Interaction axis, so the rules stay in context and are enforced.

The rules document is written in cavemem's compressed-English notation and combines
four axes — three sourced from external repos, one (Interaction) plugin-original:

| Axis | Source | Contributes |
|---|---|---|
| **Interaction** | plugin-original (no external source) | every user interaction via AskUserQuestion; no ask-and-wait |
| **Language** | [cavemem `docs/compression.md`](https://github.com/JuliusBrussee/cavemem/blob/main/docs/compression.md) | write compactly; preserve technical tokens |
| **Behavior** | [andrej-karpathy-skills `CLAUDE.md`](https://github.com/multica-ai/andrej-karpathy-skills/blob/main/CLAUDE.md) | think → simplify → surgical → verify |
| **Mentality** | [ponytail-lite `AGENTS.md`](https://github.com/ilindaniel/ponytail-lite/blob/main/AGENTS.md) | lazy senior dev; YAGNI; prefer deletion |

- A `SessionStart` hook injects the full rules document, now covering all four axes
  (it re-fires on resume and after compaction, so the rules survive a compaction).
- A `PreToolUse` hook (scoped to `Edit`, `Write`, `NotebookEdit`, `Bash` — not before
  subagent dispatch) injects a one-line reminder covering all four axes before code
  edits and shell commands, throttled to every 10th matching call.
- A `Stop` hook mechanically blocks a turn that ends with a plain-text question to the
  user, telling Claude to redo it via `AskUserQuestion` instead.
- **Encoding guard (PreToolUse):** before `Read`, `Edit`, `Write` and `Bash`
  operations that read or modify file content, detects the target file's
  encoding and denies the call when the file is not UTF-8 — naming the
  detected encoding and a concrete `iconv` alternative. Precision-biased and
  fail-open: quoted/substituted paths, unknown tools, binary and missing
  files always pass; encoding-safe tools (`iconv`, `git`, `mv`, …) are never
  blocked.

No configuration; nothing to set up — enabling the plugin is enough.
