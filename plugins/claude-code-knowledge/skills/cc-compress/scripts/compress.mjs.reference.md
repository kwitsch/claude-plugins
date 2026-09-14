# compress.mjs — script reference

**Invoke:** `node ${CLAUDE_SKILL_DIR}/scripts/compress.mjs "<absolute-filepath>" "<backup-root>" [--confirmed]`

## Parameters

| #   | Name        | Format                       | Required | Notes                                                                                                          |
| --- | ----------- | ---------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | filepath    | absolute path to a `.md`     | yes      | The markdown file to compress in place.                                                                        |
| 2   | backup-root | absolute path to a directory | yes      | Session-temp directory receiving the pre-compression backup; never the source file's own directory.            |
| 3   | mode flag   | `--confirmed`                | no       | Proceeds when the target is untracked or has uncommitted changes (the exit-3 gate); position-independent flag. |

## Environment

| Var | Purpose                                                                                                        | Required |
| --- | -------------------------------------------------------------------------------------------------------------- | -------- |
| —   | none read directly; the script shells out to `claude --print --model sonnet` (must be on `PATH`, 120s timeout) | —        |

## Exit codes

| Code | Meaning           | Notes                                                                                                                        |
| ---- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 0    | ok or clean skip  | Compressed and backed up, or skipped (not a markdown file); skip is stated on stdout.                                        |
| 1    | usage/refusal/I-O | Missing args, sensitive filename, empty file, existing/concurrent backup, `claude` CLI missing or failed, or I/O failure.    |
| 2    | validation failed | Compression result failed validation after the retry; source file untouched.                                                 |
| 3    | confirmation gate | Target untracked or dirty — session-temp backup would be the only rollback path; nothing touched. Re-run with `--confirmed`. |
