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

| Code | Meaning | Notes                                                                                                                                    |
| ---- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | ok      | Always on a real run. Prints one block per tool run, then `universal-lint: N block(s) with findings.`; or `universal-lint: no findings.` |
| 2    | usage   | No `<listfile>` argument was given.                                                                                                      |

Repo-root-relative git paths (`gh pr diff --name-only`, `git status --porcelain`, `git diff` without `--relative`) must be made absolute (or cwd-relative) before they are listed; a path that does not exist under `process.cwd()` is dropped without a message.

Read-only: the driver only reports findings — it never runs any autofix path. Files outside `process.cwd()`, excluded paths, unsupported extensions (`.json` included), and clean files contribute nothing to the report (the handler returns nothing for them); per-file errors fail open and are dropped. Guard/exclusion behavior is inherited from `lintFilesHandler`, not re-implemented here.

Output contract (inherited from `lintFilesHandler`): files sharing a tool, its binary, spawn cwd and config-derived arguments are linted in one run (at most 100 files; go/cargo once per package/crate), tsc once per tsconfig. Each run with issues prints one block `universal-lint: <tool> found issues in <targets>:` followed by the tool's own output. The header names every file of the run, including files the tool found clean (the tool's own output says which have findings). Each block is truncated on its own, at 4,000 characters per file of the run (a batch of 10 files may print 40,000; the tsc block stays at 4,000); there is no outer cap over the joined report.
