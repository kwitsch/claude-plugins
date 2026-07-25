# bump-version — script reference

**Invoke:** `bash ${CLAUDE_SKILL_DIR}/bump-version.sh <part>`

## Parameters

| #   | Name | Format                                       | Required | Notes                                                               |
| --- | ---- | -------------------------------------------- | -------- | ------------------------------------------------------------------- |
| 1   | part | one of `major`, `minor`, `patch` (bare word) | yes      | Which semver segment to bump; every segment to its right is zeroed. |

## Environment

| Var      | Purpose                                                                                                                                                       | Required |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `TMPDIR` | Routes the script's internal `mktemp` (lock-sync log capture) into this directory instead of system `/tmp`. Set to the session scratchpad dir when available. | no       |

## Exit codes

| Code | Meaning             | Notes                                                                                                                |
| ---- | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 0    | ok                  | success; prints `file:`/`old:`/`new:`/`sync:` lines                                                                  |
| 2    | usage               | missing, extra, or unrecognized argument (must be exactly one of `major`/`minor`/`patch`)                            |
| 3    | no_version_file     | none of `package.json`, `composer.json`, `pom.xml`, `VERSION` exist in the current directory                         |
| 4    | unparseable_version | version isn't bare `MAJOR.MINOR.PATCH`, or no top-level `"version"` field / project `<version>` tag found            |
| 5    | write_failed        | version file couldn't be written (permissions, read-only filesystem)                                                 |
| 6    | sync_failed         | version already bumped and written; lock-sync command failed (binary missing, non-zero exit) — sync output on stderr |
| 7    | sync_temp_failed    | version already bumped and written; lock-sync couldn't even run (its own `mktemp` call failed)                       |
