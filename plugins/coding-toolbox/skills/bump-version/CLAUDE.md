# CLAUDE.md — coding-toolbox skill: bump-version

Behavior lives in `SKILL.md`, `bump-version.sh` and `bump-version.reference.md`; this file holds only the rationale and rejected alternatives.

## Skill design (`bump-version`)

### Detection

- Mirrors a `version.sh`-style helper's file-check order, but not its env-var checks or its `gradle.properties` check (documented there, never implemented — follow the working code, not the comment).
- Detection stays cwd-only: `.claude-plugin/plugin.json` is a fixed cwd-relative path, so the caller `cd`s into `plugins/<name>`.
  - Rejected: an argv change, a `.git`-bounded walk to the marketplace root, an implicit walk-up to the containing plugin.
  - `Bash(cd:*)` is in `allowed-tools` for the documented `cd … &&` invocation.
- `plugin.json` is checked first on purpose: inside a plugin the manifest is the authoritative version location (`.claude/rules/plugin-versioning.md`), so a sibling `package.json` is left stale — do not "fix" that precedence.
- The marketplace-root guard (`marketplace.json`, no `plugin.json`) must sit before `detect_json "package.json"`.
  - This repo's root `package.json` has no `"version"` key and `detect_json` hard-exits `4` from inside itself, so a later guard would be dead code.
  - It reuses exit `3`: SKILL.md maps every unknown non-zero code to "report stderr and stop".
- `marketplace.json` is only ever existence-tested, never written or treated as a lock file.
  - `plugin` therefore joins `maven|plain` in the `no_convention` sync bucket; `sync_lock` never runs there, so exits `6`/`7` are unreachable.
  - A bats tripwire pins that every script mention of `marketplace.json` is a comment, that test, or the error message.

### Version parsing

- Bare `MAJOR.MINOR.PATCH` only; a prerelease/build suffix is a hard error, not silently dropped.
- Reject leading zeros (`09`): invalid semver, and bash's octal-literal arithmetic would silently corrupt the version.
- Extract with a targeted regex, never `jq`/`xidel` — no tool dependency.
- Detection and write-back both address the **specific line number** of the match, never a whole-file first-match search, so a same-shaped nested `"version"` (`overrides`/`resolutions`) is never mistaken for the project's own.
- JSON top-level pick: the `"version"` match with the shallowest indentation; a single match wins outright.
  - 2+ matches tied at the shallowest indentation (e.g. an unindented multi-line file) are ambiguous: fail loudly via `require_bare_semver`/the no-match check.
  - First-tie-wins silently picked the nested field; the fix is "don't guess", not "handle it" — a file whose indentation does not reflect nesting stays undisambiguable.
- `pom.xml` is a best-effort regex heuristic (skips a leading `<parent>` block), an accepted trade-off over adding an XML-parser dependency.

### Write-back and sync

- The write `case` needs its `*)` arm (`internal error: no writer for kind=…`, exit `5`).
  - An unmatched `case` succeeds, so the trailing `|| { … exit 5; }` never fires: a patched script that added `kind="plugin"` to the cascade but not to this `case` printed all four output lines and exited `0` while writing nothing.
  - Same silent-corruption family as the octal-literal bug above.
- The sync `case` deliberately has no default arm: an unmatched kind keeps the truthful-enough `no_lockfile` default and corrupts nothing.
- Lock sync is intentionally asymmetric: `composer update --lock` only refreshes the lock's content-hash (no root-version field in `composer.lock`). Kept to silence composer's drift warning, never presented as equivalent to npm's real propagation.
- stdout has no `kind:` line: SKILL.md keys plugin-specific guidance off the `file:` path suffix, keeping the four-line contract stable for existing callers.
- The script's one `mktemp` (lock-sync log) is routed into the session scratchpad via a caller-side `export TMPDIR=`, same mechanism as `fresh-pr`'s `ci-watcher` dispatch (`plugins/coding-toolbox/skills/fresh-pr/CLAUDE.md`) — no script change needed.

### Scope

- No git operations: the skill only edits working-tree files, which keeps it composable with `fresh-branch`/`fresh-pr`/`fresh-work`.
- Two plugin conventions stay caller-side prose in SKILL.md because the script cannot enforce them: update the plugin's `test/<name>/*.bats` version-pin assertion in the same commit, and bump once per unreleased release, not per commit.
  - The pin's location and literal are repo-specific knowledge the script cannot derive.
