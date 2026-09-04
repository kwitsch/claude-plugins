# lint-files — script reference

**Invoke:** `node ${CLAUDE_SKILL_DIR}/lint-files.mjs <listfile>`

## Parameters

| #   | Name     | Format                                           | Required | Notes                                                                                  |
| --- | -------- | ------------------------------------------------ | -------- | -------------------------------------------------------------------------------------- |
| 1   | listfile | path to a newline-delimited file of target paths | yes      | Each line is one file path, resolved against `process.cwd()`. Blank lines are ignored. |

## Environment

| Var | Purpose                                                                              | Required |
| --- | ------------------------------------------------------------------------------------ | -------- |
| —   | none; `process.cwd()` is the project root, which must contain each file to be linted | —        |

## Exit codes

| Code | Meaning | Notes                                                                                          |
| ---- | ------- | ---------------------------------------------------------------------------------------------- |
| 0    | ok      | Always on a real run. Prints one aggregated findings report, or `universal-lint: no findings.` |
| 2    | usage   | No `<listfile>` argument was given.                                                            |

Read-only: the driver only reports findings — it never runs any autofix path. Files outside `process.cwd()`, excluded paths, unsupported extensions (`.json` included), and clean files contribute nothing to the report (the handler returns nothing for them); per-file errors fail open and are dropped. Guard/exclusion behavior is inherited from `lintFileHandler`, not re-implemented here.
