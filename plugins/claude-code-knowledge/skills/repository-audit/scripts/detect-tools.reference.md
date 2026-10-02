# detect-tools — script reference

**Invoke:** `node ${CLAUDE_SKILL_DIR}/scripts/detect-tools.mjs <project-root> [--write]`

## Parameters

| #   | Name         | Format    | Required | Notes                                                                                                                                                                    |
| --- | ------------ | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | project-root | path      | no       | Defaults to `.`. Resolved to absolute. The first non-`--` argument; the scanned tree and the write target `<project-root>/.claude/skills/init-dev-environment/`.         |
| 2   | mode flag    | `--write` | no       | Absent = read-only audit. `--write` re-detects, then writes the skill only when `tools` is non-empty and `skillExists` is false. Unknown `--flags` are silently ignored. |

## Environment

| Var | Purpose                                                                                                              | Required |
| --- | -------------------------------------------------------------------------------------------------------------------- | -------- |
| —   | none; the script only reads files under `<project-root>` and, with `--write`, writes under `<project-root>/.claude/` | —        |

## Modes

- **audit** (no mode flag): read-only. Emits the detection JSON, exit 0.
- **`--write`**: re-detects; when `tools` is non-empty and `skillExists` is false, writes `<project-root>/.claude/skills/init-dev-environment/{SKILL.md,install.sh}` atomically; emits the detection JSON plus `wrote` and `skillsDirCreated`; exit 0.

## Output — audit mode (stdout, one JSON object)

```json
{
  "root": "/abs/path",
  "tools": [{ "id": "node", "evidence": ["package.json", ".lsp.json: npx"] }],
  "manual": [{ "command": "docker", "evidence": [".mcp.json: docker"] }],
  "skillDir": "/abs/path/.claude/skills/init-dev-environment",
  "skillExists": false
}
```

## Output — `--write` mode

```json
{
  "root": "/abs/path",
  "tools": [{ "id": "node", "evidence": ["package.json", ".lsp.json: npx"] }],
  "manual": [{ "command": "docker", "evidence": [".mcp.json: docker"] }],
  "skillDir": "/abs/path/.claude/skills/init-dev-environment",
  "skillExists": false,
  "wrote": true,
  "skillsDirCreated": false
}
```

`wrote` is false when `tools` is empty or `skillExists` is true; nothing is written then. `skillsDirCreated` is true only when this run created `<project-root>/.claude/skills` (so always false when `wrote` is false). `skillExists` reports the state before the write and is checked with `existsSync`, so an existing empty directory also counts and is left untouched.

## Exit codes

| Code | Meaning | Notes                                                                                                                                                                                                                                                                                                                       |
| ---- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | ok      | Detection JSON printed to stdout, including `wrote: false`.                                                                                                                                                                                                                                                                 |
| 1    | error   | Malformed or non-object `.lsp.json` (root or `.claude/skills/lsp/`) / `.mcp.json` (checked before any write, nothing written); missing or malformed bundled `tool-map.json`; missing bundled template; write, chmod or rename failure (the temp dir is removed, no partial skill directory is left). Diagnostics on stderr. |

## Behavior notes

- Signals: catalog signal-file basenames (`tool-map.json` `files`) anywhere in the pruned tree, recorded as root-relative paths; plus bare `command` names from `.lsp.json` (every server block) at the project root (legacy, no longer loaded by Claude Code) and in `.claude/skills/lsp/` (the project-scope `lsp` plugin `lsp-audit` writes), and from the root `.mcp.json` (every `mcpServers` entry). Config files are read from these fixed paths only, never searched for; entries without a string `command` (http/sse servers) are skipped. Evidence is labelled with the source path, e.g. `.claude/skills/lsp/.lsp.json: gopls`.
- Directory prune denylist for the scan: `.git`, `node_modules`, `vendor`, `dist`, `build`, `.claude/worktrees`, `.claude/agent-memory` (`audit-lsp.mjs`'s denylist) plus `.venv`, `venv`, `.tox`, `site-packages`, `target` — virtualenv and build-output directories hold third-party packages whose own `package.json`/`requirements.txt` would read as a project signal. Symlinks are never followed.
- Token filter: a config command is considered only when it matches `^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$`, so paths, `${...}` variables, spaces and shell metacharacters are dropped. `git`, `bash`, `sh`, `curl` and `claude` are assumed present and never reported. A catalogued command maps to its tool id; any other passing command becomes a `manual` entry. Lookups are `Map`-only.
- Evidence entries are unique, in insertion order (signal files first, then `"<source>: <command>"`), capped at 5 per tool or manual command. `tools` follow the catalog key order; `manual` is sorted by `command`.
- Atomic write: `<project-root>/.claude/.init-dev-environment-XXXXXX` (same filesystem, outside the watched `.claude/skills/`) is filled, set to mode 0755, then renamed to `<project-root>/.claude/skills/init-dev-environment`.
- Output format is exactly `JSON.stringify(obj, null, 2) + "\n"` (2-space indent, trailing LF).

## Bundled templates

- `templates/init-dev-environment/SKILL.md.tmpl` — rendered into `SKILL.md`: `@@TOOLS@@` becomes the space-separated tool ids, `@@MANUAL@@` the comma-separated manual commands (or `none`).
- `templates/init-dev-environment/install.sh` — copied byte-identical.
- repository-audit never executes `install.sh`. The canonical CLI contract of `install.sh` (usage, stdout line tokens, exit codes) is its own header comment, which travels with the generated skill.
