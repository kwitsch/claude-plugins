---
paths:
  - ".claude-plugin/marketplace.json"
---

# Rule: marketplace entries of synced plugins

Synced plugins (listed in `plugins/CLAUDE.md` `## Synced plugins`) are built in kwitsch/claude-plugins-development, and their `plugins/<name>/.claude-plugin/plugin.json` is generated there from `<name>/package.json`. That manifest owns every field it can carry.

- A synced plugin's entry holds only `name`, `source` and the entry-only catalog fields `category` and `tags` (no `plugin.json` counterpart; `keywords` is a separate field).
- Never put a display field on such an entry: `displayName`, `description`, `author`, `homepage`, `repository`, `license` or `keywords`. A value set on the entry wins over `plugin.json` in `/plugin` listings, so it silently overrides what the development repo ships and goes stale. Unset, users see the `plugin.json` value, before and after install for relative-path sources (marketplace reference, "Display fields").
- Still no `version` on any entry (`.claude/rules/plugin-versioning.md`).
- A field newly added to a synced plugin's `package.json` needs no change here. When a plugin moves to the development repo, trim its entry to the fields above in the same PR.
- Hand-written plugins keep their entry's `description` and `author`.
