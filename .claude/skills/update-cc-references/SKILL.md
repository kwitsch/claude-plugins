---
name: update-cc-references
description: Updates the harness-optimized Claude Code reference files (skills, agents, hooks, hook-handler-selection, commands, mcp, plugins, memory, settings) by re-fetching the official Anthropic docs and applying deltas — new/renamed/removed frontmatter fields, changed best practices, new hook events/handler fields, new MCP transports, plugin schema changes, new version gates, env vars, settings keys, and permission modes. Use when Anthropic ships Claude Code changes or the reference files look stale.
argument-hint: [skills|agents|hooks|commands|mcp|plugins|memory|settings|all]
disable-model-invocation: true
allowed-tools: WebSearch, Read, Edit, Write, Glob, Grep, Bash, Skill, Agent, ToolSearch, Workflow, EnterWorktree
---

# Update Claude Code reference files

Maintains the harness-optimized reference files against the live Anthropic docs.
Target selected by `$ARGUMENTS`: `skills`, `agents`, `hooks`, `commands`, `mcp`,
`plugins`, `memory`, `settings`, or `all` (default `all`).

## Source-of-truth mapping

Always prefer the `.md` variant of a doc URL (see Fetch mechanism below for validating it actually
returned markdown, not an HTML fallback page).

**`claude-code-skills-reference.md`**

- Skill authoring best practices: `https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices`
- Claude Code skills (frontmatter, lifecycle, invocation, fork, dynamic context, scopes, permissions): `https://code.claude.com/docs/en/skills`
- Supporting — Agent Skills overview: `https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview`
- Supporting — SDK skills (CLI-only `allowed-tools` caveat): `https://code.claude.com/docs/en/agent-sdk/skills`

**`claude-code-agents-reference.md`**

- Sub-agents (frontmatter, scopes, models, permissions, hooks, memory, nesting, forks, patterns): `https://code.claude.com/docs/en/sub-agents`
- Supporting — SDK subagents: `https://code.claude.com/docs/en/agent-sdk/subagents`

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
- Supporting — quickstart: `https://code.claude.com/docs/en/mcp-quickstart`

**`claude-code-mcp-managed-reference.md`** (split from the mcp file — keep both in sync when `mcp` is the target)

- Managed/enterprise MCP (`managed-mcp.json`, allowlists/denylists): `https://code.claude.com/docs/en/managed-mcp`

**`claude-code-plugins-reference.md`**

- Plugins (create, components): `https://code.claude.com/docs/en/plugins`
- Plugins reference (schemas, CLI, component specs): `https://code.claude.com/docs/en/plugins-reference`
- Supporting — marketplaces: `https://code.claude.com/docs/en/plugin-marketplaces`; dependencies: `https://code.claude.com/docs/en/plugin-dependencies`; hints: `https://code.claude.com/docs/en/plugin-hints`

**`claude-code-memory-reference.md`**

- Memory (CLAUDE.md files, imports, auto-memory): `https://code.claude.com/docs/en/memory`

**`claude-code-settings-reference.md`**

- Settings: `https://code.claude.com/docs/en/settings`; env vars: `https://code.claude.com/docs/en/env-vars`; permissions: `https://code.claude.com/docs/en/permissions`; permission modes: `https://code.claude.com/docs/en/permission-modes`; model config: `https://code.claude.com/docs/en/model-config`; output styles: `https://code.claude.com/docs/en/output-styles`; statusline: `https://code.claude.com/docs/en/statusline`; sandboxed Bash: `https://code.claude.com/docs/en/sandboxing`

## Fetch mechanism (both modes)

Never `WebFetch` — its `.md` summarizer is known to fabricate content on these exact docs (a live run
invented ~30 non-existent settings.json keys; the same failure class as a prior refresh's fake
`v2.1.180` version gate). Fetch every URL yourself:

1. Pick a scratch dir: `$CLAUDE_JOB_DIR/tmp/docs` if `$CLAUDE_JOB_DIR` is set (background job), else
   `mktemp -d -t update-cc-references-XXXXXX`.
2. De-duplicate the URL list across every doc shared by the resolved target(s).
3. `curl -sL -o <scratch>/<name>.md <url>.md` per URL, via Bash — never `Write`/`Edit` for this (the
   repo's `universal-format` PostToolUse hook matches only `Write|Edit` tool calls, so a Bash-fetched
   file is never touched by it — this is _why_ curl-fetching avoids reformatting churn on the raw docs,
   not a separate suppression mechanism).
