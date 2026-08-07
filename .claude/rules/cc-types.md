---
paths:
  - "plugins/**/*.mjs"
  - "test/**/*.mjs"
  - "types/cc-types.d.ts"
---

# Rule: Claude Code type definitions in types/cc-types.d.ts

`types/cc-types.d.ts` is the single source of truth for Claude Code API shapes used
in `.mjs` files:

- Hook event inputs: `HookCommonInput`, `ToolHookInput`
- Hook outputs: `HookResult`, `HookSpecificOutput`
- Tool results: `CompressResult`, `GitInfo`

## When to extend

Before committing any `.mjs` file that introduces a **new** Claude Code API surface:

1. Add the new interface or field to `types/cc-types.d.ts`.
2. Reference it in the JSDoc (`@param {NewType}`, `@returns {Promise<NewType>}`).
3. Run `npx tsc --noEmit` to confirm it resolves cleanly.

New surfaces include: a new hook event's specific input fields, a new `hookSpecificOutput`
shape, a new MCP tool call or return shape, a new decision mode in `permissionDecision`.

## Source of truth

Interface shapes are sourced from the cc-reference hook schema
(`claude-code-hooks-reference.md`). When Claude Code releases a new field, verify
against the live doc before adding it here.
