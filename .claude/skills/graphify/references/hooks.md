# graphify reference: commit hook and native CLAUDE.md integration

Load when user asked to install post-commit hook or wire graphify into project's CLAUDE.md.

## For git commit hook

Install post-commit hook that auto-rebuilds graph after every commit. No background process — triggers once per commit, works with any editor.

```bash
graphify hook install    # install
graphify hook uninstall  # remove
graphify hook status     # check
```

After every `git commit`, hook detects changed code files (via `git diff HEAD~1`), re-runs AST extraction, rebuilds `graph.json` and `GRAPH_REPORT.md`. Doc/image changes ignored — run `/graphify --update` manually for those.

Existing post-commit hook: graphify appends, not replaces.

---

## For native CLAUDE.md integration

Run once per project to make graphify always-on in Claude Code sessions:

```bash
graphify claude install
```

Writes `## graphify` section to local `CLAUDE.md`. Instructs Claude to check graph before answering codebase questions, rebuild after code changes. No manual `/graphify` needed in future sessions.

```bash
graphify claude uninstall  # remove the section
```