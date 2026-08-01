# CLAUDE.md — kiwi-code-style

Two fixed, always-on components, no toggle between them: `output-styles/kiwi-code-style.md`
(the response-format contract) and a `SessionStart` command hook (`hooks/`) that injects
the karpathy-ponytail coding guidelines. No skills/agents.

## Output style

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

## SessionStart hook (`hooks/`)

`hooks/inject-ponytail-guidelines.mjs` (`SessionStart`, command, **no matcher**
— fires on `startup`/`resume`/`clear`/`compact` alike, unlike
`memory-enhancement`'s `check-dream-due.mjs` which restricts to `startup`
because it consumes a one-shot flag: this hook is stateless, and `/clear`/
`/compact` wipe context exactly like a fresh session, so the guidelines must
re-inject there too or they'd silently vanish mid-session). Reads
`hooks/ponytail-guidelines.md` (resolved relative to its own file location,
not via `${CLAUDE_PLUGIN_ROOT}` substitution) and emits it as
`hookSpecificOutput.additionalContext`. Fail-open: a missing/unreadable
bundle exits 0 with no stdout.

`ponytail-guidelines.md` is bundled verbatim from the
[karpathy-ponytail SKILL.md](https://github.com/AbdullahHameedKhan/karpathy-ponytail-skills/blob/main/skills/karpathy-ponytail/SKILL.md)
(MIT), reduced to the `full` ladder — the source's frontmatter, "Intensity
levels" table, and `/ponytail lite|full|ultra` switch line are all dropped
(no runtime switch exists for a hook-injected instruction; "full" was already
the default behavior described throughout the rest of the source's own
prose). One further passage is deliberately removed, not just kept alongside
a disclaimer: source §5's own competing plan-output template
(`1. [Step] → verify: [check]` in a fenced block) directly conflicted with
kiwi-code-style's own mandatory `Plan:` numbered-list format, so it's cut —
kiwi already fully owns that space. Every other line is verbatim from the
source.

**Precedence rule:** kiwi-code-style governs response **form** (how
something is said — the emoji legend, bullet caps, the `Plan:` template);
ponytail governs **behavior/content** (what to do — surface assumptions,
climb the ladder, stay surgical, fix root causes). When both apply: say the
ponytail thing, in kiwi's shape. Same kind of documented carve-out as the
output style's own emission-rule item 8 above — two contracts, one
documented tiebreak.

The bundled file carries a top-of-file MIT-attribution HTML comment and 6
`<!-- prettier-ignore -->` comments (guarding the 6 spots where Prettier
would otherwise insert a blank line before a list — verified via
`npx prettier --check`; no whole-file `.prettierignore` entry, unlike the
output style file, since the real reformatting footprint here is tiny and
localized). The hook strips all HTML comments (`stripHtmlComments()`) before
injecting, so none of that repo-maintenance markup ever reaches the model's
context.

No `userConfig` for either component — see
`.claude/rules/plugin-userconfig.md`'s kiwi-code-style exception: both are
one fixed, all-or-nothing contract, install/enable the plugin or don't.

## Tests

`test/kiwi-code-style/test.bats` (bats) + `test/kiwi-code-style/hooks.test.mjs`
(`node --test`). Run:

```bash
BATS_LIB_PATH="$PWD/node_modules" npx bats test/kiwi-code-style/
npm run test:unit
npm run typecheck
```

bats guards: the 3 output-style frontmatter keys, the contract heading,
`plugin.json`'s version/description/no-`userConfig` invariants, the
`.prettierignore` exemption line (output style file only), the
`hooks.json` shape (no matcher), the hook script's executable bit in the
git index (`100755`, read via `git ls-files --stage` since this runs before
the commit exists), that it still emits guidelines when invoked via a
symlink, and `ponytail-guidelines.md`'s structure (5 section headings,
lite/ultra removed, the kiwi-conflicting plan example removed, MIT
attribution present, `prettier --check` clean). `hooks.test.mjs` covers
`stripHtmlComments`/`buildResult` directly, plus an integration check that
the real bundled file strips clean.
