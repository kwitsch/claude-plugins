# Claude Code Plugins — LSP Servers Reference

> Harness-optimized knowledge file. Directives, not prose. Source: Anthropic official docs
> (Plugins reference — LSP servers section), verified 2026-07-03.
> Split out of claude-code-plugins-reference.md to keep that file under its line budget;
> linked from that file's "## LSP servers" pointer.

## What LSP servers provide

- Real-time code intelligence while Claude works: instant diagnostics after each edit, go-to-definition, find-references, hover info, type information and documentation for symbols.
- Users must install the language server binary separately — the plugin configures the connection, not the server itself. Missing binary surfaces as `Executable not found in $PATH` in the `/plugin` Errors tab.

## Scopes

| Scope          | File location              | Notes                                                                                                                          |
| -------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Plugin-scoped  | `<plugin-root>/.lsp.json`  | Auto-discovered; override via `lspServers` in `plugin.json` (string \| array \| object — path(s) or inline config)             |
| Project-scoped | `<project-root>/.lsp.json` | Loaded for all sessions in that project; **not documented in official docs** (observed behavior); same format as plugin-scoped |

Project-scoped `.lsp.json` is analogous to project-scoped `.mcp.json` — it requires per-user trust before loading.

## Server entry schema

Top-level keys are arbitrary server identifiers. Each value is a server config object.

### Required fields

| Field                 | Description                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `command`             | The LSP binary to execute (must be in `PATH`); `${CLAUDE_PLUGIN_ROOT}` interpolated in plugin context |
| `extensionToLanguage` | Maps file extensions (e.g. `.ts`) to LSP language identifiers (e.g. `typescript`)                     |

### Optional fields

| Field                   | Description                                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `args`                  | Command-line arguments for the LSP server                                                                                                                       |
| `transport`             | Communication transport: `stdio` (default) or `socket`                                                                                                          |
| `env`                   | Environment variables to set when starting the server                                                                                                           |
| `initializationOptions` | Options passed to the server during initialization                                                                                                              |
| `settings`              | Settings passed via `workspace/didChangeConfiguration`                                                                                                          |
| `workspaceFolder`       | Workspace folder path for the server                                                                                                                            |
| `startupTimeout`        | Max time to wait for server startup (ms)                                                                                                                        |
| `maxRestarts`           | Maximum number of restart attempts before giving up                                                                                                             |
| `diagnostics`           | Whether to push diagnostics into Claude's context after edits (default `true`); set `false` to keep code navigation but suppress automatic diagnostic injection |

`${CLAUDE_PLUGIN_ROOT}` is interpolated in `command` and `args` within plugin context only; project-root `.lsp.json` has no path variable substitution.

## Example (project-root `.lsp.json`)

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

| Plugin              | Language server            | Install command                                        |
| ------------------- | -------------------------- | ------------------------------------------------------ |
| `pyright-lsp`       | Pyright (Python)           | `pip install pyright` or `npm install -g pyright`      |
| `typescript-lsp`    | TypeScript Language Server | `npm install -g typescript-language-server typescript` |
| `rust-analyzer-lsp` | rust-analyzer              | see rust-analyzer's own installation docs              |

Install the language server binary first, then install the plugin from the marketplace.
