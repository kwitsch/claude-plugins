---
paths:
  - "plugins/*/README.md"
---

# Rule: sync plugin entry in root README.md

When modifying any `plugins/*/README.md`, validate the corresponding row in the root `README.md` plugins table.

**Table format:**
```
| [<plugin-name>](plugins/<plugin-name>/README.md) | one-line description |
```

**After any Write or Edit to `plugins/*/README.md`:**

1. Read root `README.md` and locate the `## Plugins` table
2. Find the row for this plugin (link target `plugins/<name>/README.md`)
3. If row **missing** → add it with an accurate description derived from the plugin README
4. If description **outdated or inaccurate** → update it to match the plugin's current functionality
5. If row **correct** → no action needed
