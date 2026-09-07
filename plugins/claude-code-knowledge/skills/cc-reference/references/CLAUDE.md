# CLAUDE.md — claude-code-knowledge/skills/cc-reference/references

## Reference-file authoring style

The reference files under `skills/cc-reference/references/` are harness reference files, not prose documentation. Follow these conventions:

- Directives not prose: state rules as imperatives or tables, not explanatory paragraphs.
- Tables for field references: frontmatter keys, schema fields, and option enumerations all go in markdown tables.
- `verified:` date in each maintained file's header: keep it accurate when editing. (`skill-folder-structure.md` is a static convention doc — no verified date, not refreshed by `update-cc-references`.)
- Forward slashes for paths; no backslashes.
- No time-sensitive phrasing: instead of "new in X.Y", use a version-gate note (`version >= X.Y:` prefix on the row).
- Body under 500 lines per file.
- Layout convention: a single bundled reference file sits next to `SKILL.md`; **≥2 reference files live in the `references/` subfolder** (documented in `references/skill-folder-structure.md`).
