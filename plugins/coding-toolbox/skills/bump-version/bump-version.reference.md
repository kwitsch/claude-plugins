# bump-version — script reference

**Invoke:** `bash ${CLAUDE_SKILL_DIR}/bump-version.sh <part>`

## Parameters

| #   | Name | Format                                       | Required | Notes                                                               |
| --- | ---- | -------------------------------------------- | -------- | ------------------------------------------------------------------- |
| 1   | part | one of `major`, `minor`, `patch` (bare word) | yes      | Which semver segment to bump; every segment to its right is zeroed. |

## Environment

| Var      | Purpose                                                                                                                                                                                                                                                         | Required |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `TMPDIR` | Routes the script's internal `mktemp` (lock-sync log capture) into this directory instead of system `/tmp`. Set to the session scratchpad dir when available. Unused on the `.claude-plugin/plugin.json` path (no lock-file sync runs there) — harmless to set. | no       |

## Exit codes

| Code | Meaning             | Notes                                                                                                                                                                                                                                                                                                                            |
| ---- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | ok                  | success; prints `file:`/`old:`/`new:`/`sync:` lines                                                                                                                                                                                                                                                                              |
| 2    | usage               | missing, extra, or unrecognized argument (must be exactly one of `major`/`minor`/`patch`)                                                                                                                                                                                                                                        |
| 3    | no_version_file     | no bumpable version file in the current directory — none of `.claude-plugin/plugin.json`, `package.json`, `composer.json`, `pom.xml`, `VERSION` exists; also returned for a plugin-marketplace repo root (`.claude-plugin/marketplace.json` present, no `plugin.json` of its own), whose message names `plugins/<name>/` instead |
| 4    | unparseable_version | version isn't bare `MAJOR.MINOR.PATCH`, or no top-level `"version"` field / project `<version>` tag found — applies to `.claude-plugin/plugin.json` exactly as to `package.json`/`composer.json`                                                                                                                                 |
| 5    | write_failed        | version file couldn't be written (permissions, read-only filesystem), or an internal `kind`/writer mismatch                                                                                                                                                                                                                      |
| 6    | sync_failed         | version already bumped and written; lock-sync command failed (binary missing, non-zero exit) — sync output on stderr                                                                                                                                                                                                             |
| 7    | sync_temp_failed    | version already bumped and written; lock-sync couldn't even run (its own `mktemp` call failed)                                                                                                                                                                                                                                   |
