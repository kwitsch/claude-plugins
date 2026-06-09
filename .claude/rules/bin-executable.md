---
paths:
  - "plugins/*/bin/**"
---

# Rule: bin/ files must be executable

All files under `plugins/*/bin/` MUST have the executable bit set.

**After creating or writing any file in a `plugins/*/bin/` path, immediately run:**

```bash
chmod +x <file>
```

Never leave a bin/ file without the executable bit. This applies to shell scripts, binaries, and any other file placed in these directories.

**Verification:** After any Write or Edit to a `plugins/*/bin/` file, confirm with:

```bash
ls -la plugins/<name>/bin/
```
