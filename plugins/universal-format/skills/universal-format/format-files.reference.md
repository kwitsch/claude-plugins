# format-files — script reference

**Invoke:** `node ${CLAUDE_SKILL_DIR}/format-files.mjs <listfile>`

## Parameters

| #   | Name     | Format                                           | Required | Notes                                                                                  |
| --- | -------- | ------------------------------------------------ | -------- | -------------------------------------------------------------------------------------- |
| 1   | listfile | path to a newline-delimited file of target paths | yes      | Each line is one file path, resolved against `process.cwd()`. Blank lines are ignored. |

## Environment

| Var | Purpose                                                              | Required |
| --- | -------------------------------------------------------------------- | -------- |
| —   | none; `process.cwd()` is the project root files are resolved against | —        |

## Exit codes

| Code | Meaning | Notes                                                                                                     |
| ---- | ------- | --------------------------------------------------------------------------------------------------------- |
| 0    | ok      | Always on a real run. Prints one `formatted:` / `unchanged:` / `skipped …:` line per file plus a summary. |
| 2    | usage   | No `<listfile>` argument was given.                                                                       |

Per-file status is reported, never thrown: an unsupported extension is `skipped (unsupported)`, a per-file formatter error is `skipped (error: …)`, and a file the plugin's own rules leave alone (`.prettierignore`, excluded path, already-clean) reports `unchanged`. Exclusion/ignore handling is inherited from the imported handlers — the driver reports what they did, it does not re-implement any of it.
