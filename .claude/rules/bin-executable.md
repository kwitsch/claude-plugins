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

**Exception: non-executable data files.** A file under `plugins/*/bin/` that is pure data, never
executed or sourced — a committed release archive (`.tar.gz`) or a checksum sidecar
(`*-checksums.txt`) — is intentionally `100644`. `linux-token-efficiency` ships both next to its
executable `bin/cbm-launch.sh`; see that plugin's `CLAUDE.md`. Only files that are actually invoked
(scripts, binaries) must carry the executable bit.

**Verification:** After any Write or Edit to `plugins/*/bin/` file, confirm with:

```bash
ls -la plugins/<name>/bin/
```
