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

Two deliberate, user-authored revisions exist:

- Commit `7243bde`: emission-rule item 8 (now superseded, see below) deferred
  a bare 1-line `?` turn-ender to any stricter Interaction contract already
  active (e.g. coding-toolbox's golden-rules Stop-hook gate).
- 2026-08-01 (PR #165, follow-up commit): added the "Input & turn-end
  protocol" section — this style now carries its own intrinsic
  `AskUserQuestion`-first mandate (parallel remote-control/mobile sessions:
  every input need and every completion must be explicitly signaled) rather
  than only deferring to an external contract when one happens to be active.
  Emission-rule item 8 was rewritten as item 9 to match: a bare plain-text
  question is now a fallback for when `AskUserQuestion` options are
  impossible, not a default with an external-contract escape hatch. Also
  added: indented `    - <Key>: <value>` sub-bullets for ≥2 attributes of one
  status line (a new hard rule + emission-rule item 2), and a fixed turn-end
  contract (exactly one of: a pending `AskUserQuestion`, or a final
  `Summary:` block — including a `🚫` blocker inside `Summary:` when stuck).

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
