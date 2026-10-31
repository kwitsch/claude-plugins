# run-dprint — script reference

**Invoke:** `node ${CLAUDE_SKILL_DIR}/run-dprint.mjs <check|fmt> ['<scope>']`

## Parameters

| #   | Name         | Format                 | Required | Notes                                                                                                                                                                                                                                                                                       |
| --- | ------------ | ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `check\|fmt` | `check` or `fmt`       | yes      | The dprint subcommand to run.                                                                                                                                                                                                                                                               |
| 2   | `scope`      | one non-empty argument | no       | Passed verbatim to dprint after `--`: a file, directory or glob, relative to the working directory. dprint may treat an explicit path or glob as overriding the config's `includes` (the `excludes` still apply), so it can reach files the config leaves out; not verified by this plugin. |

## Environment

| Var               | Purpose                                                                                                                | Required |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- | -------- |
| `PATH`            | Searched first, entry by entry, for an executable regular file named `dprint`                                          | no       |
| `HOME`            | Fallback location `$HOME/.dprint/bin/dprint` (where the official installer puts dprint)                                | no       |
| working directory | The project directory to check or format; dprint runs here with no file arguments when no scope is given (its subtree) | yes      |

## Output

On a not-set-up gate failure only this stdout line, plus one stderr line telling the user to run `/dprint init` (`/dprint:dprint init`) first:

```
status=notsetup reason=<missing|noconfig>
```

`missing`: no executable `dprint` on `PATH` nor at `$HOME/.dprint/bin/dprint`. `noconfig`: none of `dprint.json`, `dprint.jsonc`, `.dprint.json`, `.dprint.jsonc`, `.config/dprint.json`, `.config/dprint.jsonc` in the working directory or any ancestor up to the git root (the format hook's lookup; dprint's global config does not count).

Otherwise the output is dprint's own stdout/stderr (may contain ANSI colours); it is not parsed.

## Exit codes

| Code  | Meaning           | Notes                                                                                                       |
| ----- | ----------------- | ----------------------------------------------------------------------------------------------------------- |
| 3     | not set up        | `missing` or `noconfig`; dprint was not run                                                                 |
| 2     | error             | usage error, or dprint could not be started / was killed by a signal (stderr explains)                      |
| 0     | success           | dprint finished without findings                                                                            |
| 11    | config error      | dprint could not resolve or parse the config                                                                |
| 12/13 | plugin problem    | dprint could not load or run a plugin; 12 per dprint's documentation, not verified by this plugin's tests   |
| 14    | no files          | no files matched the scope; per dprint's documentation, not verified by this plugin's tests                 |
| 20    | unformatted files | `check` found files that are not formatted; per dprint's documentation, not verified by this plugin's tests |
| other | dprint error      | any other non-zero code is dprint's own; its output explains                                                |

`check` is read-only; `fmt` rewrites files in place.
