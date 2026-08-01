# CLAUDE.md — kiwi-code-style

Single-component plugin: `output-styles/kiwi-code-style.md`. No skills/agents/hooks.

## Behavior

`force-for-plugin: true` in the style's frontmatter makes Claude Code apply this
style automatically whenever the plugin is enabled — this overrides the user's own
`outputStyle` setting by design (see settings-reference: "first loaded wins if
several set it"). `keep-coding-instructions: true` keeps the built-in
software-engineering system prompt instructions alongside the style body, so only
communication/formatting changes, never coding behavior (scoping, comments,
verification stay intact).

Style body is the user-supplied contract verbatim — treat edits to it as content
changes, not formatting cleanups; don't rewrite its prose style to match repo
conventions elsewhere. Any deviation from the current body below is a bug,
not a style choice — apply the body's own content changes exactly as the
user supplies them, never paraphrased.

This style carries two deliberate, user-authored behaviors beyond the base
contract — don't revert either to a plainer form:

- An intrinsic `AskUserQuestion`-first mandate (the "Input & turn-end
  protocol" section) for any input need, with a bare plain-text question
  only as a fallback when tappable options are impossible — not merely
  deferring to whatever external Interaction contract happens to be active.
- Indented `    - <Key>: <value>` sub-bullets for status lines with ≥2
  attributes, instead of chaining them inline, plus a fixed turn-end
  contract: exactly one of a pending `AskUserQuestion`, or a final
  `Summary:` block (with a `🚫` blocker inside it when stuck).

`markdownlint` flags this file's unlabeled example fences (`MD040`) — **by
design**: those are intentional contract content, not lint debt; do not add
language tags or otherwise rewrite them. `.prettierignore` no longer exempts
this file from prettier (removed 2026-08-01, repo-wide 200-char line-length
pass); prettier's own `proseWrap: "preserve"` default means it never rewraps
prose, so formatting it is cosmetic only (table column padding, trailing
blank lines, nested-list indent width) — verified by diffing before/after.
Prettier has no per-rule toggle for this (unlike markdownlint's `MD038`
below) — it isn't rule-based, so the only lever for a specific line is a
`<!-- prettier-ignore -->` comment (or a full `.prettierignore` re-exemption,
rejected as too broad). One line needs it: the bullet demonstrating the
separator token uses a code span containing a leading and trailing space
around the em-dash (space, em-dash, space) — those padding spaces
are semantically part of the documented token — prettier's inline-code-span
printer trims exactly that kind of padding, which would silently change
what the token looks like. A `<!-- prettier-ignore -->` immediately above
that bullet (2026-08-01) makes the file a stable fixed point under repeated
prettier runs — verified empirically (`prettier --write` twice in a row
produces zero further diff). `MD038` (spaces inside code spans) is disabled
for this plugin only via the sibling `.markdownlint.json` (`extends` the
root config, overrides just this rule) — this file deliberately uses padded
code spans like `` `- ` `` to show a literal dash-space bullet-prefix token,
which `MD038`'s fix would corrupt. Any other CodeRabbit/markdownlint
suggestion that would rewrite the actual contract content (not just
cosmetic whitespace) must still be rejected.

## Tests

`test/kiwi-code-style/test.bats` (bats). Run:
`BATS_LIB_PATH="$PWD/node_modules" npx bats test/kiwi-code-style/`. Guards the 3
frontmatter keys (`name`, `keep-coding-instructions`, `force-for-plugin`), the
contract heading, `plugin.json`'s no-`userConfig` invariant, and
manifest/marketplace validity — no plugin logic to test beyond that.
