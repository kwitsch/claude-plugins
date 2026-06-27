---
name: lsp-repo-init
description: Creates .lsp.json at the project root with LSP servers for the file types found in the repo. Reads references/lsp-map.json to resolve extension → server config. Skips if .lsp.json already exists. Idempotent.
allowed-tools: ["Bash", "Read", "Write"]
---

# lsp-repo-init

Create `.lsp.json` at the project root with LSP servers matched to the file extensions
present in the repo. Skips if `.lsp.json` already exists.

## Precondition (dynamic-context injection)

```!
[ -f .lsp.json ] && echo "LSP_JSON_EXISTS=yes" || echo "LSP_JSON_EXISTS=no"
```

## Reference file

`${CLAUDE_SKILL_DIR}/references/lsp-map.json` — maps extension strings to server config
objects (canonical entries) or to server-key alias strings.

**Alias resolution:** if a map value is a string (e.g. `".cjs": "vtsls"`), look up the
canonical entry whose `.server` equals that string. This finds the full config object
in one hop.

**Deduplication:** collect matched server configs keyed by their `"server"` value.
A server that matches multiple extensions (e.g. vtsls via `.js` and `.ts`) is emitted
once with its full `extensionToLanguage` map.

**Strip `"note"`:** do not write the `"note"` field into `.lsp.json` — it is
human-context only.

**Strip `"server"`:** the key in `.lsp.json` is the server name; the nested object
must not also carry a `"server"` field.

## Steps

### 1. Skip if present

If `LSP_JSON_EXISTS=yes`:
- Report: ".lsp.json already present — skipping".
- Stop.

### 2. Scan extensions

Run via Bash:
```bash
find . \
  -type d \( -name '.git' -o -name 'node_modules' -o -name 'dist' -o -name 'build' -o -name 'vendor' \) -prune \
  -o -type f -name "*.*" -print \
  | grep -oE '\.[^./]+$' | sort -u
```

Collect the list of distinct extensions (e.g. `.js`, `.sh`, `.md`, `.json`).

### 3. Load lsp-map.json and resolve

Read `${CLAUDE_SKILL_DIR}/references/lsp-map.json`.

For each extension from step 2, look it up in the map:
- If the value is an object → add to the output set (keyed by `server`).
- If the value is a string alias → look up the object entry whose `"server"` equals
  that alias; add it to the output set.
- If absent from the map → skip that extension silently.

### 4. Write .lsp.json

Build the output object: for each server in the collected set, write a key of the
server name with the config object (omitting `"server"` and `"note"` fields).

If matched servers were found, write `.lsp.json` — example with vtsls + bashls:
```json
{
  "vtsls": {
    "command": "npx",
    "args": ["-y", "@vtsls/language-server@0.3.0", "--stdio"],
    "extensionToLanguage": {
      ".js": "javascript",
      ".cjs": "javascript",
      ".mjs": "javascript",
      ".jsx": "javascriptreact",
      ".ts": "typescript",
      ".cts": "typescript",
      ".mts": "typescript",
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

If no extension matched → write `{}` (empty object).

Report: list of server keys written, or "no known extensions — empty .lsp.json written".

## Implementation

<!-- Skip precondition check block -->

If LSP_JSON_EXISTS is "yes", report and stop.

<!-- Step 2: Scan extensions -->

Collect extensions via:
```bash
find . \
  -type d \( -name '.git' -o -name 'node_modules' -o -name 'dist' -o -name 'build' -o -name 'vendor' \) -prune \
  -o -type f -name "*.*" -print \
  | grep -oE '\.[^./]+$' | sort -u
```

<!-- Step 3: Load and resolve lsp-map.json -->

Read `${CLAUDE_SKILL_DIR}/references/lsp-map.json` and parse it as JSON.

For each scanned extension:
1. Look up the extension in the map.
2. If the value is an object (has a `"server"` key), add it to the results keyed by its `"server"` value. Skip if already present (deduplication).
3. If the value is a string, treat it as an alias: find the object entry in the map whose `"server"` field equals this string, and add that object to results (keyed by `"server"`).
4. If the extension is not in the map, skip silently.

<!-- Step 4: Normalize and write -->

For each collected server object:
- Create a new object containing all fields **except** `"server"` and `"note"`.
- Use the server name (from the `"server"` field) as the key in the output.

Write the final object to `.lsp.json` in the project root.

If no servers matched, write `{}`.

Report the list of server names written (or "no known extensions — empty .lsp.json written").
