# universal-lint

Silently runs each language's standard linter (read-only — never autofixes) on source files after Write/Edit, and on files changed by anything else inside the project, surfacing any findings as additional context for Claude to fix by hand.

## Install

```
/plugin install universal-lint@kwitsch-plugins
```

## Skills

| Skill            | What it does                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `universal-lint` | User-invoked. Lints every file in a free-text selection ("all files in `src/`", "files changed in PR 123", or an explicit list) read-only, exactly as a Write/Edit would be linted, and prints one aggregated findings report. |

## What it does

Each Write/Edit Claude makes is linted at once, check-only, with the file's standard linter: `shellcheck` (Shell), `checkstyle` (Java), `ktlint` (Kotlin), `eslint` or `oxlint` plus `tsc --noEmit` (JS/TS), `ruff check` (Python), `golangci-lint`/`go vet` (Go), `yamllint` (YAML), `markdownlint-cli2`/`markdownlint` (Markdown), `stylelint` (CSS/SCSS), `phpstan`/`psalm` (PHP) and `cargo clippy`/`cargo check` (Rust); `eslint`, `oxlint`, `markdownlint-cli2`, `markdownlint` and `stylelint` also run from the project's `node_modules/.bin`, else through `npx`. yamllint/markdownlint's max-line-length rule is skipped only when neither the project nor the user has a linter config of its own (details below). JSON is not covered (see below).

Files changed outside Write/Edit are linted too: at session start (and when the working directory changes) the plugin asks Claude Code to watch the project's lintable git files (tracked and untracked, not ignored; nothing above 5000 files); when one of them changes — a formatter run from Bash, `git stash pop`, an external editor — it is linted the same way, unless it is git-ignored, unchanged against git, or still exactly what Write/Edit just wrote.

An unavailable linter, any crash or misconfiguration, an unsupported extension, a file outside the working directory (real path, so symlinks pointing out count as outside), or a file under `node_modules/`/`vendor/`/`.git/` is a **silent no-op**. The plugin never modifies a file (that is `universal-format`'s job) and never passes `--fix`/`--format`/`--write` to anything.

Findings of a half-finished change are held back:

- **Quiet time.** Findings are reported once Claude has stopped editing for 20 seconds, or at the end of the turn, whichever comes first. If the same file is edited again before that, the earlier lint reports nothing; the lint of the newest edit checks the lines of all edits not yet reported and reports what is still wrong, once.
- **Subagents.** An edit made by a subagent (Agent tool, workflow agent) is not linted at once. When the subagent finishes, the files it edited are linted in their final state and the findings go to that subagent, which continues and fixes them. The main conversation is not woken for a subagent's edits.
- **Turn end.** When Claude finishes its turn, the reports not yet delivered and the files whose edits no report has covered yet are handed to Claude once, so it fixes them before it stops. A report that becomes ready while the session is idle wakes Claude.
- **Headless runs** (`claude -p`): findings are reported at once, without the quiet time.

The plugin adds two internal tools the model can see (`file_edited`, `next_report`); a call without the plugin's session key is ignored.

The plugin is always active once installed — there is no toggle. Per-language opt-out is simply not installing that linter.

## Supported linters

| Language              | Extensions                                            | Linter chain (first on `PATH` wins)                                                                                                                                         | Scope                                                                                              |
| --------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Shell                 | `.sh` `.bash`                                         | `shellcheck`                                                                                                                                                                | file                                                                                               |
| Java                  | `.java`                                               | `checkstyle`                                                                                                                                                                | file                                                                                               |
| Kotlin                | `.kt` `.kts`                                          | `ktlint`                                                                                                                                                                    | file                                                                                               |
| JS/TS                 | `.js` `.jsx` `.mjs` `.cjs` `.ts` `.tsx` `.mts` `.cts` | `oxlint`/`eslint` by the nearest config (file dir up to project root); none there: `eslint` if an eslint config exists further up to `/`, else none (TS still type-checked) | file                                                                                               |
| Python                | `.py` `.pyi`                                          | `ruff check`                                                                                                                                                                | file                                                                                               |
| Go                    | `.go`                                                 | `golangci-lint` → `go vet`                                                                                                                                                  | **package directory** — file-level linting would spuriously flag sibling-file symbols as undefined |
| YAML                  | `.yaml` `.yml`                                        | `yamllint`                                                                                                                                                                  | file                                                                                               |
| Markdown              | `.md`                                                 | `markdownlint-cli2` → `markdownlint`                                                                                                                                        | file                                                                                               |
| CSS/SCSS              | `.css` `.scss`                                        | `stylelint` (only with a stylelint config, searched file dir up to `/` and the user config dir)                                                                             | file                                                                                               |
| PHP                   | `.php`                                                | `phpstan` → `psalm`                                                                                                                                                         | file                                                                                               |
| Rust                  | `.rs`                                                 | `cargo clippy` → `cargo check`                                                                                                                                              | **crate** — scoped by the nearest `Cargo.toml` (via `--manifest-path`)                             |
| TypeScript type-check | `.ts` `.tsx` `.mts` `.cts`                            | `tsc --noEmit` (runs independently of the JS/TS row above; skipped when oxlint ran with a selecting `.oxlintrc.json`/`.oxlintrc.jsonc` that sets `options.typeCheck: true`) | **whole project** — scoped by the nearest `tsconfig.json`                                          |

`eslint`, `oxlint`, `markdownlint-cli2`, `markdownlint`, and `stylelint`, when not on
`PATH`, run from the project's own `node_modules/.bin` (the nearest one from the
file's directory up to the project root), else via `npx` (all official npm packages;
a package npx has already installed runs from npx's cache directly; once a day the
plugin goes through `npx` again so a new release is picked up);
`yamllint` has no npm distribution and is `PATH`-only, and Rust's `cargo`/
`cargo clippy` are rustup-only and likewise `PATH`-only (no npx fallback).

