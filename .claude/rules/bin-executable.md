---
paths:
  - "plugins/*/bin/**"
---

# Rule: bin/ files must be executable

All files under `plugins/*/bin/` MUST have executable bit set — shell scripts, binaries, any file in these directories.

**After creating or writing any file in `plugins/*/bin/`, immediately run:**

```bash
chmod +x <file>
git add <file>
git update-index --chmod=+x <file>
```

**`core.fileMode=false` in this repo:** `chmod +x` alone is NOT picked up by `git add`, so git records `100644` and Claude Code silently skips the file on a fresh checkout. `git update-index --chmod=+x` forces the mode. A file renamed with `git mv` from an already-`100755` file keeps its mode.

**Verification:** confirm the index mode, not the working tree — the suite runs before the adding commit exists, and `ls -la` reads only the working tree:

```bash
git ls-files -s plugins/<name>/bin/<file>   # must print 100755
```
