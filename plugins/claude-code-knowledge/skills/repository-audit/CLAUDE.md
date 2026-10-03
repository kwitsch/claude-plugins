# CLAUDE.md — claude-code-knowledge/skills/repository-audit

Mechanics live in `SKILL.md` and `scripts/detect-tools.reference.md` (script contract, output schemas, atomic write) — not restated here.

## Boundaries

- Reuse `lsp-audit` and `memory-audit` verbatim via the `Skill` tool, sequentially; never re-implement their logic here.
- The structure check is report-only. Its presence bar (root `CLAUDE.md`, `.claude/rules/`) is this skill's own policy, not drawn from `cc-reference`; a missing item becomes a manual to-do pointing at `cc-author`, never auto-generated content.
- `Edit`/`Write` are used only to apply the `memory-audit` manual to-dos (`suggested_fix: null` — leanness trims, scope-split moves) the user selects via `AskUserQuestion` (`--fix` selects all). The only other file creation goes through `scripts/detect-tools.mjs --write`, which writes only `<ROOT>/.claude/skills/init-dev-environment/` and only when it is absent.
- Never run the generated `install.sh` from this skill.

## Catalog and template coupling

- Every `scripts/tool-map.json` id needs an `install_<id>` recipe in `templates/init-dev-environment/install.sh` (bats-enforced). A recipe that needs a prerequisite runtime must also appear in the template's confirm-step prerequisite note.
- Every non-`npx` server in `lsp-audit`'s `lsp-map.json` needs a `tool-map.json` entry, else detection reports its binary as a manual to-do.
- The template renders into a project-level skill outside the plugin: never put `CLAUDE_PLUGIN_ROOT` or dynamic-injection syntax in it (bats-enforced).
