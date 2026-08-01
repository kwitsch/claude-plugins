# universal-lint

Silently runs each language's standard linter (read-only — never autofixes) on just-written source files after Write/Edit, surfacing any findings as additional context for Claude to fix by hand.

## Install

```
/plugin install universal-lint@kwitsch-plugins
```

## What it does

An async PostToolUse `Write|Edit` command hook (no MCP server — the plugin has exactly one hook) runs the just-written file's standard linter, check-only, for nine languages. The linter runs when its CLI is on `PATH` — or, for `eslint`/`markdownlint-cli2`/`markdownlint`/`stylelint`, via the `npx` fallback (see below); an unavailable linter (no `PATH` CLI and no `npx` fallback), any crash or misconfiguration, an unsupported extension, a file outside the project, or a file under `node_modules/`/`vendor/`/`.git/` is a **silent no-op** — the hook never blocks or degrades the session, and it never modifies the file (that's `universal-format`'s job, not this plugin's — this plugin never passes `--fix`/`--format`/`--write` to anything). When (and only when) the linter reports real findings, the hook returns them as context (delivered on the next turn, since the hook runs asynchronously) so Claude can fix them itself.

This hook is always active once the plugin is installed — there is no toggle. Per-language opt-out is simply not installing that linter.

## Supported linters

| Language              | Extensions                                            | Linter chain (first on `PATH` wins)                           | Scope                                                                                              |
| --------------------- | ----------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Shell                 | `.sh` `.bash`                                         | `shellcheck`                                                  | file                                                                                               |
| Java                  | `.java`                                               | `checkstyle`                                                  | file                                                                                               |
| Kotlin                | `.kt` `.kts`                                          | `ktlint`                                                      | file                                                                                               |
| JS/TS                 | `.js` `.jsx` `.mjs` `.cjs` `.ts` `.tsx` `.mts` `.cts` | `eslint`                                                      | file                                                                                               |
| Python                | `.py` `.pyi`                                          | `ruff check`                                                  | file                                                                                               |
| Go                    | `.go`                                                 | `golangci-lint` → `go vet`                                    | **package directory** — file-level linting would spuriously flag sibling-file symbols as undefined |
| YAML                  | `.yaml` `.yml`                                        | `yamllint`                                                    | file                                                                                               |
| Markdown              | `.md`                                                 | `markdownlint-cli2` → `markdownlint`                          | file                                                                                               |
| CSS/SCSS              | `.css` `.scss`                                        | `stylelint`                                                   | file                                                                                               |
| TypeScript type-check | `.ts` `.tsx` `.mts` `.cts`                            | `tsc --noEmit` (runs independently of the `eslint` row above) | **whole project** — scoped by the nearest `tsconfig.json`                                          |

`eslint`, `markdownlint-cli2`, `markdownlint`, and `stylelint` additionally
run via `npx` when not installed locally (all official npm packages);
`yamllint` has no npm distribution and is `PATH`-only. When a linter is on
`PATH` and `rtk` is also on `PATH`, findings run through `rtk` for more
token-efficient output — same pass/fail verdict either way.

`tsc` gets no `npx` fallback and is cached via `--incremental`/
`--tsBuildInfoFile` under a persistent plugin data directory to keep repeat
whole-project checks fast.

## Java: checkstyle ruleset and detection

`checkstyle` requires an explicit ruleset to run at all. A project's own `checkstyle.xml` / `.checkstyle.xml` / `config/checkstyle/checkstyle.xml` (searched upward from the edited file to the project root) is preferred; otherwise the jar-bundled `/google_checks.xml` is used, with no extraction required.

checkstyle's exit code only counts `error`-severity violations, and `google_checks.xml` (like many real projects' own configs) runs at `warning` severity by default — so its exit code alone can't tell you whether it found anything. Findings are detected from checkstyle's own output instead: it always prints `Starting audit...` first and `Audit done.` last, regardless of violation count; anything left after stripping those two lines is a real finding.

## YAML/Markdown: max line length isn't enforced without a project config

`yamllint` and `markdownlint`/`markdownlint-cli2` both flag lines over 80
characters by default. When a project has no linter config of its own for
that file type (no `.yamllint*`, no `.markdownlint*`), this hook disables just
that one rule so it doesn't flag ordinary long lines the project never opted
into limiting — every other check still runs normally. A project with its own
config is never touched; its line-length choice always wins.

## JSON: not covered (why)

No standalone, actively-maintained JSON linter has a clean exit-code
contract: `jsonlint` (npm) is unmaintained, and its successor
`@prantlf/jsonlint` (like `biome lint`) conflates "invalid JSON" with
"crashed/misconfigured" under the same exit code. `universal-format`'s
`prettier`/`biome` chain already rejects malformed JSON, so format-only
coverage is the honest answer here.
