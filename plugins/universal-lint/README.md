# universal-lint

Silently runs each language's standard linter (read-only — never autofixes) on source files after Write/Edit, and on files changed by anything else inside the project, surfacing any findings as additional context for Claude to fix by hand.

## Install

```
/plugin install universal-lint@kwitsch-plugins
```

## Skills

| Skill            | What it does                                                                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `universal-lint` | User-invoked. Lints every file in a free-text selection ("all files in `src/`", "files changed in PR 123", or an explicit list) read-only, exactly as the Write/Edit hook would, and prints one aggregated findings report. |

## What it does

A background (`asyncRewake`) PostToolUse `Write|Edit` command hook (no MCP server — all hooks are plain command hooks sharing one script) runs the just-written file's standard linter, check-only, for every language in the table below. At session start (and when the working directory changes) the plugin asks Claude Code to watch the project's lintable git files (tracked and untracked, not ignored; nothing above 5000 files); when one of them changes outside Write/Edit — a formatter run from Bash, `git stash pop`, an external editor — it is linted the same way in the background, unless it is git-ignored, unchanged against git, or still exactly what Write/Edit just wrote. The linter runs when its CLI is on `PATH` — or, for `eslint`/`oxlint`/`markdownlint-cli2`/`markdownlint`/`stylelint`, from the project's own `node_modules/.bin` or via the `npx` fallback (see below); an unavailable linter (no `PATH` CLI, no project-local bin and no `npx` fallback), any crash or misconfiguration, an unsupported extension, a file outside the project (real path, so symlinks pointing out count as outside), or a file under `node_modules/`/`vendor/`/`.git/` is a **silent no-op** — the hooks never block or degrade the session, and they never modify the file (that's `universal-format`'s job, not this plugin's — this plugin never passes `--fix`/`--format`/`--write` to anything). When (and only when) the linter reports real findings, the hook exits 2 with them on stderr, which wakes Claude with the findings as soon as the lint finishes so it can fix them itself.

These hooks are always active once the plugin is installed — there is no toggle. Per-language opt-out is simply not installing that linter.

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
hook goes through `npx` again so a new release is picked up);
`yamllint` has no npm distribution and is `PATH`-only, and Rust's `cargo`/
`cargo clippy` are rustup-only and likewise `PATH`-only (no npx fallback).

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
bundled prettier already rejects malformed JSON, so format-only
coverage is the honest answer here.

## Troubleshooting

**Slow lints on WSL.** WSL appends the Windows `PATH` (on the measuring machine 44 of 63 dirs, all under `/mnt/`), and tools that search `PATH` themselves pay for each of those dirs. The lint hook shows no difference beyond run-to-run noise between the full and a `/mnt`-trimmed `PATH`; the remaining cost sits inside child tools such as `go vet`, about 170 ms with the Windows `PATH` vs about 75 ms without it (measured 2026-11-10 on 0.15.25, go 1.22.2, one small package, warm caches; your numbers will differ). To drop the Windows dirs, put this in `/etc/wsl.conf`, then run `wsl --shutdown` from a Windows shell and reopen the distro:

```ini
[interop]
appendWindowsPath = false
```

Windows programs still run by full path, but bare names (`code`, `explorer.exe`, `clip.exe`, a Windows-installed linter) stop resolving in every WSL shell, including Claude's Bash. Alternatively start one Claude Code session with a trimmed `PATH`, which has the same effect for every tool Claude calls in that session, not only linters: `PATH=$(printf %s "$PATH" | tr : '\n' | grep -v '^/mnt/' | paste -sd:) claude`. The plugin never rewrites `PATH`.
