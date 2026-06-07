# Graph Report - .  (2026-06-07)

## Corpus Check
- Corpus is ~28,792 words - fits in a single context window. You may not need a graph.

## Summary
- 277 nodes · 333 edges · 29 communities (23 shown, 6 thin omitted)
- Extraction: 93% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 21 edges (avg confidence: 0.87)
- Token cost: 194,808 input · 0 output

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

## God Nodes (most connected - your core abstractions)
1. `userConfig` - 12 edges
2. `new-pr skill` - 10 edges
3. `cctools_scan_command (orchestration)` - 9 edges
4. `ctx_* tool bootstrap pattern` - 8 edges
5. `install-cctools.sh (idempotent installer)` - 7 edges
6. `session-start.sh (SessionStart hook)` - 7 edges
7. `_rewrite (quote-aware command scanner)` - 7 edges
8. `Reviewer findings JSON contract` - 6 edges
9. `cctools_bin (resolve binary path)` - 6 edges
10. `cctools_asset (release asset name)` - 6 edges

## Surprising Connections (you probably didn't know these)
- `Hermetic Test Principle (no network, stubbed CLIs)` --conceptually_related_to--> `CCTOOLS_ENC_CACHE (per-run encoding memo)`  [AMBIGUOUS]
  test/CLAUDE.md → plugins/cctools-edit/hooks/lib.sh
- `Test workflow (bats matrix)` --references--> `claude-plugins-tests npm package`  [INFERRED]
  .github/workflows/test.yml → package.json
- `version-consistency merge guard` --references--> `branch-management plugin manifest`  [INFERRED]
  .github/workflows/ci.yml → plugins/branch-management/.claude-plugin/plugin.json
- `Tag-on-version-bump workflow` --references--> `branch-management plugin manifest`  [EXTRACTED]
  .github/workflows/tag-on-version-bump.yml → plugins/branch-management/.claude-plugin/plugin.json
- `Version Single-Source-of-Truth (plugin.json only)` --conceptually_related_to--> `cctools-edit Plugin`  [INFERRED]
  .claude/skills/create-plugin/SKILL.md → plugins/cctools-edit/.claude-plugin/plugin.json

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Parallel reviewer findings flow** — agents_claude_reviewer_claude_reviewer, agents_codex_reviewer_codex_reviewer, agents_copilot_reviewer_copilot_reviewer, agents_coderabbit_reviewer_coderabbit_reviewer, agents_review_fixer_review_fixer, new_pr_skill_new_pr [EXTRACTED 0.95]
- **Findings JSON contract implementers** — agents_claude_reviewer_claude_reviewer, agents_codex_reviewer_codex_reviewer, agents_copilot_reviewer_copilot_reviewer, agents_coderabbit_reviewer_coderabbit_reviewer, findings_json_contract [INFERRED 0.85]
- **context-mode ctx_* bootstrap agents** — agents_ci_monitor_ci_monitor, agents_claude_reviewer_claude_reviewer, agents_review_fixer_review_fixer, agents_graphify_agent_graphify_agent, ctx_bootstrap_pattern [EXTRACTED 0.90]
- **cctools-edit Bash-guard scan pipeline** — guard_bash_cctools_scan_command, guard_bash_cctools_strip, guard_bash_cctools_detect_segment, guard_bash_cctools_detect_bare_cat, guard_bash_cctools_consider, lib_cctools_is_legacy_file [EXTRACTED 1.00]
- **cc-tools platform/asset/path resolution helpers** — lib_cctools_goos, lib_cctools_goarch, lib_cctools_ext, lib_cctools_asset, lib_cctools_download_url, lib_cctools_bin [EXTRACTED 0.95]
- **PreToolUse:Bash git-commit-intercepting hook plugins** — sign_commits_rewrite, deny_coauthor_deny_hook, git_sign_key_plugin, no_co_authored_plugin [INFERRED 0.75]

## Communities (29 total, 6 thin omitted)

### Community 0 - "userConfig Schema Fields"
Cohesion: 0.06
Nodes (36): default, description, title, type, default, description, title, type (+28 more)

### Community 1 - "Bash Guard Pipeline"
Cohesion: 0.13
Nodes (27): bash-guard-corpus.json (84 deny/allow cases), Fail-Open Design Principle (cctools-edit), cctools-edit hooks.json (registration), JSON Runtime Fallback (jq -> node -> bun), Precision-Over-Recall Guard Bias, cctools_collect (HITS dedup), cctools_consider, cctools_detect_bare_cat (+19 more)

