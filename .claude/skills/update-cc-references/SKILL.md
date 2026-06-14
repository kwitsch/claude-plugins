---
name: update-cc-references
description: Updates the harness-optimized Claude Code reference files (claude-code-skills-reference.md, claude-code-agents-reference.md, claude-code-hooks-reference.md) by re-fetching the official Anthropic docs and applying deltas — new/renamed/removed frontmatter fields, changed best practices, new hook events/handler fields, new version gates, env vars, and settings. Use when Anthropic ships Claude Code changes or the reference files look stale.
argument-hint: [skills|agents|hooks|all]
disable-model-invocation: true
allowed-tools: WebFetch, WebSearch, Read, Edit, Write, Glob, Bash, Skill
---

# Update Claude Code reference files

Maintains the harness-optimized reference files against the live Anthropic docs.
Target selected by `$ARGUMENTS`: `skills`, `agents`, `hooks`, or `all` (default `all`).

## Source-of-truth mapping

Always prefer the `.md` variant of a doc URL when it returns clean markdown; fall back to the HTML page.

**`claude-code-skills-reference.md`**
- Skill authoring best practices: `https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices`
- Claude Code skills (frontmatter, lifecycle, invocation, fork, dynamic context, scopes, permissions): `https://code.claude.com/docs/en/skills`
- Supporting — Agent Skills overview: `https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview`
- Supporting — SDK skills (CLI-only `allowed-tools` caveat): `https://docs.claude.com/en/api/agent-sdk/skills`

**`claude-code-agents-reference.md`**
- Sub-agents (frontmatter, scopes, models, permissions, hooks, memory, nesting, forks, patterns): `https://code.claude.com/docs/en/sub-agents`
- Supporting — SDK subagents: `https://docs.claude.com/en/api/agent-sdk/subagents`

**`claude-code-hooks-reference.md`** (mechanics)
- Hooks reference (events, matchers, I/O, exit codes, decision control, handler fields, scopes): `https://code.claude.com/docs/en/hooks`
- Supporting — Hooks guide (examples): `https://code.claude.com/docs/en/hooks-guide`

**`hook-handler-selection.md`** (CURATED decision aid — update conservatively)
- Same source: `https://code.claude.com/docs/en/hooks`. This file is a hand-tuned decision table for choosing a handler `type`, not a 1:1 doc mirror. Only touch it when the docs change something it actually asserts: handler types, fail-open/closed semantics, per-call cost/latency/state characteristics, default timeouts, `mcp_tool`/command-form shape, exit-code/decision constraints. Preserve its rule ordering and quick-map structure. Never regenerate it wholesale.

If a URL 404s, run a `WebSearch` for the doc title (e.g. "Claude Code sub-agents docs") and fetch the canonical result before proceeding. Do not update a file from search snippets alone — fetch full pages.

## Workflow

Copy this checklist and track progress:

```text
Update Progress:
- [ ] 1. Resolve target file(s) from $ARGUMENTS
- [ ] 2. Read the current reference file(s) on disk
- [ ] 3. Fetch the mapped source docs (full pages)
- [ ] 4. Diff doc vs file across the delta checklist
- [ ] 5. Apply edits in the existing harness style
- [ ] 6. Update the verified-date and version notes
- [ ] 7. Verify against the post-update checks
```

**1. Resolve targets.** `skills` → skills file; `agents` → agents file; `hooks` → both hooks files (`claude-code-hooks-reference.md` + `hook-handler-selection.md`, the latter per its conservative rule above); `all`/empty → everything. Locate files with `Glob` (`plugins/claude-code-knowledge/skills/cc-reference/*.md`); if absent, create them at that path. The canonical location is `plugins/claude-code-knowledge/skills/cc-reference/` — update files there.

**2. Read current file(s).** Note the existing structure and the `verified` date in the header comment.

**3. Fetch sources.** Fetch every mapped URL for the selected target(s). Read completely — do not preview with partial reads.

