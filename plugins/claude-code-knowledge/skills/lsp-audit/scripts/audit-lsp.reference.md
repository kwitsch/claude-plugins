# audit-lsp — script reference

**Invoke:** `node ${CLAUDE_SKILL_DIR}/scripts/audit-lsp.mjs <project-root> [--fix | --apply <exts>]`

## Parameters

| #   | Name         | Format                        | Required       | Notes                                                                                                               |
| --- | ------------ | ----------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | project-root | path                          | no             | Defaults to `.`. Resolved to absolute. The audited/written file is `<project-root>/.lsp.json`.                      |
| 2   | mode flag    | `--fix` or `--apply <exts>`   | no             | Absent = read-only audit. `--fix` applies every proposal. `--apply` applies only the listed extensions.             |
| 3   | exts         | comma-separated `.ext` tokens | with `--apply` | e.g. `.py,.go,.css`. Each must match `^\.[A-Za-z0-9]+$` and be a known proposal; anything else is silently dropped. |

## Environment

| Var | Purpose                                                         | Required |
| --- | --------------------------------------------------------------- | -------- |
| —   | none; the script only reads/writes files under `<project-root>` | —        |

## Modes

- **audit** (no mode flag): read-only. Emits the audit-plan JSON, exit 0.
- **`--fix`**: apply every proposal; write `<project-root>/.lsp.json`; emit apply-summary JSON; exit 0.
- **`--apply <exts>`**: apply only the named, validated extensions; write; emit apply-summary JSON; exit 0.

## Output — audit mode (stdout, one JSON object)

```json
{
  "root": "/abs/path",
  "lspJsonExists": true,
  "covered": [".js", ".ts", ".sh"],
  "proposals": [
    {
      "ext": ".json",
      "server": "jsonls",
      "languageId": "json",
      "newServer": true,
      "note": null,
      "fileCount": 214
    }
  ],
  "unknown": [{ "ext": ".md", "fileCount": 190 }],
  "conflicts": []
}
```

## Output — apply mode (`--fix` / `--apply`)

```json
{
  "root": "/abs/path",
  "applied": [".json", ".jsonc"],
  "createdServers": ["jsonls"],
  "mergedIntoServers": [],
  "conflictsSkipped": [],
  "wrote": true
}
```

## Exit codes

| Code | Meaning | Notes                                                                                                                                       |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | ok      | Audit plan or apply summary printed to stdout. `wrote: false` when there was nothing to apply.                                              |
| 1    | error   | Malformed existing `.lsp.json` (fail closed — nothing written), I/O error, or post-write readback assertion failure. Diagnostics on stderr. |

## Behavior notes

- Additive-only: never removes, rewrites, or reorders an existing key; only inserts into `extensionToLanguage` maps or adds new top-level server blocks.
- Coverage is computed across **every** server block's `extensionToLanguage` keys, not just top-level server-id names.
- First-registered-wins: a newly created server block drops any extension already claimed by a different existing server (recorded in `conflictsSkipped`).
- Output format is exactly `JSON.stringify(obj, null, 2) + "\n"` (2-space indent, trailing LF).
- Directory prune denylist for the scan: `.git`, `node_modules`, `vendor`, `dist`, `build`, `.claude/worktrees`, `.claude/agent-memory`.
- Extension extraction: last-dot split, lowercased; a file whose basename has no dot or only a leading dot has no extension and is skipped.
