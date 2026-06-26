# LSP-first code intelligence

For code identifiers, prefer the `LSP` tool over text search — it is exact (semantic,
scope-aware) and cheaper than scanning files, more so as a codebase grows (rule of
thumb: past a few dozen files, one LSP call beats grep).

## Enforced (the language LSP plugins act on these)

- **Symbol search:** for a code-identifier name, use the `LSP` tool before
  `grep` / `rg` / the `Grep` tool. Start with `workspaceSymbol` to locate the symbol by
  name, then `goToDefinition` / `findReferences` at the returned location.
- **Read-gate:** warm up the LSP on a code file (one `LSP` call) before reading it, and
  prefer navigation over repeated full-file reads.

## Advisory discipline (guidance — not enforced by the hooks)

1. **Before modifying unfamiliar code:** `goToDefinition` to read the implementation.
2. **Before a refactor or rename:** `findReferences` for every call site you affect.
3. **After an edit:** re-check with `hover` / `findReferences` that signatures and call
   sites still line up, then run the project's own typecheck / build (e.g. `tsc
   --noEmit`, `bash -n`) — this `LSP` tool does not expose diagnostics.

Symbol → position: the navigation operations need a position (`filePath`, `line`,
`character`). From a bare name, go `workspaceSymbol` → returned location →
`goToDefinition` / `findReferences` / `hover`.

## Grep is the right tool for

Prose, `SCREAMING_SNAKE` constants / env vars, short all-lowercase words, plain
`kebab-case` filenames, and log / error strings. If the `LSP` tool is unavailable, fall
back to grep and treat the result as unverified.