`tsc` gets no `npx` fallback and is cached via `--incremental`/
`--tsBuildInfoFile` under a persistent plugin data directory to keep repeat
whole-project checks fast.

## Java: checkstyle ruleset and detection

`checkstyle` requires an explicit ruleset to run at all. A project's own `checkstyle.xml` / `.checkstyle.xml` / `config/checkstyle/checkstyle.xml` (searched upward from the edited file to the project root) is preferred; otherwise the jar-bundled `/google_checks.xml` is used, with no extraction required.

checkstyle's exit code only counts `error`-severity violations, and `google_checks.xml` (like many real projects' own configs) runs at `warning` severity by default — so its exit code alone can't tell you whether it found anything. Findings are detected from checkstyle's own output instead: it always prints `Starting audit...` first and `Audit done.` last, regardless of violation count; anything left after stripping those two lines is a real finding.

## YAML/Markdown: max line length isn't enforced without a linter config

`yamllint` and `markdownlint`/`markdownlint-cli2` both flag lines over 80
characters by default. When neither the project nor your user-level linter
config sets it (no `.yamllint*`/`.markdownlint*` in the project; for yamllint
also no `$YAMLLINT_CONFIG_FILE` / `~/.config/yamllint/config`; for classic
markdownlint also no `~/.markdownlintrc`, `~/.config/markdownlint*` or
`/etc/markdownlint*`), the plugin disables just that one rule so it doesn't
flag ordinary long lines nobody opted into limiting — every other check still
runs normally. A project or user config is never touched; its line-length
choice always wins.

## JSON: not covered (why)

No standalone, actively-maintained JSON linter has a clean exit-code
contract: `jsonlint` (npm) is unmaintained, and its successor
`@prantlf/jsonlint` (like `biome lint`) conflates "invalid JSON" with
"crashed/misconfigured" under the same exit code. `universal-format`'s
bundled prettier already rejects malformed JSON, so format-only
coverage is the honest answer here.

## Troubleshooting

**Slow lints on WSL.** WSL appends the Windows `PATH` (on the measuring machine 44 of 63 dirs, all under `/mnt/`), and tools that search `PATH` themselves pay for each of those dirs. The lint hook shows no difference beyond run-to-run noise between the full and a `/mnt`-trimmed `PATH`; the remaining cost sits inside child tools such as `go vet`, about 170 ms with the Windows `PATH` vs about 75 ms without it (measured 2026-11-10 on 0.15.25, go 1.22.2, one small package, warm caches; your numbers will differ). To drop the Windows dirs, put this in `/etc/wsl.conf`, then run `wsl --shutdown` from a Windows shell and reopen the distro:

```ini
[interop]
appendWindowsPath = false
```

Windows programs still run by full path, but bare names (`code`, `explorer.exe`, `clip.exe`, a Windows-installed linter) stop resolving in every WSL shell, including Claude's Bash. Alternatively start one Claude Code session with a trimmed `PATH`, which has the same effect for every tool Claude calls in that session, not only linters: `PATH=$(printf %s "$PATH" | tr : '\n' | grep -v '^/mnt/' | paste -sd:) claude`. The plugin never rewrites `PATH`.
