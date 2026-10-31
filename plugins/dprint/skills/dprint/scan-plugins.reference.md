# scan-plugins — script reference

**Invoke:** `node ${CLAUDE_SKILL_DIR}/scan-plugins.mjs`, run from the project root (the session's
working directory).

## Parameters

| #   | Name | Format | Required | Notes                                                       |
| --- | ---- | ------ | -------- | ----------------------------------------------------------- |
| —   | none | —      | —        | Takes no arguments; any argument is a usage error (exit 2). |

## Environment

| Input                 | Purpose                                                                                                                                                                                                                                                   | Required |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `PATH`                | Must contain `git`                                                                                                                                                                                                                                        | yes      |
| working directory     | The project root. Its dprint config is the first of `dprint.json`, `dprint.jsonc`, `.dprint.json`, `.dprint.jsonc`, `.config/dprint.json`, `.config/dprint.jsonc` that exists there, else in the nearest ancestor that has one (never above the git root) | yes      |
| scanned files         | `git ls-files --cached --others --exclude-standard`: tracked plus untracked-but-not-ignored files under the cwd                                                                                                                                           | —        |
| `dprint-plugins.json` | Plugin list next to the script (registry ids, npm package names, file extensions and file names)                                                                                                                                                          | yes      |

## Output

The first stdout line is always:

```
status=<ok|missing|noconfig|error> config=<config file name|-> missing=<count|->
```

`config` is only the config's name relative to the directory holding it (for example `dprint.json` or
`.config/dprint.jsonc`), never a path. A config found above the cwd (up to the git root) is reported on stderr
(`scan-plugins: config found above the cwd: <path>`).

When `status=missing`, it is followed by one line per uncovered file type, most files first (equal
counts sorted by type):

```
type=<.ext|FileName> files=<count> candidates=<id>[,<id>...]
```

Candidates are in preference order (registry order of `dprint-plugins.json`) and are exactly the
names `dprint config add` accepts.

A file type is `.` plus the lower-cased last extension, or the exact file name when it is one of the
`fileNames` in `dprint-plugins.json` (exact names take precedence). Dotfiles and extension-less
files that are not such file names are ignored, and so are types no plugin in `dprint-plugins.json`
formats.

A type is uncovered when at least one plugin in `dprint-plugins.json` formats it and no `plugins`
entry of the config references any of those plugins. Recognized forms: a plugins.dprint.dev URL
(any version or checksum), an `npm:` specifier, or a `node_modules/<package>/` path.

Diagnostics and the `extends` warning go to stderr.

## Exit codes

| Code | Meaning                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | ok: every detected file type with a known plugin is covered                                                                                            |
| 10   | missing: uncovered types listed                                                                                                                        |
| 11   | noconfig: no config file in the cwd or an ancestor up to the git root                                                                                  |
| 2    | error: usage, config unreadable or invalid JSONC, `plugins` not an array, `git ls-files` failed, or `dprint-plugins.json` unreadable (stderr explains) |

## Limitations

- Plugins of `extends` configs are not checked (stderr warning).
- Plugins outside `dprint-plugins.json` (for example `exec`) are unknown, so the types they handle
  may be reported as missing.

Read-only: the script never modifies anything and makes no network access.
