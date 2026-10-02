# audit-lsp — script reference

**Invoke:** `node ${CLAUDE_SKILL_DIR}/scripts/audit-lsp.mjs <project-root> [--fix | --apply <exts>]`

## Parameters

| #   | Name         | Format                        | Required       | Notes                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------ | ----------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | project-root | path                          | no             | Defaults to `.`. Resolved to absolute. Audited/written file: `<project-root>/.claude/skills/lsp/.lsp.json`. Plugin manifest: `<project-root>/.claude/skills/lsp/.claude-plugin/plugin.json`, created if absent and never overwritten. A legacy `<project-root>/.lsp.json` (not loaded by Claude Code) is read as additional base config and deleted by any write mode. |
| 2   | mode flag    | `--fix` or `--apply <exts>`   | no             | Absent = read-only audit. `--fix` applies every proposal. `--apply` applies only the listed extensions.                                                                                                                                                                                                                                                                |
| 3   | exts         | comma-separated `.ext` tokens | with `--apply` | e.g. `.py,.go,.css`. Each must match `^\.[A-Za-z0-9]+$` and be a known proposal; anything else is silently dropped. An empty list (`--apply ""`) applies nothing and only migrates a legacy root file.                                                                                                                                                                 |

## Environment

| Var | Purpose                                                         | Required |
| --- | --------------------------------------------------------------- | -------- |
| —   | none; the script only reads/writes files under `<project-root>` | —        |

## Modes

- **audit** (no mode flag): read-only; reads the plugin and legacy root files; never writes or deletes. Emits the audit-plan JSON, exit 0.
- **`--fix`**: apply every proposal; write the plugin files; migrate and delete a legacy root `.lsp.json`; emit apply-summary JSON; exit 0.
- **`--apply <exts>`**: same, named extensions only (validated); emit apply-summary JSON; exit 0.

## Output — audit mode (stdout, one JSON object)

```json
{
  "root": "/abs/path",
  "lspJsonExists": true,
  "legacyRootLspJson": false,
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

`lspJsonExists` refers to the plugin `.lsp.json` (`<project-root>/.claude/skills/lsp/.lsp.json`). `legacyRootLspJson` is `true` when a legacy `<project-root>/.lsp.json` exists. `covered`, `proposals` and `unknown` are computed against the merged base config (plugin servers plus legacy root servers).

## Output — apply mode (`--fix` / `--apply`)

```json
{
  "root": "/abs/path",
  "applied": [".json", ".jsonc"],
  "createdServers": ["jsonls"],
  "mergedIntoServers": [],
  "conflictsSkipped": [],
  "wrote": true,
  "migratedFromRoot": false
}
```

## Exit codes

| Code | Meaning | Notes                                                                                                                                                                                                                                                            |
| ---- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | ok      | Audit plan or apply summary printed to stdout. `wrote: false` when there was nothing to apply.                                                                                                                                                                   |
| 1    | error   | Malformed plugin or legacy root `.lsp.json`, a server id defined differently in both files, I/O error, or post-write readback failure. Fails closed: the legacy root file is deleted only after the plugin write and readback succeed. Diagnostics go to stderr. |

## Behavior notes

- Additive-only: never removes, rewrites, or reorders an existing key; only inserts into `extensionToLanguage` maps or adds new top-level server blocks.
- Coverage is computed across **every** server block's `extensionToLanguage` keys, not just top-level server-id names.
- New server blocks are scoped to exactly the extension(s) actually applied — never pre-populated with other extensions from the same catalog server's family that the caller didn't target.
- Output format is exactly `JSON.stringify(obj, null, 2) + "\n"` (2-space indent, trailing LF).
- Directory prune denylist for the scan: `.git`, `node_modules`, `vendor`, `dist`, `build`, `.claude/worktrees`, `.claude/agent-memory`.
- Extension extraction: last-dot split, lowercased; a file whose basename has no dot or only a leading dot has no extension and is skipped.
- The base config is the plugin file's servers in order, followed by each legacy-root server id the plugin lacks. A server id present in both must be deep-equal (object key order ignored), or the run fails closed (in every mode, audit included).
- A write mode writes when `applied` is non-empty or a legacy root file exists. The order is: create `.claude/skills/lsp/.claude-plugin/` -> `plugin.json` if absent -> `.lsp.json` -> readback (every applied ext and every legacy-root ext resolves) -> delete `<project-root>/.lsp.json`, last.
- When `<project-root>` is itself a plugin (it has `.claude-plugin/plugin.json`), its root `.lsp.json` is live plugin config: it is not treated as legacy, so it is never read as base config, migrated, or deleted (`legacyRootLspJson` is `false`).
- A plugin `.lsp.json` that resolves (symlink) to the same file as the legacy root `.lsp.json` fails closed in every mode, since the final delete would remove the only real copy.
- If the final delete of the legacy root file fails (for example a read-only directory), the run exits 1 after the plugin files were written and the error says so; its config is already in the plugin, so delete the root file manually.
- `wrote` means the plugin `.lsp.json` was written. `migratedFromRoot` means the legacy root file was merged and deleted.