4. Validate: if the first line of the fetched file case-insensitively matches `<!doctype` or `<html`,
   the `.md` suffix didn't resolve to clean markdown (some `docs.claude.com`/`code.claude.com` aliases
   redirect wrong under `.md`; modern static-site generators emit the doctype lowercase, so match
   case-insensitively, not just the literal `<!DOCTYPE`). Retry once against the doc's corrected
   canonical path if known (see the SDK URLs above, already fixed from a prior wrong path). Still
   contaminated → `WebSearch` the doc title, take the canonical URL, curl that.
5. A curl failure that can't be resolved this way is a hard stop: report which URL(s) failed to the
   user. Never fall back to `WebFetch`.

## Resolve targets → decide execution mode

`skills` → skills file; `agents` → agents file; `hooks` → the hooks files (`claude-code-hooks-reference.md`
and `hook-handler-selection.md` and `claude-code-mcp-tool-hooks-reference.md`, the latter two per their
conservative rules — preserve curated gotchas, never regenerate wholesale); `commands` →
`claude-code-commands-reference.md`; `mcp` → `claude-code-mcp-reference.md` and `claude-code-mcp-managed-reference.md`;
`plugins` → `claude-code-plugins-reference.md`; `memory` → `claude-code-memory-reference.md`; `settings`
→ `claude-code-settings-reference.md`; `all`/empty → everything. Locate files with `Glob`
(`plugins/claude-code-knowledge/skills/cc-reference/references/*.md`); if absent, create them there.
(`skill-folder-structure.md` in that folder is a static convention doc — NOT a maintained target.)

`len(resolved files) == 1` → **Inline mode** (below). `len(resolved files) > 1` → **Workflow mode**
(below) — this includes `all` and any single trigger that already maps to more than one file (`hooks`,
`mcp`).

## Inline mode (exactly one target file)

Runs entirely in the orchestrator's own context — no `Agent`/`Workflow` dispatch for the common case.

1. Fetch that file's mapped docs (Fetch mechanism above).
2. Read the current reference file; note its `verified` date.
3. Diff against the delta checklist:
   - **Frontmatter fields:** added, removed, renamed, or changed semantics.
   - **Hook events & handler fields** (hooks target only): new/removed events, changed cadence, new
     matcher fields, new handler types/fields, changed exit-2-per-event effects, new decision-control
     fields, `hookSpecificOutput` changes.
   - **Best-practice guidance:** changed thresholds, reworded rules, new anti-patterns/patterns.
   - **Lifecycle / mechanics:** compaction budgets, context-loading rules, discovery/precedence changes.
   - **Permissions & invocation:** new permission modes, `Skill(...)`/`Agent(...)` rule syntax,
     `skillOverrides` states, delegation/`--agent` behavior.
   - **Version gates:** any "requires vX.Y.Z"/"as of vX.Y.Z" note → Version notes section.
   - **Env vars & settings:** new `CLAUDE_CODE_*` vars or settings keys.
   - **Built-ins:** changes to built-in skills/agents.
4. Apply edits: directives not prose, tables for field references, no marketing, forward slashes.
   Body under 500 lines (split to a sibling file, one level deep, if it outgrows this). No
   time-sensitive phrasing — use a Version notes line or a collapsed "Old patterns" block.
5. Update the `verified` date to today; append/adjust Version notes.
6. **Contradiction-validation gate** — classify every hunk in `git diff HEAD -- <file>`:
   - ADDITIVE — new field/row/section overturning no prior claim.
   - CONTRADICTING — modifies, removes, flips, or re-scopes an existing claim. On doubt, CONTRADICTING.
   - Version tell: any `v?MAJOR.MINOR.PATCH` token ADDED in the diff that is absent from the fetched
     local doc text is CONTRADICTING (unsourced), regardless of prose label.
