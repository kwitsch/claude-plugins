# check-dprint — script reference

**Invoke:** `node ${CLAUDE_SKILL_DIR}/check-dprint.mjs`

## Parameters

| #   | Name | Format | Required | Notes                                                       |
| --- | ---- | ------ | -------- | ----------------------------------------------------------- |
| —   | none | —      | —        | Takes no arguments; any argument is a usage error (exit 2). |

## Environment

| Var    | Purpose                                                                                 | Required |
| ------ | --------------------------------------------------------------------------------------- | -------- |
| `PATH` | Searched first, entry by entry, for an executable regular file named `dprint`           | no       |
| `HOME` | Fallback location `$HOME/.dprint/bin/dprint` (where the official installer puts dprint) | no       |

## Output

Exactly one stdout line:

```
status=<ok|missing|outdated|error> version=<X.Y.Z|-> min=<minimum version> path=<absolute path|->
```

`min` is the `MIN_VERSION` constant in `check-dprint.mjs` (its only definition). The version is
read from `<path> --version` (10 s timeout), matched against `^dprint X.Y.Z`, and compared
numerically per component (major, minor, patch). Diagnostics go to stderr.

## Exit codes

| Code | Meaning  | Notes                                                                                                  |
| ---- | -------- | ------------------------------------------------------------------------------------------------------ |
| 0    | ok       | dprint found, version >= `min`                                                                         |
| 10   | missing  | no executable `dprint` on `PATH` nor at `$HOME/.dprint/bin/dprint`                                     |
| 11   | outdated | dprint found, version < `min`                                                                          |
| 2    | error    | usage error, `--version` failed / timed out / exited non-zero, or unparseable output (stderr explains) |

Read-only: the script never installs, updates or modifies anything.
