---
name: update-cc-references
description: Updates the harness-optimized Claude Code reference files (skills, agents, hooks, hook-handler-selection, commands, mcp, plugins, memory, settings) by re-fetching the official Anthropic docs and applying deltas — new/renamed/removed frontmatter fields, changed best practices, new hook events/handler fields, new MCP transports, plugin schema changes, new version gates, env vars, settings keys, and permission modes. Use when Anthropic ships Claude Code changes or the reference files look stale.
argument-hint: [skills|agents|hooks|commands|mcp|plugins|memory|settings|all]
disable-model-invocation: true
allowed-tools: WebFetch, WebSearch, Read, Edit, Write, Glob, Bash, Skill, Agent, ToolSearch, TaskCreate, TaskUpdate, TaskList, TaskGet, TaskStop
---

# Update Claude Code reference files

Maintains the harness-optimized reference files against the live Anthropic docs.
Target selected by `$ARGUMENTS`: `skills`, `agents`, `hooks`, `commands`, `mcp`,
`plugins`, `memory`, `settings`, or `all` (default `all`).

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

**`claude-code-mcp-tool-hooks-reference.md`** (CURATED — update conservatively)
- Source: `https://code.claude.com/docs/en/hooks` (mcp_tool hook fields) + `https://code.claude.com/docs/en/mcp`. This file mixes doc-mirrored fields with a hard-won gotcha: a plugin's own `mcp_tool` hook must reference the server as `plugin:<plugin>:<server-key>` (per `claude mcp list`), not the bare `.mcp.json` key. PRESERVE that namespacing rule and the output-contract section on any refresh; never regenerate wholesale.

**`hook-handler-selection.md`** (CURATED decision aid — update conservatively)
- Same source: `https://code.claude.com/docs/en/hooks`. This file is a hand-tuned decision table for choosing a handler `type`, not a 1:1 doc mirror. Only touch it when the docs change something it actually asserts: handler types, fail-open/closed semantics, per-call cost/latency/state characteristics, default timeouts, `mcp_tool`/command-form shape, exit-code/decision constraints. Preserve its rule ordering and quick-map structure. Never regenerate it wholesale.

**`claude-code-commands-reference.md`**
- Slash commands (custom `.claude/commands` authoring, frontmatter, arguments, dynamic context, namespacing): `https://code.claude.com/docs/en/slash-commands`
- Commands reference (built-ins + bundled skills): `https://code.claude.com/docs/en/commands`

**`claude-code-mcp-reference.md`**
- MCP integration (config, transports, scopes, auth, tool naming): `https://code.claude.com/docs/en/mcp`
- Supporting — quickstart: `https://code.claude.com/docs/en/mcp-quickstart`; managed/enterprise: `https://code.claude.com/docs/en/managed-mcp`

**`claude-code-plugins-reference.md`**
- Plugins (create, components): `https://code.claude.com/docs/en/plugins`
- Plugins reference (schemas, CLI, component specs): `https://code.claude.com/docs/en/plugins-reference`
- Supporting — marketplaces: `https://code.claude.com/docs/en/plugin-marketplaces`; dependencies: `https://code.claude.com/docs/en/plugin-dependencies`; hints: `https://code.claude.com/docs/en/plugin-hints`

**`claude-code-memory-reference.md`**
- Memory (CLAUDE.md files, imports, auto-memory): `https://code.claude.com/docs/en/memory`

