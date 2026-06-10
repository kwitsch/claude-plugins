---
paths:
  - "plugins/*/hooks/*.sh"
  - "plugins/*/hooks/*.mjs"
---

# Rule: hook files must be executable

All `.sh` and `.mjs` files under `plugins/*/hooks/` MUST have executable bit set. Claude Code silently skips non-executable hook files.

**After creating or writing any file in `plugins/*/hooks/` path, immediately run:**

```bash
chmod +x <file>
```

Never leave a hook file without executable bit. Applies to both `.sh` and `.mjs` hooks.

**Verification:** After any Write or Edit to a `plugins/*/hooks/` file, confirm with:

```bash
ls -la plugins/<name>/hooks/
```