7. For each CONTRADICTING hunk: `Grep` the exact new-claim wording (key terms) against the local
   curl'd doc(s). Found verbatim (or as a closed enumeration that positively excludes an old, now-removed
   item — e.g. a JSON example listing the complete current field set — not mere silence) → CONFIRMED,
   keep. Not found → revert that hunk to its predecessor text directly (already known from the hunk).
   Escape hatch (rare — most hunks resolve by direct grep): a genuinely ambiguous hunk may get one
   `Agent` dispatch (`cc-reference-validator`, given the local doc path) or one `advisor` call before
   deciding — the validator returns `CONFIRMED`, `REJECTED`, or `UNVERIFIABLE` per hunk; only
   `CONFIRMED` (with its quote) keeps the change, the other two revert it the same as a failed grep.
8. If every hunk reverted leaves the file identical to its predecessor except the `verified` date bump,
   revert that date bump too — this file did not actually change.
9. Report a short changelog grouped by the delta-checklist categories. If nothing changed, say so and
   leave the file (except `verified`) untouched.
10. Release (below).

## Workflow mode (more than one target file)

**Engine selection.** Probe once: `ToolSearch(query: "select:Workflow")`. Available → the `Workflow`
engine below (this reference instructing the call is the documented opt-in for using it). Absent, or
`Workflow` rejects the script (meta/API validation error) → do not fight API drift: fall back to
running every target file through **Inline mode's own procedure, one at a time** (no parallelism, but
identical correctness — Inline mode's logic has no dependency on the `Workflow` tool at all).

Enter/confirm a shared worktree once up front — skip if the cwd is already a worktree (matching the
standing background-job convention); if run interactively outside one, call `EnterWorktree` before any
edit. All target files share this one worktree throughout — no per-file `isolation`, since target files
are always disjoint (nothing to isolate against — this also matches the `Workflow` tool's own guidance
to reserve `isolation:'worktree'` for genuine write conflicts).

**Resolve inputs before building the script** — the `Workflow` tool's `args` parameter is unreliable
(this repo's own `implementing.md` records it coming back `undefined` inside the script on two separate
observed occasions, even when passed correctly); inline every value as a JS literal in the script text
instead, exactly as `implementing.md`/`reviewing.md` do for their own scripts:

- `urls` — the deduped URL list for every resolved target's mapped docs (from Source-of-truth mapping).
- `scratchDir` — the scratch dir path (Fetch mechanism above).
- `targets` — `[{name, files, docs}, ...]` for every resolved target file, from target resolution.

Build the script text with these baked in (`const urls = ${JSON.stringify(urls)}`, etc.) before calling
`Workflow`. Fill in `authorPrompt`/`classifyAndVerifyPrompt`/`revertPrompt` from the Inline-mode
procedure above — same delta checklist, same harness-style rules, same version-tell — just executed by
dispatched agents instead of the orchestrator itself. `authorPrompt` must instruct the agent to compute
and return `rawDiff` (`git diff HEAD -- <file>`, via its own `Bash` access) alongside its changelog, and
`classifyAndVerifyPrompt` must pass that `rawDiff` straight through — the validator classifies from the
diff itself, never from a pre-supplied label (same reasoning as Inline mode step 6-7: an authoring pass
that mislabels its own contradicting hunk ADDITIVE must not let the gate silently pass it).