**4. Diff against this delta checklist** (these are the things that actually change):
- **Frontmatter fields:** added, removed, renamed, or changed semantics. Update the field tables AND any prose that references a field. (Skills file: CC frontmatter table + SDK caveat. Agents file: frontmatter table + model-resolution order.)
- **Hook events & handler fields:** new/removed events, changed cadence, new matcher fields, new handler types or handler-field changes, changed exit-2-per-event effects, new decision-control fields, `hookSpecificOutput` changes. Update both the hooks-reference tables and, if the assertion changed, the selection file's comparison table / decision rules.
- **Best-practice guidance:** changed thresholds (line/token budgets, char caps), reworded rules, new anti-patterns, new patterns.
- **Lifecycle / mechanics:** compaction budgets, context-loading rules, discovery/precedence changes.
- **Permissions & invocation:** new permission modes, `Skill(...)`/`Agent(...)` rule syntax, `skillOverrides` states, delegation/`--agent` behavior.
- **Version gates:** any "requires vX.Y.Z" or "as of vX.Y.Z" note → update the Version notes section.
- **Env vars & settings:** new `CLAUDE_CODE_*` vars or settings keys.
- **Built-ins:** changes to built-in skills/agents (e.g. Explore/Plan behavior, bundled skills list).

**5. Apply edits.** Preserve the harness style: directives not prose, tables for field references, no marketing, forward slashes. Keep the body under 500 lines; if a section outgrows it, split into a sibling file referenced one level deep. Do not introduce time-sensitive phrasing ("after August 2026…") — use a "Version notes" line or a collapsed "Old patterns" block instead.

**6. Update metadata.** Set the header `verified` date to today. Append/adjust version gates in the Version notes section.

**7. Verify (feedback loop — repeat until all pass):**
- Every frontmatter field present in the fetched doc appears in the file's field table, with matching name and required/optional status.
- No field in the file is absent from the docs (flag removed/renamed ones explicitly rather than silently dropping).
- No time-sensitive wording was introduced.
- Terminology stays consistent with the rest of the file (e.g. always "subagent", always "frontmatter").
- Body still under 500 lines; references still one level deep.
- Report a short changelog: what changed vs the previous version, grouped by the delta checklist categories. If nothing changed, say so and leave the file (except the verified date) untouched.

## Notes

- The reference files are written in English to match Claude Code terminology; keep updates in English regardless of conversation language.

## Release (after a successful update)

This skill is run manually by the user. After the doc-update workflow finishes,
drive a release ONLY if a reference file actually changed.

1. **Detect change:**
   ```bash
   git status --porcelain plugins/claude-code-knowledge/skills/cc-reference/
   ```
   - **No output** (nothing changed) → report "references already current",
     print the short changelog, and STOP. Make no commit, no version bump, no PR.
   - **Output present** → continue.

2. **Minor version bump** in `plugins/claude-code-knowledge/.claude-plugin/plugin.json`:
   bump the middle number, reset patch to 0 (e.g. `0.1.0` → `0.2.0`). The version
   lives ONLY in `plugin.json` (per `.claude/rules/plugin-versioning.md`). Do NOT
   edit any version in `marketplace.json` and do NOT create a git tag — CI
   (`tag-on-version-bump.yml`) tags after the PR merges.

3. **Commit, push, open PR** by invoking the `commit-commands:commit-push-pr`
   skill (Skill tool). Stage the changed reference files and the bumped
   `plugin.json`. Use a Conventional-Commit subject such as
   `feat(claude-code-knowledge): refresh CC reference files`. Commit messages must
   carry NO `Co-Authored-By:` trailer and NO "Generated with Claude Code" footer
   (repo convention). If `commit-push-pr` is unavailable, fall back to inline git:
   create a branch off the default branch if currently on it, commit, push, and
   `gh pr create`.

4. **Report** the new version, the PR URL, and the changelog from the update step.