**`claude-code-settings-reference.md`**
- Settings: `https://code.claude.com/docs/en/settings`; env vars: `https://code.claude.com/docs/en/env-vars`; permissions: `https://code.claude.com/docs/en/permissions`; permission modes: `https://code.claude.com/docs/en/permission-modes`; model config: `https://code.claude.com/docs/en/model-config`; output styles: `https://code.claude.com/docs/en/output-styles`; statusline: `https://code.claude.com/docs/en/statusline`; sandboxed Bash: `https://code.claude.com/docs/en/sandboxing`

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
- [ ] 8. Contradiction-validation gate — classify diff, validate each contradiction via cc-reference-validator, revert unconfirmed, block release until clean
```

**1. Resolve targets.** `skills` → skills file; `agents` → agents file; `hooks` → the hooks files (`claude-code-hooks-reference.md` + `hook-handler-selection.md` + `claude-code-mcp-tool-hooks-reference.md`, the latter two per their conservative rules — preserve curated gotchas, never regenerate wholesale); `commands` → `claude-code-commands-reference.md`; `mcp` → `claude-code-mcp-reference.md`; `plugins` → `claude-code-plugins-reference.md`; `memory` → `claude-code-memory-reference.md`; `settings` → `claude-code-settings-reference.md`; `all`/empty → everything. Locate files with `Glob` (`plugins/claude-code-knowledge/skills/cc-reference/references/*.md`); if absent, create them there. The canonical location is the `references/` subfolder `plugins/claude-code-knowledge/skills/cc-reference/references/` — update files there. (Note: `skill-folder-structure.md` in that folder is a static convention doc — NOT a maintained target; never refresh it from docs.)

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

**8. Contradiction-validation gate (MANDATORY — blocks Release).** The step-7 self-check is not
enough: a refresh agent can overturn a correct prior claim with a wrong or fabricated one (a
non-existent config field, an inverted env-var meaning, an unsourced version gate). Before Release,
validate every change that contradicts the predecessor version.

- **8a. Classify the diff.** For each refreshed file, run `git diff HEAD -- <file>` and label each hunk:
  - ADDITIVE — a purely new field/row/section that overturns no prior claim → no extra validation.
  - CONTRADICTING — modifies, removes, flips, or re-scopes an existing claim (changed table cell,
    reworded *meaning*, deleted line, changed version gate / default / threshold).
  - On doubt, label CONTRADICTING (a false positive costs one validation; a false negative ships an
    error). Semantic-equivalent rewording is ADDITIVE.
  - Version tell (run explicitly): extract every `v?MAJOR.MINOR.PATCH` token ADDED in the diff and
    check each against the fetched source-doc text; any token absent from the docs is CONTRADICTING
    (unsourced), regardless of the prose label.
- **8b. Validate each contradiction individually.** For EACH contradicting hunk, dispatch one
  `cc-reference-validator` subagent (read-only; one hunk per dispatch). Pass it the file path, the
  predecessor claim, the new claim, and the file's source-doc URL(s). It returns
  `{verdict, quote, sourceUrl, confidence, notes}`. Escalate to a 2-of-3 majority of fresh
  `cc-reference-validator` dispatches ONLY when a single verdict is UNVERIFIABLE or `confidence:"low"`.
  - **Reconciliation gate (per `.claude/rules/subagent-tracking.md`).** Agent dispatch is async:
    each `cc-reference-validator` returns a `task_id` now and its verdict arrives later as a
    `<task-notification>`. Load the ledger tools once (deferred; resolve at depth 0, where this skill
    runs — a subagent-scoped probe falsely reports these absent, do NOT skip the ledger on that basis):
    `ToolSearch(query: "select:TaskCreate,TaskUpdate,TaskList,TaskGet,TaskStop")` (retry bare names).
    Only if the CRUD ledger tools (TaskCreate/TaskUpdate/TaskList) fail to load, use the prose count —
    TaskStop loading alone is not sufficient to activate the ledger path. Track every dispatch
    (including the 2-of-3 escalation batch) with the `Task*` ledger — `TaskCreate` one entry per
    dispatch (`metadata.dispatch_id` = the Agent `task_id`), `TaskUpdate` → `completed` on each matching
    notification. Do NOT advance to 8c resolution or Release until dispatched-count == result-count,
    i.e. EVERY dispatched validator (initial + escalations) has returned a terminal verdict. Escape
    hatch only: if a still-`in_progress` dispatch is judged genuinely stuck, `TaskStop` its
    `dispatch_id`, mark it terminal (record a soft-failure), and proceed. If the CRUD ledger tools
    fail to load, use a prose count: do not advance until that many structured verdicts are in hand.
- **8c. Resolve + gate.**
  - CONFIRMED (with quote) → keep the change.
  - REJECTED → revert that hunk to the predecessor version; keep the rest of the file; re-run 8a/8b on
    any cascading change.
  - UNVERIFIABLE → revert that hunk to the predecessor version (cc-reference must mirror the docs;
    silence is not evidence — repo augmentations live in `.claude/rules/`, not here).
  - No majority (the 2-of-3 escalation batch returns three different verdicts, e.g.
    CONFIRMED/REJECTED/UNVERIFIABLE one each) → apply the skeptical default: treat as UNVERIFIABLE and
    revert that hunk to the predecessor version.
  - If reverts leave a file with no real content change, drop it from the release and revert the
    step-6 `verified`-date bump for that file (step 6 already freshened the date, so "do not bump" is
    unreachable — the dropped file must be returned to its predecessor date so it reads as unchanged).
  - Release is BLOCKED until the diff contains zero unconfirmed contradictions.
- **8d. Provenance report.** Record every contradicting hunk for the PR body:
  `file · claim · old → new · verdict · sourceUrl + verbatim quote · action (kept/reverted/escalated)`.
  List reverted/blocked items explicitly — never drop them silently.

## Notes

- The reference files are written in English to match Claude Code terminology; keep updates in English regardless of conversation language.

## Release (after a successful update)

This skill is run manually by the user. After the doc-update workflow finishes,
drive a release ONLY if a reference file actually changed.

**Precondition: the step-8 contradiction-validation gate must report zero unconfirmed contradictions.**
If any hunk was reverted in step 8c, re-run the change detection below against the post-revert tree.

1. **Detect change:**
   ```bash
   git status --porcelain plugins/claude-code-knowledge/skills/cc-reference/
   ```
   - **No output** (nothing changed) → report "references already current",
     print the short changelog, and STOP. Make no commit, no version bump, no PR.
   - **Output present** → continue.

2. **Patch version bump** in `plugins/claude-code-knowledge/.claude-plugin/plugin.json`:
   bump only the last number, leave major/minor untouched (e.g. `0.1.0` → `0.1.1`).
   The version lives ONLY in `plugin.json` (per `.claude/rules/plugin-versioning.md`).
   Do NOT edit any version in `marketplace.json` and do NOT create a git tag — CI
   (`tag-on-version-bump.yml`) tags after the PR merges.

3. **Stamp the ingestion date into the `description`** in the same `plugin.json`.
   The date is when the docs were read this run — the same date written to the
   reference files' `verified` headers (today). Append/refresh a suffix at the END
   of the existing `description` string in this exact, stable form:
   `... (CC docs read: YYYY-MM-DD)`.
   - **Idempotent:** if the description already ends with a `(CC docs read: …)`
     suffix, REPLACE its date in place — never stack a second suffix. Match/replace
     the trailing ` (CC docs read: <date>)` token; keep the rest of the description
     unchanged.
   - Do not change the marketplace.json description here (it has no date suffix).

4. **Commit, push, open PR** by invoking the `commit-commands:commit-push-pr`
   skill (Skill tool). Stage the changed reference files and the bumped
   `plugin.json`. Use a Conventional-Commit subject such as
   `fix(claude-code-knowledge): refresh CC reference files`. Commit messages must
   carry NO `Co-Authored-By:` trailer and NO "Generated with Claude Code" footer
   (repo convention). If `commit-push-pr` is unavailable, fall back to inline git:
   create a branch off the default branch if currently on it, commit, push, and
   `gh pr create`.

5. **Report** the new version, the ingestion date stamped into the description, the
   PR URL, and the changelog from the update step.
