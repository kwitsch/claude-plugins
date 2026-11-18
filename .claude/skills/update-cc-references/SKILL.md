---
name: update-cc-references
description: Updates the harness-optimized Claude Code reference files (skills, agents, hooks, hook-handler-selection, commands, mcp, plugins, memory, settings) by re-fetching the official Anthropic docs and applying deltas — new/renamed/removed frontmatter fields, changed best practices, new hook events/handler fields, new MCP transports, plugin schema changes, new version gates, env vars, settings keys, and permission modes. Use when Anthropic ships Claude Code changes or the reference files look stale.
argument-hint: [skills|agents|hooks|commands|mcp|plugins|memory|settings|all]
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, Agent, ToolSearch, Workflow, EnterWorktree
---

# Update Claude Code reference files

Refreshes the harness-optimized reference files in `plugins/cc-knowledge/skills/cc-reference/references/`
against the live Anthropic docs. Target from `$ARGUMENTS`: `skills`, `agents`, `hooks`, `commands`, `mcp`,
`plugins`, `memory`, `settings`, or `all` (default `all`). The URL table, the target-to-file map and the
per-file curated rules live in `sources.json`; every mechanical step runs in `refresh.mjs`. Your own work
is limited to what each step names. Reference files stay in English regardless of conversation language.

## Steps

1. **Worktree.** If the cwd is not already a worktree and the run is interactive, call `EnterWorktree`
   before any edit.

2. Read `${CLAUDE_SKILL_DIR}/refresh.reference.md` (the script's parameter, exit-code and output contract).

3. **Plan and fetch.**

   ```bash
   node ${CLAUDE_SKILL_DIR}/refresh.mjs plan $ARGUMENTS
   ```

   The script downloads every mapped doc itself with `curl` (`<url>.md`, HTML-contamination check, one
   `altUrls` retry). Never `WebFetch` (its summarizer fabricates content on these docs) and never
   `WebSearch`. Exit 2: report the `failed` URLs and STOP (the fix is an `altUrls` entry in
   `sources.json`). Keep `scratch` and `workflowScript` from the JSON output.

4. **Update and verify.** Run `ToolSearch(query: "select:Workflow")`.
   - Available: Read `<scratch>/workflow.js` and pass its full text as the `Workflow` script, unchanged.
     Every value is already baked in; pass no `args`. It returns `{ results, commands }`.
   - Fallback (Workflow absent, or it rejects the script): for each target in `<scratch>/plan.json`,
     in order:
     1. Do the work described by `authorPrompt` in `<scratch>/workflow.js` for that target yourself
        (same checklist, same `note`), ending with its `gate` command.
     2. If `gate` printed a non-empty `changing`, dispatch `cc-reference-validator` once via `Agent`
        with the `validatorPrompt` text for that target (gate's `diffPath` plus the doc paths).
     3. Add `node '<script>' finish '<scratch>' '<name>'` to `commands`, followed by
        ` --keep <ids>` listing only the CONFIRMED hunk ids (no `--keep` when there are none).

5. **Contradiction-validation gate** (mechanical; nothing to decide here). `gate` and `finish` read
   `git diff HEAD -- <file>` with `-U0`. Pure-addition hunks are ADDITIVE and kept. A hunk that adds an
   `x.y.z` version found in neither its own removed lines nor the fetched docs is reverted as unsourced.
   Every hunk that removes or changes a line goes to `cc-reference-validator`, which answers CONFIRMED,
   REJECTED or UNVERIFIABLE per `hN` label. `finish` keeps only the CONFIRMED ids passed via `--keep` and
   reverts every other line-changing hunk, including any the validator never reported. A file edited
   after its `gate` run is `stale`: all its line changes revert.

6. **Finish.** Run every string in `commands` in one Bash call, joined with `;`. Each prints one JSON
   line. Exit 3 from any of them: report that target and STOP before Release. Report per file:
   `status` (`updated`/`unchanged`), its changelog, `kept`/`reverted`/`autoReverted`, every
   `lowConfidenceKept` entry, `stale` flags, and every `null` result as "skipped: `<name>`". Never drop
   one silently.

7. **Release: patch version bump and date stamp.** Precondition: zero unconfirmed contradictions (step 6
   ran `finish` for every target, so only CONFIRMED line changes remain).

   ```bash
   node ${CLAUDE_SKILL_DIR}/refresh.mjs release <scratch>
   ```

   `changed: false`: report "references already current" with the changelog and STOP (no commit, no
   PR). Otherwise the script has bumped the patch version in
   `plugins/cc-knowledge/.claude-plugin/plugin.json` (once per branch, compared with `origin/main`),
   replaced the `description` date suffix ` (CC docs read: YYYY-MM-DD)` in place, and updated the rolling
   version-pin test in `test/cc-knowledge/test.bats`. After a bump, `pinUpdated: false` means the pin
   literals did not match exactly once: report it, because CI's manifest test then fails until the pin
   is fixed by hand. Never edit `marketplace.json`, never create a tag.

8. **Commit, push, open the PR.** Replace `<target>` with the target name and `<changelog>` with the
   step 6 changelog. No `Co-Authored-By:` trailer, no "Generated with" footer.

   ```bash
   [ "$(git branch --show-current)" = main ] && git checkout -b "fix/refresh-cc-references-<target>-$(date +%Y%m%d-%H%M%S)"
   git add plugins/cc-knowledge/skills/cc-reference/ plugins/cc-knowledge/.claude-plugin/plugin.json test/cc-knowledge/test.bats
   git commit -m "fix(cc-knowledge): refresh CC reference files"
   git push -u origin HEAD
   gh pr create --title "fix(cc-knowledge): refresh CC reference files" --body "<changelog>"
   ```

9. **Report** the new version, the date stamped into the description, the PR URL and the changelog.