```js
export const meta = {
  name: "update-cc-references-run",
  description:
    "Refresh N cc-reference files: download, per-file author+verify+revert",
  phases: [
    { title: "Download" },
    { title: "Update" },
    { title: "Verify" },
    { title: "Revert" },
    { title: "Report" },
  ],
};

// Inlined by the caller — NOT sourced from `args` (see note above):
const urls = /* deduped URL array, as a JS literal */
const scratchDir = /* scratch dir path, as a JS string literal */
const targets = /* [{name, files, docs}, ...], as a JS array literal */

const ManifestSchema = {
  type: "object",
  additionalProperties: { type: "string" },
};
const AuthorResultSchema = {
  type: "object",
  required: ["file", "rawDiff", "changelog"],
  properties: {
    file: { type: "string" },
    rawDiff: { type: "string" },
    changelog: { type: "string" },
  },
};
// Matches cc-reference-validator's own documented Output contract: a bare
// JSON array, one entry per CONTRADICTING hunk — not an object wrapping it.
const VerdictBatchSchema = {
  type: "array",
  items: {
    type: "object",
    required: ["hunk", "verdict"],
    properties: {
      hunk: { type: "string" },
      verdict: { enum: ["CONFIRMED", "REJECTED", "UNVERIFIABLE"] },
      quote: { type: "string" },
      docPath: { type: "string" },
      confidence: { enum: ["high", "medium", "low"] },
      notes: { type: "string" },
    },
  },
};
const RevertResultSchema = {
  type: "object",
  required: ["target", "reverted", "dateReverted"],
  properties: {
    target: { type: "string" },
    reverted: { type: "array", items: { type: "string" } },
    dateReverted: { type: "boolean" },
  },
};

phase("Download");
const docManifest = await agent(
  `curl these deduped URLs to local files under the given scratch dir (DOCTYPE-contamination check +
   retry + WebSearch-fallback rules from the skill's Fetch mechanism section). Return {url: localAbsolutePath}
   for every URL: ${JSON.stringify(urls)}. Scratch dir: ${scratchDir}.`,
  { schema: ManifestSchema },
);

phase("Update");
const results = await pipeline(
  targets,
  (t) =>
    agent(authorPrompt(t, docManifest), {
      phase: "Update",
      schema: AuthorResultSchema,
    }),
  // Stage 2 does NOT trust stage1's own hunk labels — it re-derives classification itself from
  // authored.rawDiff (the `git diff HEAD -- <file>` text stage1 already computed and returned),
  // the same discipline that actually worked confirming ~120 hunks this session (fresh agents
  // classified independently rather than consuming the authoring agent's self-report).
  (authored, t) =>
    agent(classifyAndVerifyPrompt(authored.rawDiff, docManifest), {
      phase: "Verify",
      agentType: "cc-reference-validator",
      schema: VerdictBatchSchema,
    }),
  (verdicts, t, i) => {
    // `verdicts` is the validator's bare array (VerdictBatchSchema), not an object — no `.verdicts`
    // property to unwrap.
    const bad = verdicts.filter((v) => v.verdict !== "CONFIRMED");
    const lowConfidenceKept = verdicts.filter(
      (v) => v.verdict === "CONFIRMED" && v.confidence === "low",
    );
    if (!bad.length)
      return {
        target: t.name,
        reverted: [],
        dateReverted: false,
        lowConfidenceKept,
      };
    // revertPrompt must also instruct: if `bad` covers every CONTRADICTING hunk and no ADDITIVE
    // hunk survives either, revert the `verified` date bump too (file nets to no real change) —
    // the Workflow-mode equivalent of Inline mode's step 8, which this path doesn't get for free.
    // Pass authored.rawDiff through too — a hunk's bare quote/id alone can be ambiguous or
    // paraphrased; the raw diff lets the revert agent locate the exact hunk unambiguously.
    return agent(revertPrompt(t, bad, authored.rawDiff), {
      phase: "Revert",
      schema: RevertResultSchema,
    }).then((r) => ({ ...r, lowConfidenceKept }));
  },
);

phase("Report");
return { results, docManifest };
```

- `agentType: 'cc-reference-validator'` composes with `schema` per the `Workflow` tool's documented
  behavior.
- Revert stage is a no-op (no dispatch) for any file with zero unconfirmed verdicts — the expected
  common case (this session: 0/120 hunks needed reverting).
- Dispatched agents receive absolute file paths (the reference file's path resolved against the known
  shared-worktree root; the doc manifest's absolute local paths) — this session's 8 parallel dispatches
  already proved this lands edits in the correct worktree.
- After the `Workflow` call returns: aggregate `results` into the provenance report — `file · claim ·
old → new · verdict · docPath/quote · action (kept/reverted)` — list every reverted/blocked item
  explicitly, never drop one silently. Also list every `lowConfidenceKept` entry explicitly (a
  `confidence:"low"` CONFIRMED is kept, not reverted, but flagged for human attention in the report — a
  producer field the gate must not silently ignore). A thrown stage drops that one file to `null` (per
  the tool's own semantics) — report it explicitly as "skipped: `<file>` (`<reason>`)," never silently
  absorbed into "N files updated."

## Notes

- The reference files are written in English to match Claude Code terminology; keep updates in English regardless of conversation language.

## Release (after a successful update — either mode)

This skill is run manually by the user. Drive a release ONLY if a reference file actually changed, and
only once, after either mode (Inline or Workflow) fully completes.

**Precondition: zero unconfirmed contradictions.** Every CONTRADICTING hunk must have resolved CONFIRMED
or been reverted (Inline mode step 7-8 / Workflow mode's Verify+Revert stages) before proceeding.

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