### Community 2 - "Plugin Marketplace Conventions"
Cohesion: 0.09
Nodes (26): cc-tools Binary (devslimbr/cc-tools), cc-tools Precedence over context-mode Sandbox, Legacy Encoding Preservation (Latin-1/Win-1252), cctools-edit Plugin, check-sign-key.sh (SessionStart warn hook), metadata.pluginRoot Broken in Claude Code (#61224/#64431), create-plugin Skill, Version Single-Source-of-Truth (plugin.json only) (+18 more)

### Community 3 - "NPM Package Metadata"
Cohesion: 0.08
Nodes (24): author, bugs, url, description, devDependencies, bats, bats-assert, bats-support (+16 more)

### Community 4 - "Branch-Management Subagents"
Cohesion: 0.15
Nodes (20): branch-agent subagent, ci-monitor subagent, claude-reviewer subagent, coderabbit-reviewer subagent, codex-reviewer subagent, copilot-reviewer subagent, graphify-agent subagent, review-fixer subagent (+12 more)

### Community 5 - "CI Marketplace Validation"
Cohesion: 0.13
Nodes (18): CI workflow, validate-marketplace job, version-consistency merge guard, Marketplace CLAUDE.md conventions, pluginRoot avoidance convention, Plugin version single source of truth, allowCrossMarketplaceDependenciesOn, description (+10 more)

### Community 6 - "Review Scripts & Hardening"
Cohesion: 0.24
Nodes (10): branch-management plugin design, Copilot login heuristic, Copilot three-layer read-only hardening, git-shim read-only git facade, coderabbit-review.sh script, codex-review.sh script, copilot-review.sh script, has_copilot_login() (+2 more)

### Community 7 - "Guard-Bash Scan Functions"
Cohesion: 0.35
Nodes (11): cctools_collect(), cctools_consider(), cctools_detect_bare_cat(), cctools_detect_segment(), cctools_is_literal_target(), cctools_scan_command(), cctools_strip(), hd_pop() (+3 more)

### Community 9 - "Plugin Manifest"
Cohesion: 0.29
Nodes (6): dependencies, author, name, description, name, version

### Community 10 - "Heredoc/Quote Stripping"
Cohesion: 0.33
Nodes (6): bash 3.2 Portability Constraint, Sentinel (\x01) De-Quoting Transform, cctools_strip (two-pass orchestrator), hd_pop (heredoc queue pop), strip_heredocs (Pass A), strip_quotes_subs (Pass B)

### Community 11 - "Commit Signing Rewriter"
Cohesion: 0.60
Nodes (5): _is_cmd_start(), _is_commit_invocation(), _rewrite(), _skip_token(), sign-commits.sh script

### Community 12 - "Plugin Manifest"
Cohesion: 0.33
Nodes (5): author, name, description, name, version

### Community 13 - "Plugin Manifest"
Cohesion: 0.33
Nodes (5): author, name, description, name, version

### Community 14 - "Plugin Manifest"
Cohesion: 0.33
Nodes (5): author, name, description, name, version

### Community 15 - "CodeRabbit CI Setting"
Cohesion: 0.40
Nodes (5): default, description, title, type, coderabbit_ci_comments

### Community 16 - "Graphify Branch Setting"
Cohesion: 0.40
Nodes (5): default, description, title, type, graphify_branch_update

### Community 17 - "Graphify PR Setting"
Cohesion: 0.40
Nodes (5): default, description, title, type, graphify_pr_update

### Community 18 - "Copilot Review Setting"
Cohesion: 0.40
Nodes (5): default, description, title, type, review_copilot

### Community 19 - "cc-tools Installer"
Cohesion: 0.83
Nodes (3): download(), log(), install-cctools.sh script

### Community 20 - "Hooks Registration"
Cohesion: 0.50
Nodes (3): hooks, PreToolUse, SessionStart

### Community 21 - "Hooks Registration"
Cohesion: 0.50
Nodes (3): hooks, PreToolUse, SessionStart

### Community 23 - "Bats Test Workflow"
Cohesion: 0.67
Nodes (3): claude-plugins-tests npm package, Test gate aggregate check, Test workflow (bats matrix)

## Ambiguous Edges - Review These
- `CCTOOLS_ENC_CACHE (per-run encoding memo)` → `Hermetic Test Principle (no network, stubbed CLIs)`  [AMBIGUOUS]
  test/CLAUDE.md · relation: conceptually_related_to

## Knowledge Gaps
- **107 isolated node(s):** `name`, `name`, `email`, `description`, `version` (+102 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `CCTOOLS_ENC_CACHE (per-run encoding memo)` and `Hermetic Test Principle (no network, stubbed CLIs)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `userConfig` connect `userConfig Schema Fields` to `Plugin Manifest`, `CodeRabbit CI Setting`, `Graphify Branch Setting`, `Graphify PR Setting`, `Copilot Review Setting`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `cctools_scan_command (orchestration)` connect `Bash Guard Pipeline` to `Heredoc/Quote Stripping`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `ctx_* tool bootstrap pattern` connect `Branch-Management Subagents` to `CI Marketplace Validation`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **What connects `name`, `name`, `email` to the rest of the system?**
  _113 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `userConfig Schema Fields` be split into smaller, more focused modules?**
  _Cohesion score 0.05555555555555555 - nodes in this community are weakly interconnected._
- **Should `Bash Guard Pipeline` be split into smaller, more focused modules?**
  _Cohesion score 0.13105413105413105 - nodes in this community are weakly interconnected._