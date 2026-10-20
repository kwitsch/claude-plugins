# dprint-config — script reference

**Invoke:** `node ${CLAUDE_SKILL_DIR}/scripts/dprint-config.mjs detect`

**Invoke:** `node ${CLAUDE_SKILL_DIR}/scripts/dprint-config.mjs write [key=value ...]`

## Parameters

| #   | Name      | Format             | Required | Notes                                                                                                                                                                               |
| --- | --------- | ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | mode      | `detect` / `write` | yes      | Any other mode exits 2. `detect` takes no further argument.                                                                                                                         |
| 2…  | key=value | `key=value`        | no       | `write` only. Keys: `lineWidth`, `indentWidth` (positive integer up to 4294967295), `useTabs` (`true`/`false`), `newLineKind` (`auto`/`crlf`/`lf`/`system`). Each key at most once. |

## Environment

| Var  | Purpose                                                           | Required |
| ---- | ----------------------------------------------------------------- | -------- |
| none | The working directory is the input; all paths are relative to it. | —        |

## Output

Exactly one stdout line of JSON. Diagnostics go to stderr. On exit 2 (both modes): `{"error":"<message>"}`.

**detect:**

```
{"existing":"<cwd-relative path>"|null,"sources":[{"file":"<name>","settings":{...}|null}]}
```

- `existing`: first existing of `dprint.json`, `dprint.jsonc`, `.dprint.json`, `.dprint.jsonc`, `.config/dprint.json`, `.config/dprint.jsonc` (dprint's own lookup order), else `null`.
- `sources`: only files that exist, in order `.editorconfig`, `.gitattributes`, then the Prettier source (`package.json` with a `"prettier"` key, else the first Prettier config file).
- `settings`: only mapped dprint global keys, in the order `lineWidth`, `indentWidth`, `useTabs`, `newLineKind`. `{}` = read but nothing maps; `null` = format not readable (JS/TS/TOML/JSON5 configs, malformed JSON, a shared-config string).
- Mapping: editorconfig `[*]` section only (`max_line_length`, `indent_size` else `tab_width`, `indent_style`, `end_of_line` lf/crlf); gitattributes `*` lines `eol=lf|crlf`; Prettier `printWidth`, `tabWidth`, `useTabs`, `endOfLine` lf/crlf.

**write:** `{"written":".dprint.jsonc"}` (exit 0) or `{"existing":"<path>"}` (exit 3). The file is `{"$schema": "https://dprint.dev/schemas/v0.json", <given keys in the order above>, "plugins": []}`, 2-space indented, trailing newline.

## Exit codes

| Code | Meaning       | Notes                                                                                  |
| ---- | ------------- | -------------------------------------------------------------------------------------- |
| 0    | ok            | A malformed source is never an error for `detect`; it yields `null`.                   |
| 2    | error         | Usage error, invalid `key=value` (nothing written), or unexpected I/O error.           |
| 3    | config exists | `write` only: a dprint config already exists at one of the six paths; nothing written. |

`detect` is read-only. `write` creates only `./.dprint.jsonc`, with exclusive create, after re-checking all six dprint config paths; it never overwrites.
