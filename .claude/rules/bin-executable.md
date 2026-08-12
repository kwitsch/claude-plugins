---
paths:
  - "plugins/*/bin/**"
---

# Rule: bin/ files must be executable

All files under `plugins/*/bin/` MUST have executable bit set.

**After creating or writing any file in `plugins/*/bin/` path, immediately run:**

```bash
chmod +x <file>
```

Never leave bin/ file without executable bit. Applies to shell scripts, binaries, any file in these directories.

**Verification:** After any Write or Edit to `plugins/*/bin/` file, confirm with:

```bash
ls -la plugins/ < name > /bin/
```
