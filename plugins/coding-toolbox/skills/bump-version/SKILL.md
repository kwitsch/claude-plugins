---
name: bump-version
description: Use to bump a project's semantic version (major, minor, or patch) in its detected version file — a Claude Code plugin's .claude-plugin/plugin.json, package.json, composer.json, pom.xml, or a plain VERSION file — and sync the matching lock file (npm/composer) when present.
argument-hint: "<major|minor|patch>"
allowed-tools: ["Bash(bash:*)", "Bash(cd:*)", "Bash(mktemp:*)", "Bash(export:*)"]
---

# Bump a project's version

Detects the project's version file in the current directory —
`.claude-plugin/plugin.json` → `package.json` → `composer.json` → `pom.xml` →
`VERSION`, first match wins — bumps the segment named by the argument and zeros
every segment to its right (`minor` on `1.1.1` → `1.2.0`; `major` on `1.2.3` →
`2.0.0`; `patch` on `1.1.1` → `1.1.2`), then syncs the matching lock file if one
is present. Only bare `MAJOR.MINOR.PATCH` versions are supported — a
prerelease/build suffix is a hard error, not silently dropped. Detection is
cwd-only, no recursive search, no monorepo awareness: `.claude-plugin/plugin.json`
is a fixed cwd-relative path, so a plugin inside a plugin-marketplace repo is
reached by running from that plugin's own directory (`plugins/<name>/`), never by
walking the tree — and a marketplace repo root (`.claude-plugin/marketplace.json`
with no `plugin.json` of its own) refuses with exit `3` naming `plugins/<name>/`
rather than bumping something else. Inside a plugin directory the plugin manifest
wins over a sibling `package.json`, which is then left stale on purpose. No git
operations: this skill only edits files in the working tree, it never commits.

| Version file                 | Lock file           | Sync command                | What it actually does                                                                                                                                                                                                                  |
| ---------------------------- | ------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude-plugin/plugin.json` | —                   | none                        | no lock-file convention — and `.claude-plugin/marketplace.json` is never written: a plugin's version lives only in its own `plugin.json`, while the manifest's own top-level `version` is the marketplace manifest's, not any plugin's |
| `package.json`               | `package-lock.json` | `npm i --package-lock-only` | rewrites the bumped version into the lock file (root `version` + `packages[""].version`) — genuine propagation                                                                                                                         |
| `composer.json`              | `composer.lock`     | `composer update --lock`    | **not** version propagation — `composer.lock` has no root-version field; this only refreshes the lock's content-hash so `composer install` stops warning "lock file out of date"                                                       |
| `pom.xml`                    | —                   | none                        | no standard lock-file convention                                                                                                                                                                                                       |
| `VERSION`                    | —                   | none                        | no standard lock-file convention                                                                                                                                                                                                       |

`pom.xml` support is **best-effort**: it skips past a leading
`<parent>…</parent>` block (if present) before locating the first
`<version>` tag, so a parent POM's own version is never mistaken for the
project's — but this is a regex heuristic, not real XML parsing, and can
still mismatch on unusual POM layouts.

## Steps

1. Read `bump-version.reference.md` for the exact parameter and
   exit-code contract.
2. Run, as **one Bash tool call**:

   ```bash
   export TMPDIR="<scratchpad-or-mktemp-dir>"
   bash ${CLAUDE_SKILL_DIR}/bump-version.sh <part>
   ```

   Substitute `<part>` with the caller's literal argument
   (`major`/`minor`/`patch`) and `<scratchpad-or-mktemp-dir>` with the
   session scratchpad directory's absolute path (from your own system
   prompt); if none is available, run `mktemp -d -t bump-version-XXXXXX`
   once first and use that directory's path instead.

   When the target is a plugin in a plugin-marketplace repo, prefix the same
   Bash call with `cd <absolute-path-to>/plugins/<name> && ` so detection runs
   in the plugin's own directory — detection is cwd-only and never walks the
   tree, so running from the repo root (or from deeper inside the plugin, e.g.
   `plugins/<name>/skills/<skill>/`) does not find the plugin's manifest.

3. Map the exit code per `bump-version.reference.md`'s table:
   - `0` — report the printed `file:`/`old:`/`new:`/`sync:` lines
     (`sync:` is one of `synced`, `no_lockfile`, `no_convention`). When the
     reported `file:` path ends in `.claude-plugin/plugin.json`, also report two
     follow-ups this script deliberately does not perform: (a) if the repo pins
     that plugin's version in a test (this repo does, in `test/<name>/*.bats`),
     update that assertion in the **same commit** or CI goes red on the next
     run; (b) bump once per unreleased release, not per commit — if the current
     branch already bumped this plugin for the same unreleased change, do not
     bump again. Never add a `version` field to `marketplace.json`.
   - `3` `no_version_file` — if the stderr names a **plugin-marketplace repo
     root**, nothing was touched: re-run with cwd set to that repo's
     `plugins/<name>/` directory.
   - `6` `sync_failed` — the version file was **already bumped and
     written successfully**, but the lock-file sync command failed.
     Report both facts explicitly — version bumped, sync did not
     complete — including the captured sync-command output; never say
     the operation fully failed.
   - `7` `sync_temp_failed` — the version file was **already bumped and
     written successfully**, but the lock-sync step couldn't even run.
     Report both facts explicitly.
   - other non-zero codes — report the stderr message and stop; nothing
     was touched.

Report: the bumped file, old → new version, and the lock-sync outcome
from the script's printed lines.
