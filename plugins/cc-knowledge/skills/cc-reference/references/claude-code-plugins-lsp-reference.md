# Claude Code Plugins — LSP Servers Reference

> Harness-optimized knowledge file. Directives, not prose. Source: Anthropic official docs
> (Plugins reference — LSP servers section), verified 2026-10-09.
> Split out of claude-code-plugins-reference.md to keep that file under its line budget;
> linked from that file's "## LSP servers" pointer.

## What LSP servers provide

- Real-time code intelligence while Claude works: instant diagnostics after each edit, go-to-definition, find-references, hover info, type information and documentation for symbols.
- Users must install the language server binary separately — the plugin configures the connection, not the server itself. Missing binary surfaces as `Executable not found in $PATH` in the `/plugin` Errors tab.

## Scopes

| Scope         | File location             | Notes                                                                                                                                                                       |
| ------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin-scoped | `<plugin-root>/.lsp.json` | Auto-discovered; extend via `lspServers` in `plugin.json` (string \| array \| object — `.json` path(s) or inline config); merges with the default file, does not replace it |

- Load order: `<plugin-root>/.lsp.json` first, then each `lspServers` declaration in order; a server name declared later replaces an earlier one.
- A project-root `.lsp.json` is not loaded by Claude Code — never author one. For project-local LSP config, wrap it in a project-scope skills-directory plugin: `<cwd>/.claude/skills/<name>/.claude-plugin/plugin.json` (`{"name": "<name>"}`) + `<cwd>/.claude/skills/<name>/.lsp.json`. It loads as `<name>@skills-dir`; see `claude-code-plugins-reference.md` "Skills-directory plugins".
- For skills-directory plugins installed at project scope (`<cwd>/.claude/skills/`), LSP servers start only after the user accepts the workspace trust dialog. Personal-scope skills-dir plugins have no such restriction.

## Server entry schema

Top-level keys are arbitrary server identifiers. Each value is a server config object. Each config is a **strict object**: an unknown key is an error, fails `claude plugin validate`, and the plugin does not load.

### Required fields

| Field                 | Description                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `command`             | The LSP binary to execute (must be in `PATH`); no spaces unless the value starts with `/` — put arguments in `args`; `${CLAUDE_PLUGIN_ROOT}` interpolated in plugin context |
| `extensionToLanguage` | Maps file extensions (e.g. `.ts`) to LSP language identifiers (e.g. `typescript`); at least one entry; keys start with a dot                                                |

### Optional fields

| Field                   | Description                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `args`                  | Command-line arguments for the LSP server                                                                                                                                   |
| `transport`             | Communication transport: `stdio` (default) or `socket`. Claude Code accepts `socket` but runs every server over stdio, so stdout protocol rules apply to all servers        |
| `env`                   | Environment variables to set when starting the server                                                                                                                       |
| `initializationOptions` | Options passed to the server during initialization                                                                                                                          |
| `settings`              | Settings passed via `workspace/didChangeConfiguration`                                                                                                                      |
| `workspaceFolder`       | Workspace folder path for the server                                                                                                                                        |
| `startupTimeout`        | Max time to wait for server startup (ms, positive integer)                                                                                                                  |
| `shutdownTimeout`       | Max time to wait for graceful shutdown (ms, positive integer). When timeout elapses, Claude Code terminates the process. When unset, no timeout applies. Requires v2.1.205+ |
| `requestTimeout`        | Max time to wait for the server to answer a request (ms, positive integer). Defaults to `60000` — a request the server never answers fails after 60 s. Requires v2.1.288+   |
| `restartOnCrash`        | Whether to restart the server after a crash. Defaults to `true`. Set `false` to leave a crashed server stopped. Requires v2.1.205+                                          |
| `maxRestarts`           | Maximum number of restart attempts before giving up (zero or more)                                                                                                          |
| `diagnostics`           | Whether to push diagnostics into Claude's context after edits (default `true`); set `false` to keep code navigation but suppress automatic diagnostic injection             |

**Version note**: `shutdownTimeout` and `restartOnCrash` require v2.1.205+. Before v2.1.205, the schema accepted both fields but setting either caused Claude Code to skip that LSP server entirely at startup — reason visible only in `claude --debug` output. `requestTimeout` requires v2.1.288+.

Three path variables are interpolated in LSP server fields within plugin context:

| Variable                | Resolves to                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `${CLAUDE_PLUGIN_ROOT}` | Absolute path to the plugin's installation directory                               |
| `${CLAUDE_PLUGIN_DATA}` | Persistent directory that survives plugin updates (`~/.claude/plugins/data/{id}/`) |
| `${CLAUDE_PROJECT_DIR}` | The project root                                                                   |

All three resolve in `command`, `args`, `env`, and `workspaceFolder`, and are exported to the server process environment.

`${user_config.KEY}` is also substituted in LSP server config.

## Conflict and failure behavior

**Multiple servers for the same extension**: when more than one enabled LSP server declares the same file extension in `extensionToLanguage` (from one plugin or different plugins), the first server registered handles that extension and the others never start. The `/plugin` interface shows a warning naming the active plugin's server.

**Servers that fail to initialize**: Claude Code skips a server whose configuration is invalid (e.g. missing `command` or `extensionToLanguage`); other configured servers still start. Run `claude --debug` to see why a server was skipped. A skipped server does not claim its file extensions, so another valid server declaring the same extension (same or different plugin) still handles those files.

## Path validation

- Every `lspServers` path must resolve inside the plugin root and must exist. A path that escapes the root (usually via `..`) or does not exist does not load; the `/plugin` Errors tab shows `<component> path escapes plugin directory: <path>` or `<component> path not found: <path>`.
- `claude plugin validate` checking `lspServers` paths (also `outputStyles`, `monitors`, `themes`) requires v2.1.283+.

## Stdout/stderr requirement

Send log output to **stderr, not stdout**. Claude Code reads a server's stdout as protocol messages only and accepts:

- Message headers up to 64 KiB
- Message body up to 32 MiB

Claude Code disconnects a server that exceeds either limit or writes non-protocol output to stdout, and counts the disconnect as a crash for `restartOnCrash` and `maxRestarts`. With `--debug`, Claude Code writes an error naming the cause to the debug log.

## Example (plugin-scoped `.lsp.json`)

```json
{
  "vtsls": {
    "command": "npx",
    "args": ["-y", "@vtsls/language-server@0.3.0", "--stdio"],
    "extensionToLanguage": {
      ".js": "javascript",
      ".mjs": "javascript",
      ".ts": "typescript",
      ".tsx": "typescriptreact"
    },
    "startupTimeout": 60000
  },
  "bashls": {
    "command": "npx",
    "args": ["-y", "bash-language-server@5.6.0", "start"],
    "extensionToLanguage": {
      ".sh": "shellscript",
      ".bash": "shellscript"
    },
    "startupTimeout": 60000
  }
}
```

## Official LSP plugins

Prefer installing these over authoring a custom `.lsp.json` when the language is covered.

| Plugin              | Language server            | Install command                                                                            |
| ------------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| `pyright-lsp`       | Pyright (Python)           | `pip install pyright` or `npm install -g pyright`                                          |
| `typescript-lsp`    | TypeScript Language Server | `npm install -g typescript-language-server typescript`                                     |
| `rust-analyzer-lsp` | rust-analyzer              | [See rust-analyzer installation](https://rust-analyzer.github.io/manual.html#installation) |

Install the language server binary first, then install the plugin from the marketplace.
