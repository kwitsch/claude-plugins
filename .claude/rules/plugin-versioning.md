---
paths:
  - "plugins/*/.claude-plugin/plugin.json"
  - ".claude-plugin/marketplace.json"
---
# Rule: plugin versioning

## Version field ownership

Each plugin's `version` lives **only** in `plugins/<name>/.claude-plugin/plugin.json`. The marketplace manifest (`.claude-plugin/marketplace.json`) has its own top-level `version` field (the manifest version) — this is separate. Do not confuse the two: the rule is about individual plugin entry versions, not the manifest's own version. Every plugin change requires a bump — no exceptions. Use semver (`MAJOR.MINOR.PATCH`); breaking changes bump MAJOR.

## marketplace.json entries

Do **not** add a `version` field to marketplace.json plugin entries. `plugin.json` wins silently when both declare a version, but CI fails on any entry that declares `version` or any `plugin.json` that lacks one.

## marketplace.json sources

Sources must use the full relative path `./plugins/<name>`. Two broken alternatives:

- `metadata.pluginRoot` — documented but non-functional: Claude Code ignores it for `./` sources during install/update (anthropics/claude-code#61224).
- Bare plugin name — triggers unsupported-source-type error (anthropics/claude-code#64431).

Reintroduce `metadata.pluginRoot` only after issue #61224 is resolved.
