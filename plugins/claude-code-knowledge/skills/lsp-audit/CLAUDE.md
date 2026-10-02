# CLAUDE.md — claude-code-knowledge/skills/lsp-audit

Mechanics live in `SKILL.md` and `scripts/audit-lsp.reference.md` (script contract, write order, fail-closed cases) — not restated here.

## Boundaries

- Keep all scan/diff/merge/safe-write logic in `scripts/audit-lsp.mjs`; `SKILL.md` only orchestrates and gates.
- Write scope is `<project-root>/.claude/skills/lsp/` plus one deletion outside it: a migrated legacy root `.lsp.json`. Widening it needs a deliberate design decision.
- Additive-only and fail-closed: never remove, rewrite or reorder existing config; write nothing on malformed or conflicting JSON.
- Extensions the catalog does not know stay manual to-dos — never guess a server.

## Catalog (`scripts/lsp-map.json`)

- A server whose `command` is a plain binary (not `npx`) also needs a `tool-map.json` entry and an `install_<id>` recipe in `skills/repository-audit/` (see that skill's `CLAUDE.md`). Without them its detection reports the binary as a manual to-do and `init-dev-environment` cannot install it.
