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
| `fresh-work` | Run one unit of work end-to-end from a one-line description: classify (fix/refactor/feature), branch via `fresh-branch`, design + plan as session temp files (always self-reviewed; consult an advisor on their own judgment call), an `AskUserQuestion` intent-confirmation checkpoint between them, implement task-by-task via workflow-driven development (Workflow tool, Agent fallback), a combined verified review workflow (correctness angles + per-lens cleanup finders, effort scaled to diff complexity, fixes applied by the orchestrator) before PR; fix path: systematic debugging instead, finish via `fresh-pr`. Fully self-contained. |
| `bump-version` | Bump a project's semantic version (major/minor/patch) in its detected version file (`package.json`, `composer.json`, `pom.xml`, or `VERSION`) and sync the matching lock file (`npm`/`composer`) when present. No git operations. |
| `setup-rules` | Install, refresh, or remove coding-toolbox's user-level rules — a golden-rules copy and a tool-routing table for `rtk`/`bun`/`rg`/`codebase-memory-mcp` — as always-on `~/.claude/rules/coding-toolbox-*.md` files (every project on this machine), via one `AskUserQuestion` call with a single-select question per rule showing its current install state, or non-interactively via a verbatim argument (e.g. `/coding-toolbox:setup-rules update tools rule`). User-only — not model-invocable. |
| `refresh-tools-rule` | Refresh the tool-routing rule from current `PATH` detection, but only if it's already installed — never creates or removes it. Model-invocable (unlike `setup-rules`) precisely because it's non-destructive; `memory-enhancement`'s `dream` skill uses this to keep the rule current across sessions. |

## Agents

| Agent | Model | Role |
|---|---|---|
| `ci-watcher` | sonnet | read-only: watches CI via `bin/ci-watch.sh`, collects open CodeRabbit PR threads (including any attached AI-agent fix prompt) |
| `pr-fixer` | opus | verifies CI/CodeRabbit findings against the code, applies justified fixes, commits (never pushes), always annotates skipped findings in code |

## What it does

Mechanically enforces the Interaction axis on every turn and blocks non-UTF-8 file
operations — both automatic, zero-setup. The full "golden behavior rules" document
(covering all four axes) is available as an opt-in user-level rule via the `setup-rules`
skill, rather than injected automatically.

The rules document is written in cavemem's compressed-English notation and combines
four axes — three sourced from external repos, one (Interaction) plugin-original:

| Axis | Source | Contributes |
|---|---|---|
| **Interaction** | plugin-original (no external source) | every user interaction via AskUserQuestion; no ask-and-wait |
| **Language** | [cavemem `docs/compression.md`](https://github.com/JuliusBrussee/cavemem/blob/main/docs/compression.md) | write compactly; preserve technical tokens |
| **Behavior** | [andrej-karpathy-skills `CLAUDE.md`](https://github.com/multica-ai/andrej-karpathy-skills/blob/main/CLAUDE.md) | think → simplify → surgical → verify |
| **Mentality** | [ponytail-lite `AGENTS.md`](https://github.com/ilindaniel/ponytail-lite/blob/main/AGENTS.md) | lazy senior dev; YAGNI; prefer deletion |

- A `Stop` hook mechanically blocks a turn that ends with a plain-text question to the
  user, telling Claude to redo it via `AskUserQuestion` instead.
- **Encoding guard (PreToolUse):** before `Read`, `Edit`, `Write` and `Bash`
  operations that read or modify file content, detects the target file's
  encoding and denies the call when the file is not UTF-8 — naming the
  detected encoding and a concrete `iconv` alternative. Precision-biased and
  fail-open: quoted/substituted paths, unknown tools, binary and missing
  files always pass; encoding-safe tools (`iconv`, `git`, `mv`, …) are never
  blocked.

The Stop gate and encoding guard need no setup. Run `/coding-toolbox:setup-rules` once per
machine to opt into the full golden-rules document and a tool-routing table as persistent
`~/.claude/rules/*.md` files, applying to every project you open here.
