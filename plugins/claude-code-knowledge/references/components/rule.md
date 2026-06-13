# Component: rule (.claude/rules/*.md)

- Path-scoped rules under `.claude/rules/`. Resolve the exact doc path via
  `<CACHE_DIR>/llms.txt` (likely under `en/settings` or a memory/rules page —
  confirm; do not assume).
- A rule is guidance loaded when editing matching files, not enforcement.

Scaffold skeleton (confirm CURRENT behavior via cc-knowledge):

```yaml
---
paths:
  - "<glob>"
---
```

Gotchas to check:
- `paths:` globs control conditional loading; negative globs are typically not
  supported — confirm and document exclusions in prose if needed.
