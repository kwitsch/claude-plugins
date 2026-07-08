# universal-lint

Silently runs each language's standard linter (read-only — never autofixes) on just-written source files after Write/Edit, surfacing any findings as additional context for Claude to fix by hand.

## Install

```
/plugin install universal-lint@kwitsch-plugins
```

## What it does

A PostToolUse `Write|Edit` hook (an `mcp_tool` backed by a self-contained plugin-local MCP server) runs the just-written file's standard linter, check-only, for six languages. The linter runs only when its CLI is on `PATH`; a missing linter, any crash or misconfiguration, an unsupported extension, a file outside the project, or a file under `node_modules/`/`vendor/`/`.git/` is a **silent no-op** — the hook never blocks or degrades the session, and it never modifies the file (that's `universal-format`'s job, not this plugin's — this plugin never passes `--fix`/`--format`/`--write` to anything). When (and only when) the linter reports real findings, the hook returns them as context so Claude can fix them itself.

Per-language opt-out is simply not installing that linter. The whole plugin can be disabled with the `auto_lint` toggle.

## Supported linters

| Language | Extensions | Linter chain (first on `PATH` wins) | Scope |
|---|---|---|---|
| Shell | `.sh` `.bash` | `shellcheck` | file |
| Java | `.java` | `checkstyle` | file |
| Kotlin | `.kt` `.kts` | `ktlint` | file |
| JS/TS | `.js` `.jsx` `.mjs` `.cjs` `.ts` `.tsx` `.mts` `.cts` | `eslint` | file |
| Python | `.py` `.pyi` | `ruff check` | file |
| Go | `.go` | `golangci-lint` → `go vet` | **package directory** — `go vet`/`golangci-lint` operate on packages, not standalone files; pointing them at a single file that references sibling-file symbols would otherwise fail with spurious "undefined" errors |

## Configuration

Configure via `/plugin` → installed → **universal-lint** → Configure options.

| Option | Default | Effect |
|---|---|---|
| `auto_lint` | `true` | Master on/off. Only a literal `false` disables auto-linting; any other value (or unset) leaves it on. |

## Java: checkstyle ruleset and detection

`checkstyle` requires an explicit ruleset to run at all. A project's own `checkstyle.xml` / `.checkstyle.xml` / `config/checkstyle/checkstyle.xml` (searched upward from the edited file to the project root) is preferred; otherwise the jar-bundled `/google_checks.xml` is used, with no extraction required.

checkstyle's exit code only counts `error`-severity violations, and `google_checks.xml` (like many real projects' own configs) runs at `warning` severity by default — so its exit code alone can't tell you whether it found anything. Findings are detected from checkstyle's own output instead: it always prints `Starting audit...` first and `Audit done.` last, regardless of violation count; anything left after stripping those two lines is a real finding.
