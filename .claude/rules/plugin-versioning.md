---
paths:
  - "plugins/*/.claude-plugin/plugin.json"
  - ".claude-plugin/marketplace.json"
---

# Rule: plugin versioning

## Version field ownership

- Each plugin's `version` lives **only** in `plugins/<name>/.claude-plugin/plugin.json`.
- The marketplace manifest (`.claude-plugin/marketplace.json`) has its own top-level `version` field (the manifest version) — separate from individual plugin entry versions; do not confuse the two.
- Every plugin change requires a version bump — no exceptions. Use semver (`MAJOR.MINOR.PATCH`); breaking changes bump MAJOR.

- Bumping `plugin.json`'s version in a commit without also updating that plugin's own `test/<name>/*.bats` version-pin assertion (see `.claude/rules/test-conventions.md`'s "Manifest assertions") turns CI red on the next run.
- Grep `test/<name>/` for the old version literal in the _same_ commit as the bump, every time, for every plugin (not just the ones with a history of this).

## marketplace.json entries

Do **not** add a `version` field to marketplace.json plugin entries. `plugin.json` wins silently when both declare a version, but CI fails on any entry that declares `version` or any `plugin.json` that lacks one.

## marketplace.json sources

Sources must use the full relative path `./plugins/<name>`. Do not use a bare plugin name or `metadata.pluginRoot`:

- `metadata.pluginRoot` (Claude Code >= 2.1.239) is only prepended to bare-name sources and is ignored for sources that already start with `./`.
- A bare-name source resolved through it is rejected as unsupported when the marketplace is synced via Organization settings; the full `./plugins/<name>` path works everywhere.
- Upstream reports of `pluginRoot` misbehaving (anthropics/claude-code#61224, #64431) are unverified against current versions — treat them as reported upstream, not as established behavior.
