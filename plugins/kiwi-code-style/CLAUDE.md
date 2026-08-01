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

`markdownlint` flags this file (unlabeled example fences, `` `- ` `` code
spans, compact-style tables) — **by design**: those are intentional contract
content, not lint debt. Do not apply markdownlint/CodeRabbit/prettier
formatting suggestions to this file; they would rewrite the shipped contract.

## Tests

`test/kiwi-code-style/test.bats` (bats). Run:
`BATS_LIB_PATH="$PWD/node_modules" npx bats test/kiwi-code-style/`. Guards the 3
frontmatter keys (`name`, `keep-coding-instructions`, `force-for-plugin`), the
contract heading, `plugin.json`'s no-`userConfig` invariant, the
`.prettierignore` exemption line, and manifest/marketplace validity — no
plugin logic to test beyond that.
