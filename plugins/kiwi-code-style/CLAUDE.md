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
conventions elsewhere. One deliberate, reviewed amendment exists (commit
`7243bde`): emission-rule item 8 defers a bare 1-line `?` turn-ender to any
stricter Interaction contract already active (e.g. coding-toolbox's
golden-rules, which mechanically blocks bare-`?` turns) — approved during this
plugin's own review, not a drift from the original attachment. Any other
deviation from the original body is a bug, not a style choice.

`markdownlint` flags this file's unlabeled example fences (`MD040`) — **by
design**: those are intentional contract content, not lint debt; do not add
language tags or otherwise rewrite them. `.prettierignore` no longer exempts
this file from prettier (removed 2026-08-01, repo-wide 200-char line-length
pass); prettier's own `proseWrap: "preserve"` default means it never rewraps
prose, so formatting it is cosmetic only (table column padding, trailing
blank lines) — verified by diffing before/after. The one exception found:
prettier trims the padding spaces inside a code span used to show a literal
`` ` — ` `` token, silently changing what the token looks like — restored
by hand after formatting; watch for this on any future reformat. `MD038`
(spaces inside code spans) is disabled for this plugin only via the sibling
`.markdownlint.json` (`extends` the root config, overrides just this rule) —
this file deliberately uses padded code spans like `` `- ` `` to show a
literal dash-space bullet-prefix token, which `MD038`'s fix would corrupt.
Any other CodeRabbit/markdownlint suggestion that would rewrite the actual
contract content (not just cosmetic whitespace) must still be rejected.

## Tests

`test/kiwi-code-style/test.bats` (bats). Run:
`BATS_LIB_PATH="$PWD/node_modules" npx bats test/kiwi-code-style/`. Guards the 3
frontmatter keys (`name`, `keep-coding-instructions`, `force-for-plugin`), the
contract heading, `plugin.json`'s no-`userConfig` invariant, and
manifest/marketplace validity — no plugin logic to test beyond that.
