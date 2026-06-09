# Graph Report - claude-plugins  (2026-06-09)

## Corpus Check
- 62 files · ~38,460 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 567 nodes · 680 edges · 76 communities (62 shown, 14 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 21 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `71c87c4a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_userConfig Schema Fields|userConfig Schema Fields]]
- [[_COMMUNITY_Bash Guard Pipeline|Bash Guard Pipeline]]
- [[_COMMUNITY_Plugin Marketplace Conventions|Plugin Marketplace Conventions]]
- [[_COMMUNITY_NPM Package Metadata|NPM Package Metadata]]
- [[_COMMUNITY_Branch-Management Subagents|Branch-Management Subagents]]
- [[_COMMUNITY_CI Marketplace Validation|CI Marketplace Validation]]
- [[_COMMUNITY_Review Scripts & Hardening|Review Scripts & Hardening]]
- [[_COMMUNITY_Guard-Bash Scan Functions|Guard-Bash Scan Functions]]
- [[_COMMUNITY_Platform Asset Resolution|Platform Asset Resolution]]
- [[_COMMUNITY_Plugin Manifest|Plugin Manifest]]
- [[_COMMUNITY_HeredocQuote Stripping|Heredoc/Quote Stripping]]
- [[_COMMUNITY_Commit Signing Rewriter|Commit Signing Rewriter]]
- [[_COMMUNITY_Plugin Manifest|Plugin Manifest]]
- [[_COMMUNITY_Plugin Manifest|Plugin Manifest]]
- [[_COMMUNITY_Plugin Manifest|Plugin Manifest]]
- [[_COMMUNITY_CodeRabbit CI Setting|CodeRabbit CI Setting]]
- [[_COMMUNITY_Graphify Branch Setting|Graphify Branch Setting]]
- [[_COMMUNITY_Graphify PR Setting|Graphify PR Setting]]
- [[_COMMUNITY_Copilot Review Setting|Copilot Review Setting]]
- [[_COMMUNITY_cc-tools Installer|cc-tools Installer]]
- [[_COMMUNITY_Hooks Registration|Hooks Registration]]
- [[_COMMUNITY_Hooks Registration|Hooks Registration]]
- [[_COMMUNITY_Session Start Hook|Session Start Hook]]
- [[_COMMUNITY_Bats Test Workflow|Bats Test Workflow]]
- [[_COMMUNITY_Hooks Registration|Hooks Registration]]
- [[_COMMUNITY_Sign-Key Check Hook|Sign-Key Check Hook]]
- [[_COMMUNITY_Co-Author Deny Hook|Co-Author Deny Hook]]
- [[_COMMUNITY_Edit Redirect Hook|Edit Redirect Hook]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]

## God Nodes (most connected - your core abstractions)
1. `userConfig` - 16 edges
2. `Creating a New Marketplace Plugin` - 12 edges
3. `/graphify` - 11 edges
4. `What You Must Do When Invoked` - 11 edges
5. `new-pr skill` - 10 edges
6. `cctools_scan_command (orchestration)` - 9 edges
7. `graphify reference: extra exports and benchmark` - 8 edges
8. `branch-management` - 8 edges
9. `cctools-edit` - 8 edges
10. `git-sign-key` - 8 edges

## Surprising Connections (you probably didn't know these)
- `Version Single-Source-of-Truth (plugin.json only)` --conceptually_related_to--> `cctools-edit Plugin`  [INFERRED]
  .claude/skills/create-plugin/SKILL.md → plugins/cctools-edit/.claude-plugin/plugin.json
- `Hermetic Test Principle (no network, stubbed CLIs)` --conceptually_related_to--> `CCTOOLS_ENC_CACHE (per-run encoding memo)`  [AMBIGUOUS]
  test/CLAUDE.md → plugins/cctools-edit/hooks/lib.sh
- `Test workflow (bats matrix)` --references--> `claude-plugins-tests npm package`  [INFERRED]
  .github/workflows/test.yml → package.json
- `version-consistency merge guard` --references--> `branch-management plugin manifest`  [INFERRED]
  .github/workflows/ci.yml → plugins/branch-management/.claude-plugin/plugin.json
- `Tag-on-version-bump workflow` --references--> `branch-management plugin manifest`  [EXTRACTED]
  .github/workflows/tag-on-version-bump.yml → plugins/branch-management/.claude-plugin/plugin.json

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Parallel reviewer findings flow** — agents_claude_reviewer_claude_reviewer, agents_codex_reviewer_codex_reviewer, agents_copilot_reviewer_copilot_reviewer, agents_coderabbit_reviewer_coderabbit_reviewer, agents_review_fixer_review_fixer, new_pr_skill_new_pr [EXTRACTED 0.95]
- **Findings JSON contract implementers** — agents_claude_reviewer_claude_reviewer, agents_codex_reviewer_codex_reviewer, agents_copilot_reviewer_copilot_reviewer, agents_coderabbit_reviewer_coderabbit_reviewer, findings_json_contract [INFERRED 0.85]
- **context-mode ctx_* bootstrap agents** — agents_ci_monitor_ci_monitor, agents_claude_reviewer_claude_reviewer, agents_review_fixer_review_fixer, agents_graphify_agent_graphify_agent, ctx_bootstrap_pattern [EXTRACTED 0.90]
- **cctools-edit Bash-guard scan pipeline** — guard_bash_cctools_scan_command, guard_bash_cctools_strip, guard_bash_cctools_detect_segment, guard_bash_cctools_detect_bare_cat, guard_bash_cctools_consider, lib_cctools_is_legacy_file [EXTRACTED 1.00]
- **cc-tools platform/asset/path resolution helpers** — lib_cctools_goos, lib_cctools_goarch, lib_cctools_ext, lib_cctools_asset, lib_cctools_download_url, lib_cctools_bin [EXTRACTED 0.95]
- **PreToolUse:Bash git-commit-intercepting hook plugins** — sign_commits_rewrite, deny_coauthor_deny_hook, git_sign_key_plugin, no_co_authored_plugin [INFERRED 0.75]

## Communities (76 total, 14 thin omitted)

### Community 0 - "userConfig Schema Fields"
Cohesion: 0.40
Nodes (5): default, description, title, type, ci_monitor

### Community 1 - "Bash Guard Pipeline"
Cohesion: 0.13
Nodes (27): bash-guard-corpus.json (84 deny/allow cases), Fail-Open Design Principle (cctools-edit), cctools-edit hooks.json (registration), JSON Runtime Fallback (jq -> node -> bun), Precision-Over-Recall Guard Bias, cctools_collect (HITS dedup), cctools_consider, cctools_detect_bare_cat (+19 more)

### Community 2 - "Plugin Marketplace Conventions"
Cohesion: 0.08
Nodes (29): bash 3.2 Portability Constraint, cc-tools Binary (devslimbr/cc-tools), cc-tools Precedence over context-mode Sandbox, Legacy Encoding Preservation (Latin-1/Win-1252), cctools-edit Plugin, Sentinel (\x01) De-Quoting Transform, check-sign-key.sh (SessionStart warn hook), deny-coauthor.sh (PreToolUse Bash deny) (+21 more)

### Community 3 - "NPM Package Metadata"
Cohesion: 0.12
Nodes (24): author, bugs, url, description, devDependencies, bats, bats-assert, bats-support (+16 more)

### Community 4 - "Branch-Management Subagents"
Cohesion: 0.14
Nodes (21): branch-agent subagent, ci-monitor subagent, claude-reviewer subagent, coderabbit-reviewer subagent, codex-reviewer subagent, copilot-reviewer subagent, graphify-agent subagent, review-fixer subagent (+13 more)

### Community 5 - "CI Marketplace Validation"
Cohesion: 0.15
Nodes (18): CI workflow, validate-marketplace job, version-consistency merge guard, Marketplace CLAUDE.md conventions, pluginRoot avoidance convention, Plugin version single source of truth, allowCrossMarketplaceDependenciesOn, description (+10 more)

### Community 6 - "Review Scripts & Hardening"
Cohesion: 0.08
Nodes (23): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+15 more)

### Community 7 - "Guard-Bash Scan Functions"
Cohesion: 0.44
Nodes (11): cctools_collect(), cctools_consider(), cctools_detect_bare_cat(), cctools_detect_segment(), cctools_is_literal_target(), cctools_scan_command(), cctools_strip(), hd_pop() (+3 more)

### Community 8 - "Platform Asset Resolution"
Cohesion: 0.30
Nodes (10): cctools_asset(), cctools_bin(), cctools_download_url(), cctools_exe(), cctools_ext(), cctools_goarch(), cctools_goos(), cctools_home() (+2 more)

### Community 9 - "Plugin Manifest"
Cohesion: 0.39
Nodes (6): dependencies, author, name, description, name, version

### Community 10 - "Heredoc/Quote Stripping"
Cohesion: 0.13
Nodes (13): metadata.pluginRoot Broken in Claude Code (#61224/#64431), Checklist, Creating a New Marketplace Plugin, Repository layout (recap), Step 1 — Gather inputs, Step 2 — Validate the name, Step 3 — Scaffold the plugin directory, Step 4 — Scaffold docs (+5 more)

### Community 11 - "Commit Signing Rewriter"
Cohesion: 0.67
Nodes (5): _is_cmd_start(), _is_commit_invocation(), _rewrite(), _skip_token(), sign-commits.sh script

### Community 12 - "Plugin Manifest"
Cohesion: 0.43
Nodes (5): author, name, description, name, version

### Community 13 - "Plugin Manifest"
Cohesion: 0.43
Nodes (5): author, name, description, name, version

### Community 14 - "Plugin Manifest"
Cohesion: 0.43
Nodes (5): author, name, description, name, version

### Community 15 - "CodeRabbit CI Setting"
Cohesion: 0.40
Nodes (5): default, description, title, type, coderabbit_ci_comments

### Community 16 - "Graphify Branch Setting"
Cohesion: 0.40
Nodes (5): default, description, title, type, graphify_branch_update

### Community 17 - "Graphify PR Setting"
Cohesion: 0.33
Nodes (6): default, description, title, type, userConfig, graphify_pr_update

### Community 18 - "Copilot Review Setting"
Cohesion: 0.40
Nodes (5): default, description, title, type, review_copilot

### Community 19 - "cc-tools Installer"
Cohesion: 0.80
Nodes (3): download(), log(), install-cctools.sh script

### Community 20 - "Hooks Registration"
Cohesion: 0.40
Nodes (3): hooks, PreToolUse, SessionStart

### Community 21 - "Hooks Registration"
Cohesion: 0.40
Nodes (3): hooks, PreToolUse, SessionStart

### Community 23 - "Bats Test Workflow"
Cohesion: 0.67
Nodes (3): claude-plugins-tests npm package, Test gate aggregate check, Test workflow (bats matrix)

### Community 29 - "Community 29"
Cohesion: 0.15
Nodes (11): Alternative SSH agents (1Password, Secretive, …), git-sign-key, Install, Notes & limitations, Option A — create a dedicated signing key (recommended), Option B — reuse an existing key, Register the public key for the "Verified" badge, Security notes (+3 more)

### Community 30 - "Community 30"
Cohesion: 0.20
Nodes (8): Agents, branch-management, Breaking change in v3.0.0, Configuration, Dependencies, Review CLIs (all optional), Scripts, Skills

### Community 31 - "Community 31"
Cohesion: 0.22
Nodes (7): Caveats, cctools-edit, Configuration, Fail-open behaviour, Install, What it does, Working alongside context-mode

### Community 32 - "Community 32"
Cohesion: 0.22
Nodes (7): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 33 - "Community 33"
Cohesion: 0.25
Nodes (6): Behavior / key rules, CLAUDE.md — cctools-edit, Components, Interaction with context-mode (and other sandbox/processing plugins), Known limitations (by design — precision over recall, fail-open), Tests

### Community 34 - "Community 34"
Cohesion: 0.48
Nodes (5): Execution, Exit-code mapping, Parsing, Reading the ctx_execute result, Result contract

### Community 35 - "Community 35"
Cohesion: 0.48
Nodes (5): Execution, Exit-code mapping, Parsing, Reading the ctx_execute result, Result contract

### Community 36 - "Community 36"
Cohesion: 0.48
Nodes (5): Execution, Exit-code mapping, Parsing, Reading the ctx_execute result, Result contract

### Community 37 - "Community 37"
Cohesion: 0.25
Nodes (6): Git context, Monitor until green, Preconditions, Review rounds, Submit, Turn the current branch into a reviewed PR/MR

### Community 38 - "Community 38"
Cohesion: 0.29
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 39 - "Community 39"
Cohesion: 0.53
Nodes (4): Commit step (only when `commit: yes` AND status is `updated`), Execution, Exit-code mapping, Result contract

### Community 40 - "Community 40"
Cohesion: 0.48
Nodes (5): Input, Memory, Result contract, Rules, Tooling

### Community 41 - "Community 41"
Cohesion: 0.33
Nodes (4): Behavior, CLAUDE.md — branch-management, Conventions, Tests

### Community 42 - "Community 42"
Cohesion: 0.33
Nodes (3): Conventions, graphify, Layout

### Community 43 - "Community 43"
Cohesion: 0.40
Nodes (5): default, description, title, type, context_index

### Community 44 - "Community 44"
Cohesion: 0.40
Nodes (5): default, description, title, type, graphify_force_create

### Community 45 - "Community 45"
Cohesion: 0.40
Nodes (5): default, description, title, type, graphify_pr_commit

### Community 46 - "Community 46"
Cohesion: 0.40
Nodes (5): default, description, title, type, graphify_user_files

### Community 47 - "Community 47"
Cohesion: 0.40
Nodes (5): default, description, title, type, review_claude

### Community 48 - "Community 48"
Cohesion: 0.40
Nodes (5): default, description, title, type, review_coderabbit

### Community 49 - "Community 49"
Cohesion: 0.40
Nodes (5): default, description, title, type, review_codex

### Community 50 - "Community 50"
Cohesion: 0.33
Nodes (4): CLAUDE.md — plugins/, Feature toggles (userConfig), Hooks, Structure

### Community 51 - "Community 51"
Cohesion: 0.25
Nodes (6): Add a plugin, claude-plugins, Configure plugins, Install, Plugins, Use the marketplace

### Community 52 - "Community 52"
Cohesion: 0.60
Nodes (3): Result contract, Steps, Tooling

### Community 53 - "Community 53"
Cohesion: 0.60
Nodes (3): Result contract, Steps, Tooling

### Community 54 - "Community 54"
Cohesion: 0.53
Nodes (4): Memory suppression, Result contract, Scope, Tooling

### Community 55 - "Community 55"
Cohesion: 0.40
Nodes (3): Behavior, CLAUDE.md — git-sign-key, Tests

### Community 56 - "Community 56"
Cohesion: 0.40
Nodes (3): Behavior, CLAUDE.md — no-co-authored, Tests

### Community 57 - "Community 57"
Cohesion: 0.40
Nodes (3): Install, no-co-authored, What it does

### Community 58 - "Community 58"
Cohesion: 0.40
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 59 - "Community 59"
Cohesion: 0.40
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 60 - "Community 60"
Cohesion: 0.40
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

### Community 61 - "Community 61"
Cohesion: 0.40
Nodes (3): CLAUDE.md — test/, Conventions, Run

### Community 68 - "Community 68"
Cohesion: 0.43
Nodes (6): Argument and config resolution, Base divergence check, Git context, Quota check, Report, Review loop

### Community 69 - "Community 69"
Cohesion: 0.40
Nodes (5): default, description, title, type, ci_watch_timeout

### Community 70 - "Community 70"
Cohesion: 0.40
Nodes (5): default, description, title, type, review_max_rounds

### Community 74 - "Community 74"
Cohesion: 0.20
Nodes (10): branch-management plugin design, Copilot login heuristic, Copilot three-layer read-only hardening, git-shim read-only git facade, coderabbit-review.sh script, codex-review.sh script, copilot-review.sh script, has_copilot_login() (+2 more)

## Ambiguous Edges - Review These
- `CCTOOLS_ENC_CACHE (per-run encoding memo)` → `Hermetic Test Principle (no network, stubbed CLIs)`  [AMBIGUOUS]
  test/CLAUDE.md · relation: conceptually_related_to

## Knowledge Gaps
- **188 isolated node(s):** `name`, `email`, `PreToolUse`, `doc`, `test` (+183 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `CCTOOLS_ENC_CACHE (per-run encoding memo)` and `Hermetic Test Principle (no network, stubbed CLIs)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `userConfig` connect `Graphify PR Setting` to `userConfig Schema Fields`, `Community 69`, `Community 70`, `Plugin Manifest`, `Community 43`, `Community 44`, `Community 45`, `Community 46`, `CodeRabbit CI Setting`, `Graphify Branch Setting`, `Community 47`, `Community 48`, `Community 49`, `Copilot Review Setting`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `cctools_scan_command (orchestration)` connect `Bash Guard Pipeline` to `Plugin Marketplace Conventions`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **What connects `name`, `email`, `PreToolUse` to the rest of the system?**
  _194 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Bash Guard Pipeline` be split into smaller, more focused modules?**
  _Cohesion score 0.13105413105413105 - nodes in this community are weakly interconnected._
- **Should `Plugin Marketplace Conventions` be split into smaller, more focused modules?**
  _Cohesion score 0.0812807881773399 - nodes in this community are weakly interconnected._
- **Should `NPM Package Metadata` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._