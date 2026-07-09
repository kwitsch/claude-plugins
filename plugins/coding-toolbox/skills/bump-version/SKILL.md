---
name: bump-version
description: Use to bump a project's semantic version (major, minor, or patch) in its detected version file — package.json, composer.json, pom.xml, or a plain VERSION file — and sync the matching lock file (npm/composer) when present.
argument-hint: "<major|minor|patch>"
allowed-tools: ["Bash(bash:*)"]
---

# Bump a project's version

Detects the project's version file in the current directory —
`package.json` → `composer.json` → `pom.xml` → `VERSION`, first match wins —
bumps the segment named by the argument and zeros every segment to its right
(`minor` on `1.1.1` → `1.2.0`; `major` on `1.2.3` → `2.0.0`; `patch` on
`1.1.1` → `1.1.2`), then syncs the matching lock file if one is present. Only
bare `MAJOR.MINOR.PATCH` versions are supported — a prerelease/build suffix
is a hard error, not silently dropped. Detection is cwd-only, no recursive
search, no monorepo awareness. No git operations: this skill only edits
files in the working tree, it never commits.

| Version file | Lock file | Sync command | What it actually does |
|---|---|---|---|
| `package.json` | `package-lock.json` | `npm i --package-lock-only` | rewrites the bumped version into the lock file (root `version` + `packages[""].version`) — genuine propagation |
| `composer.json` | `composer.lock` | `composer update --lock` | **not** version propagation — `composer.lock` has no root-version field; this only refreshes the lock's content-hash so `composer install` stops warning "lock file out of date" |
| `pom.xml` | — | none | no standard lock-file convention |
| `VERSION` | — | none | no standard lock-file convention |

`pom.xml` support is **best-effort**: it skips past a leading
`<parent>…</parent>` block (if present) before locating the first
`<version>` tag, so a parent POM's own version is never mistaken for the
project's — but this is a regex heuristic, not real XML parsing, and can
still mismatch on unusual POM layouts.

## Steps

Run the script below via the Bash tool, exactly as shown — do not re-indent
it and do not paste it inside an outer `bash -c '...'` wrapper. Its
`awk`/`trap`/`sed` lines contain single-quoted regions (and a comment with
a literal apostrophe) that break an outer single-quoted wrapper. Instead it
writes itself to a temp file via a **quoted heredoc delimiter** (preserves
every character verbatim, no escaping needed) and runs that file with the
caller's argument. The closing `BUMPVERSION_EOF` line below **must stay at
column 0, with no leading whitespace** — an unquoted-tag heredoc (`<<'TAG'`)
only terminates on a line that is exactly the tag; even one leading space
leaves the heredoc unterminated and swallows everything after it. Replace
`<major|minor|patch>` with the literal argument the caller gave; the whole
block (heredoc write + run + cleanup) is one Bash tool call.

