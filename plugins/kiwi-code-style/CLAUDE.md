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
conventions elsewhere.

## Tests

`test/kiwi-code-style/test.bats` (bats). Run:
`BATS_LIB_PATH="$PWD/node_modules" npx bats test/kiwi-code-style/`. Guards the 3
frontmatter keys (`name`, `keep-coding-instructions`, `force-for-plugin`) and
manifest/marketplace validity — no plugin logic to test beyond that.
