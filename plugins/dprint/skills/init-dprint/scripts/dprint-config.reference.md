# dprint-config — script reference

**Invoke:** `node ${CLAUDE_SKILL_DIR}/scripts/dprint-config.mjs detect`

## Parameters

| #   | Name | Format   | Required | Notes                                             |
| --- | ---- | -------- | -------- | ------------------------------------------------- |
| 1   | mode | `detect` | yes      | Any other mode, or any further argument, exits 2. |

## Environment

| Var  | Purpose                                                           | Required |
| ---- | ----------------------------------------------------------------- | -------- |
| none | The working directory is the input; all paths are relative to it. | —        |

## Output

Exactly one stdout line of JSON. Diagnostics go to stderr.

```
{"existing":"<cwd-relative path>"|null,"sources":[{"file":"<name>","settings":{...}|null}]}
```

- `existing`: first existing of `dprint.json`, `dprint.jsonc`, `.dprint.json`, `.dprint.jsonc`, `.config/dprint.json`, `.config/dprint.jsonc` (dprint's own lookup order), else `null`.
- `sources`: only files that exist, in order `.editorconfig`, `.gitattributes`, then the Prettier source (`package.json` with a `"prettier"` key, else the first Prettier config file).
- `settings`: only mapped dprint global keys, in the order `lineWidth`, `indentWidth`, `useTabs`, `newLineKind`. `{}` = read but nothing maps; `null` = format not readable (JS/TS/TOML/JSON5 configs, malformed JSON, a shared-config string).
- Mapping: editorconfig `[*]` section only (`max_line_length`, `indent_size` else `tab_width`, `indent_style`, `end_of_line` lf/crlf); gitattributes `*` lines `eol=lf|crlf`; Prettier `printWidth`, `tabWidth`, `useTabs`, `endOfLine` lf/crlf.
- On exit 2: `{"error":"<message>"}`.

## Exit codes

| Code | Meaning | Notes                                                   |
| ---- | ------- | ------------------------------------------------------- |
| 0    | ok      | A malformed source is never an error; it yields `null`. |
| 2    | error   | Usage error or unexpected I/O error.                    |

`detect` is read-only.
