# CLAUDE.md — coding-toolbox skill: bump-version

## Skill design (`bump-version`)

2026-07-25: `bump-version.sh` extracted to a standalone file +
colocated `bump-version.reference.md` doc per
`.claude/rules/script-authoring.md`'s updated convention — the
heredoc-to-temp-file / `PART`/`SCRATCHPAD_DIR` placeholder-substitution
workaround this section used to describe no longer applies, the file
has real argv.

`bump-version.sh` detects exactly one
version file per
invocation, cwd only, by fixed precedence (`package.json` →
`composer.json` → `pom.xml` → `VERSION`) — mirrors a `version.sh`-style
helper's file-check order (its env-var-based checks and its
documented-but-never-implemented `gradle.properties` check are both
deliberately not mirrored — the latter is a docstring/code mismatch in the
reference script; this skill follows the working code, not the
aspirational comment). Bumps the named segment and zeros every segment to
its right; only bare `MAJOR.MINOR.PATCH` is supported (leading zeros like
`09` are rejected too — invalid per the semver spec, and would otherwise hit
bash's octal-literal arithmetic and silently corrupt the version), a
prerelease/build suffix is a hard error. Version extraction never depends on
`jq`/`xidel` — a targeted regex captures the value, and both detection and
write-back address the **specific line number** the match was found on
(never a whole-file first-match search) so a same-shaped `"version"` field
nested inside e.g. `overrides`/`resolutions` is never confused with the
project's own; for JSON files the top-level field is picked as whichever
`"version"` match has the shallowest line indentation (a nested field is
always indented more in a normally-formatted file), with a single match
always winning outright — a CodeRabbit review on this branch's PR (#121)
confirmed a file with NO indentation at all (still multi-line, just
unindented) ties every match at indentation 0, and the original
first-tie-wins logic silently picked whichever came first in the file,
which could be the wrong (nested) one; fixed by treating 2+ matches tied at
the shallowest indentation as ambiguous and failing loudly via
`require_bare_semver`/the no-match check instead of guessing. Best-effort
still: a file where indentation doesn't reflect nesting is exactly the case
this can't disambiguate — the fix is "don't guess," not "handle it." `pom.xml`
support is explicit best-effort:
it skips past a leading `<parent>…</parent>` block before searching for the
first `<version>` tag, so a parent POM's version is never mistaken for the
project's own — still a regex heuristic, not real XML parsing, confirmed
with the user during design as an accepted trade-off over adding an
XML-parser dependency. Lock-file sync is intentionally asymmetric and
documented as such in the skill body: `npm i --package-lock-only` genuinely
rewrites the bumped version into `package-lock.json`, but `composer update
--lock` does **not** propagate anything — `composer.lock` carries no
root-project version field, that command only refreshes the lock's
content-hash to silence composer's drift warning — kept anyway (user
confirmed at the design intent-confirmation gate) but never presented as
equivalent to the npm case. No git operations — this skill only edits
files in the working tree, unlike `fresh-branch`/`fresh-pr`/`fresh-work`;
composability with those is preserved by keeping this skill's blast radius
to file edits only. The one temp file the script itself creates (the
lock-sync log, via its own internal `mktemp` call) is routed into the
session scratchpad the same TMPDIR-propagation way as `fresh-pr`'s
`ci-watcher` dispatch above — an `export TMPDIR=` line the caller sets
before running the script, needing no change to the script itself.

**Marketplace-plugin support (`0.24.0`).** The cascade gained one new candidate,
checked **first**: `.claude-plugin/plugin.json`. Inside a plugin directory the
plugin manifest is the authoritative version location (this repo's
`.claude/rules/plugin-versioning.md`: a plugin's version lives only there), so a
`package.json` that happens to sit beside it must not win — precedence here is a
deliberate rule, not an accident, and the sibling `package.json` is left stale on
purpose. No new parsing code: `detect_json`/`write_json` are reused verbatim (a
`plugin.json` is JSON with a top-level `"version": "X.Y.Z"`, and both accept a
path containing a directory segment), and detection stays cwd-only — a fixed
cwd-relative subpath, never an upward walk, so the caller `cd`s into
`plugins/<name>` (an argv change, a `.git`-bounded walk to the marketplace root,
and an implicit walk-up-to-the-containing-plugin were all considered and
rejected; `Bash(cd:*)` was added to `allowed-tools` for the documented
invocation). Second new branch: a plugin-marketplace repo root
(`.claude-plugin/marketplace.json` present, no `plugin.json` of its own) is
refused with exit `3` and a message naming `plugins/<name>/`. It **must** sit
before `detect_json "package.json"` — this repo's own root `package.json` has no
`"version"` key at all (`grep -c '"version"' package.json` → `0`), and
`detect_json` hard-exits `4` from inside itself in that case, so a later-placed
guard would be dead code; exit `3` is reused rather than adding a code, since
SKILL.md maps every unknown non-zero code to "report stderr and stop" anyway.
`marketplace.json` is never written — only a `[ -f … ]` existence test — and is
explicitly not a lock file to propagate into, so `plugin` joins `maven|plain` in
the `no_convention` sync bucket (`sync_lock` never runs on this path, making
exits `6`/`7` unreachable there); a bats tripwire pins that every mention of
`marketplace.json` in the script is a comment, that existence test, or the error
message. The write `case` gained a `*)` arm (`internal error: no writer for
kind=…`, exit `5`) — not speculative hardening but a confirmed silent-failure
class: a patched script that added `kind="plugin"` to the cascade but not to
this `case` printed all four output lines including `new: 0.24.0` and exited `0`
while writing nothing, because an unmatched `case` succeeds and the trailing
`|| { … exit 5; }` therefore never fires (same family as the `ba868ee`
silent-version-corruption fix). The sync `case` deliberately gets no default arm
— an unmatched kind there leaves the truthful-enough `no_lockfile` default and
corrupts nothing. No `kind:` line was added to stdout: SKILL.md keys its
plugin-specific guidance off the reported `file:` path suffix instead, keeping
the four-line contract stable for existing callers and the script free of this
repo's own conventions. Both conventions the script cannot mechanically enforce
stay caller-side prose in SKILL.md — updating the plugin's own
`test/<name>/*.bats` version-pin assertion in the same commit, and judging "bump
once per unreleased release, not per commit" — because this skill still performs
no git operations at all and the pin's location/literal is repo-specific
knowledge it cannot derive.