```bash
BUMP="$(mktemp)"
cat > "$BUMP" <<'BUMPVERSION_EOF'
#!/usr/bin/env bash
# bump-version: detect a project's version file (package.json > composer.json >
# pom.xml > VERSION, cwd only), bump the given semver segment (zeroing segments
# to its right), then sync the matching lock file if present.
#
# Usage: bump-version.sh <major|minor|patch>
# Exit: 0 ok · 2 usage · 3 no_version_file · 4 unparseable_version ·
#       5 write_failed · 6 sync_failed (version already written)
set -uo pipefail

part="${1:-}"
[ "$#" -eq 1 ] || { echo "usage: bump-version.sh <major|minor|patch>" >&2; exit 2; }
case "$part" in
  major|minor|patch) ;;
  *) echo "usage: bump-version.sh <major|minor|patch>" >&2; exit 2 ;;
esac

is_bare_semver() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

bump_semver() {
  local major minor patch
  IFS='.' read -r major minor patch <<<"$1"
  case "$2" in
    major) major=$((major + 1)); minor=0; patch=0 ;;
    minor) minor=$((minor + 1)); patch=0 ;;
    patch) patch=$((patch + 1)) ;;
  esac
  echo "$major.$minor.$patch"
}

# Escapes a literal string for use inside a sed BRE pattern.
sed_escape_pattern() {
  printf '%s' "$1" | sed -e 's/[.[\*^$\/]/\\&/g'
}

# Escapes a literal string for use as a sed replacement (& and \ and the delimiter).
sed_escape_replacement() {
  printf '%s' "$1" | sed -e 's/[\/&\\]/\\&/g'
}

file=""
old=""
new=""
kind=""
pom_line=""

detect_json() {
  local f="$1"
  [ -f "$f" ] || return 1
  local match
  match="$(grep -o -E '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" | head -n1)"
  [ -n "$match" ] || { echo "no \"version\" field found in $f" >&2; exit 4; }
  old="$(printf '%s' "$match" | grep -o -E '"[^"]*"$' | tr -d '"')"
  is_bare_semver "$old" || { echo "bump-version only supports bare MAJOR.MINOR.PATCH; $f has \"$old\"" >&2; exit 4; }
  file="$f"
  return 0
}

detect_pom() {
  local f="pom.xml"
  [ -f "$f" ] || return 1
  local start=1 parent_end
  parent_end="$(grep -n '</parent>' "$f" | head -n1 | cut -d: -f1)"
  [ -n "$parent_end" ] && start=$((parent_end + 1))
  pom_line="$(awk -v start="$start" 'NR>=start && match($0, /<version>[0-9]+\.[0-9]+\.[0-9]+<\/version>/) {print NR; exit}' "$f")"
  [ -n "$pom_line" ] || { echo "no project <version> tag found in $f" >&2; exit 4; }
  old="$(sed -n "${pom_line}p" "$f" | grep -o -E '<version>[0-9]+\.[0-9]+\.[0-9]+</version>' | sed -E 's#</?version>##g')"
  is_bare_semver "$old" || { echo "bump-version only supports bare MAJOR.MINOR.PATCH; $f has \"$old\"" >&2; exit 4; }
  file="$f"
  return 0
}

detect_version_file() {
  local f="VERSION"
  [ -f "$f" ] || return 1
  old="$(head -n1 "$f")"
  is_bare_semver "$old" || { echo "bump-version only supports bare MAJOR.MINOR.PATCH; $f has \"$old\"" >&2; exit 4; }
  file="$f"
  return 0
}

if detect_json "package.json"; then
  kind="npm"
elif detect_json "composer.json"; then
  kind="composer"
elif detect_pom; then
  kind="maven"
elif detect_version_file; then
  kind="plain"
else
  echo "no supported version file (package.json, composer.json, pom.xml, VERSION) found in $(pwd)" >&2
  exit 3
fi

new="$(bump_semver "$old" "$part")"

write_json() {
  local esc_old esc_new
  esc_old="$(sed_escape_pattern "$old")"
  esc_new="$(sed_escape_replacement "$new")"
  sed -i "0,/\"version\"[[:space:]]*:[[:space:]]*\"$esc_old\"/s//\"version\": \"$esc_new\"/" "$file"
}

write_pom() {
  local esc_new
  esc_new="$(sed_escape_replacement "$new")"
  sed -i "${pom_line}s/<version>[0-9.]*<\/version>/<version>${esc_new}<\/version>/" "$file"
}

write_plain() {
  local esc_new
  esc_new="$(sed_escape_replacement "$new")"
  sed -i "1s/.*/${esc_new}/" "$file"
}

case "$kind" in
  npm|composer) write_json ;;
  maven) write_pom ;;
  plain) write_plain ;;
esac
write_status=$?
[ "$write_status" -eq 0 ] || { echo "failed to write $file" >&2; exit 5; }

sync_status="no_lockfile"
sync_log="$(mktemp)"
trap 'rm -f "$sync_log"' EXIT

case "$kind" in
  npm)
    if [ -f package-lock.json ]; then
      if npm i --package-lock-only >"$sync_log" 2>&1; then
        sync_status="synced"
      else
        sync_status="failed"
      fi
    fi
    ;;
  composer)
    if [ -f composer.lock ]; then
      if composer update --lock >"$sync_log" 2>&1; then
        sync_status="synced"
      else
        sync_status="failed"
      fi
    fi
    ;;
  maven|plain)
    sync_status="no_convention"
    ;;
esac

printf 'file: %s\nold: %s\nnew: %s\nsync: %s\n' "$file" "$old" "$new" "$sync_status"
if [ "$sync_status" = "failed" ]; then
  echo "sync command output:" >&2
  cat "$sync_log" >&2
  exit 6
fi
exit 0
BUMPVERSION_EOF
bash "$BUMP" <major|minor|patch>
rc=$?
rm -f "$BUMP"
exit $rc
```

Map the exit code:

- `0` — success; report the printed `file:`/`old:`/`new:`/`sync:` lines
  (`sync:` is one of `synced`, `no_lockfile`, `no_convention`).
- `2` `usage` — missing, extra, or unrecognized argument (must be exactly
  one of `major`, `minor`, `patch`). Report the stderr usage line and
  stop; nothing was touched.
- `3` `no_version_file` — none of `package.json`, `composer.json`,
  `pom.xml`, `VERSION` exist in the current directory. Report and stop.
- `4` `unparseable_version` — a version file was found but its version
  isn't bare `MAJOR.MINOR.PATCH` (e.g. a prerelease suffix), or (for
  `pom.xml`) no project `<version>` tag could be located after skipping
  any `<parent>` block. Report the stderr message (names the file and
  the offending value) and stop; nothing was touched.
- `5` `write_failed` — the version file couldn't be written (permissions,
  read-only filesystem). Report stderr and stop.
- `6` `sync_failed` — the version file was **already bumped and written
  successfully**, but the lock-file sync command failed (binary missing,
  non-zero exit). Report both facts explicitly — version bumped, sync
  did not complete — and include the captured sync-command output
  printed to stderr; never say the operation fully failed.

Report: the bumped file, old → new version, and the lock-sync outcome
from the script's printed lines.
