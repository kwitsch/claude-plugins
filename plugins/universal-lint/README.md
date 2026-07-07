# universal-lint

Silently runs each language's standard linter (read-only — never autofixes) on just-written Shell, Java, Kotlin, JS/TS, Python and Go files after Write/Edit, surfacing any findings as additional context for Claude to fix (shellcheck, checkstyle, ktlint, eslint, ruff check, golangci-lint/go vet); no-op when the linter is absent.

## Install

```
/plugin install universal-lint@kwitsch-plugins
```

## What it does

After Claude writes or edits a Shell, Java, Kotlin, JS/TS, Python, or Go file, this plugin runs that language's standard linter in check-only mode (never `--fix`/`--format`/`--write`) and, when the linter is installed and reports issues, surfaces the findings as additional context for Claude to address. It never modifies files itself and stays silent when the linter is absent or the file is clean.
