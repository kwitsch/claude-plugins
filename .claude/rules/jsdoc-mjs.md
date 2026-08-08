---
paths:
  - "plugins/**/*.mjs"
---

# Rule: JSDoc annotations in .mjs files

## Machine-checkable floor

All **exported** functions in `.mjs` files must carry `@param` and `@returns` JSDoc
sufficient for `pnpm exec tsc --noEmit` to pass with `checkJs: true` and `strict: true`.

- Claude Code-specific parameter types (`HookCommonInput`, `ToolHookInput`,
  `HookResult`, `HookSpecificOutput`, `CompressResult`, `GitInfo`) must reference the
  interfaces in `types/cc-types.d.ts` — never `@param {any}` for a known Claude Code
  API shape.
- Other typed parameters use their real type (`@param {string} text`,
  `@param {number} ms`). Genuinely untyped parameters use `@param {any}`.

## Manual convention (not tsc-enforced)

Non-exported functions with more than three lines of body should also carry `@param`
annotations. This is prose-only — tsc does not check unexported functions under
`checkJs` unless they appear in an inference chain.

## Verification

```bash
pnpm exec tsc --noEmit
# expected: 0 errors
```
