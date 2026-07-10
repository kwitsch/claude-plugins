---
name: bump-version
description: Use to bump a project's semantic version (major, minor, or patch) in its detected version file — package.json, composer.json, pom.xml, or a plain VERSION file — and sync the matching lock file (npm/composer) when present.
argument-hint: "<major|minor|patch>"
allowed-tools: ["Bash(bash:*)", "Bash(mktemp:*)", "Bash(cat:*)", "Bash(rm -f *)", "Bash(export:*)"]
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
`PART` (the placeholder on the `bash "$BUMP" PART` line below) with the
literal `major`/`minor`/`patch` argument the caller gave — not a bracketed
`<...>` placeholder: those characters are shell redirection/pipe
metacharacters, so an imperfect substitution would silently turn the
invocation into a redirection instead of a clean, catchable usage error. Also
replace `SCRATCHPAD_DIR` (on the `export TMPDIR=` line below) with your
session scratchpad directory's absolute path, taken from your own system
prompt; if none is available, run `mktemp -d -t bump-version-XXXXXX` once
first and use that directory's path instead — quote it, and never substitute
a bracketed `<...>` placeholder literally (same caveat as `PART` above).
This routes both temp files this script creates (`$BUMP`, and the lock-sync
log created inside it) into the session's own scratch space rather than
shared system `/tmp` — `mktemp` already prefers `$TMPDIR` when it is set, so
the heredoc body below needs no change to pick this up. The whole block
(heredoc write + run + cleanup) is one Bash tool call.

```bash
export TMPDIR="SCRATCHPAD_DIR"
BUMP="$(mktemp)" || { echo "mktemp failed — check TMPDIR (replace SCRATCHPAD_DIR with an existing, writable directory)" >&2; exit 1; }
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
  [[ "$1" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
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

# Prefer ripgrep; fall back to grep if rg isn't installed. rg's -E means
# --encoding=ARG and -r means --replace=ARG (both take a value, neither is
# grep's meaning), and rg has no recursive flag (recursion is its
# default) — so a bundled/bare -E is stripped before delegating to rg
# (its regex syntax is already ERE-equivalent for every pattern used in
# this file); grep gets its original arguments completely untouched.
# Note: bare `rg -c` prints nothing on 0 matches where `grep -c` prints `0`
# (both exit 1) -- no call site here checks that text (only $status or a
# nonzero count), so this divergence is accepted rather than papered over
# with --include-zero, which errors on ripgrep < 12.0.0.
rg_or_grep() {
  if command -v rg >/dev/null 2>&1; then
    local args=() a stripped seen_dashdash=false
    for a in "$@"; do
      if [ "$seen_dashdash" = true ]; then
        args+=("$a")
        continue
      fi
      case "$a" in
        --) seen_dashdash=true; args+=("$a") ;;
        -[A-Za-z]*)
          stripped="${a//E/}"
          [ "$stripped" = "-" ] && continue
          args+=("$stripped")
          ;;
        *) args+=("$a") ;;
      esac
    done
    command rg "${args[@]}"
  else
    command grep "$@"
  fi
}

file=""
old=""
new=""
kind=""
version_line=""

# Shared by detect_json/detect_pom/detect_version_file: they set $f/$old as
# locals before calling this, and bash's dynamic scoping means this callee
# sees those exact locals without needing them passed explicitly.
require_bare_semver() {
  is_bare_semver "$old" || { echo "bump-version only supports bare MAJOR.MINOR.PATCH; $f has \"$old\"" >&2; exit 4; }
}

detect_json() {
  local f="$1"
  [ -f "$f" ] || return 1
  local line_no match
  # A nested "version" (e.g. inside an "overrides"/"resolutions" block) is
  # always indented more than the top-level one in a normally-formatted
  # file, so picking the shallowest-indented match reliably finds the real
  # project version. A single match (the common case) always wins outright.
  # Two or more matches TIED at the shallowest indentation are ambiguous --
  # this happens when indentation doesn't reflect nesting (minified, or
  # multi-line but hand-written without any indentation at all) -- and are
  # deliberately treated as "not found" rather than guessing, so the failure
  # is loud (require_bare_semver / the no-match check below) instead of a
  # silent wrong-field bump.
  line_no="$(awk '
    {
      line = $0
      match(line, /^[[:space:]]*/)
      indent = RLENGTH
      if (match(line, /"version"[[:space:]]*:[[:space:]]*"[^"]*"/)) {
        if (best_line == "" || indent < best_indent) {
          best_indent = indent
          best_line = NR
          tie_count = 1
        } else if (indent == best_indent) {
          tie_count++
        }
      }
    }
    END { if (best_line != "" && tie_count == 1) print best_line }
  ' "$f")"
  [ -n "$line_no" ] || { echo "no top-level \"version\" field found in $f" >&2; exit 4; }
  match="$(sed -n "${line_no}p" "$f" | rg_or_grep -o -E '"version"[[:space:]]*:[[:space:]]*"[^"]*"')"
  old="$(printf '%s' "$match" | rg_or_grep -o -E '"[^"]*"$' | tr -d '"')"
  require_bare_semver
  file="$f"
  version_line="$line_no"
  return 0
}

detect_pom() {
  local f="pom.xml"
  [ -f "$f" ] || return 1
  local start=1 parent_end
  parent_end="$(rg_or_grep -n '</parent>' "$f" | head -n1 | cut -d: -f1)"
  [ -n "$parent_end" ] && start=$((parent_end + 1))
  version_line="$(awk -v start="$start" 'NR>=start && match($0, /<version>[0-9]+\.[0-9]+\.[0-9]+<\/version>/) {print NR; exit}' "$f")"
  [ -n "$version_line" ] || { echo "no project <version> tag found in $f" >&2; exit 4; }
  old="$(sed -n "${version_line}p" "$f" | rg_or_grep -o -E '<version>[0-9]+\.[0-9]+\.[0-9]+</version>' | sed -E 's#</?version>##g')"
  require_bare_semver
  file="$f"
  return 0
}

detect_version_file() {
  local f="VERSION"
  [ -f "$f" ] || return 1
  old="$(head -n1 "$f")"
  require_bare_semver
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
  sed -i "${version_line}s/\"version\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"version\": \"$new\"/" "$file"
}

write_pom() {
  sed -i "${version_line}s/<version>[0-9.]*<\/version>/<version>${new}<\/version>/" "$file"
}

write_plain() {
  sed -i "1s/.*/${new}/" "$file"
}

case "$kind" in
  npm|composer) write_json ;;
  maven) write_pom ;;
  plain) write_plain ;;
esac || { echo "failed to write $file" >&2; exit 5; }

sync_status="no_lockfile"

sync_lock() {
  local lockfile="$1"
  shift
  [ -f "$lockfile" ] || return 0
  sync_log="$(mktemp)"
  trap 'rm -f "$sync_log"' EXIT
  if "$@" >"$sync_log" 2>&1; then
    sync_status="synced"
  else
    sync_status="failed"
  fi
}

case "$kind" in
  npm) sync_lock package-lock.json npm i --package-lock-only ;;
  composer) sync_lock composer.lock composer update --lock ;;
  maven|plain) sync_status="no_convention" ;;
esac

printf 'file: %s\nold: %s\nnew: %s\nsync: %s\n' "$file" "$old" "$new" "$sync_status"
if [ "$sync_status" = "failed" ]; then
  echo "sync command output:" >&2
  cat "$sync_log" >&2
  exit 6
fi
exit 0
BUMPVERSION_EOF
bash "$BUMP" PART
rc=$?
rm -f "$BUMP"
exit $rc
```

Map the exit code:

- `0` — success; report the printed `file:`/`old:`/`new:`/`sync:` lines
  (`sync:` is one of `synced`, `no_lockfile`, `no_convention`).
- `1` `environment_error` — `mktemp` failed to create the working temp file
  (bad/unwritable `TMPDIR`, i.e. an unsubstituted or stale `SCRATCHPAD_DIR`).
  Report the stderr message and stop; nothing was touched — this happens
  before the version file is ever read.
- `2` `usage` — missing, extra, or unrecognized argument (must be exactly
  one of `major`, `minor`, `patch`). Report the stderr usage line and
  stop; nothing was touched.
- `3` `no_version_file` — none of `package.json`, `composer.json`,
  `pom.xml`, `VERSION` exist in the current directory. Report and stop.
- `4` `unparseable_version` — a version file was found but its version
  isn't bare `MAJOR.MINOR.PATCH` (e.g. a prerelease suffix, or a segment
  with a leading zero like `09` — invalid per the semver spec, and would
  otherwise hit bash's octal-literal arithmetic), or (for `package.json`/
  `composer.json`) no **top-level** `"version"` field could be found (a
  nested one inside e.g. an `overrides`/`resolutions` block doesn't count),
  or (for `pom.xml`) no project `<version>` tag could be located after
  skipping any `<parent>` block. Report the stderr message (names the file
  and the offending value) and stop; nothing was touched.
- `5` `write_failed` — the version file couldn't be written (permissions,
  read-only filesystem). Report stderr and stop.
- `6` `sync_failed` — the version file was **already bumped and written
  successfully**, but the lock-file sync command failed (binary missing,
  non-zero exit). Report both facts explicitly — version bumped, sync
  did not complete — and include the captured sync-command output
  printed to stderr; never say the operation fully failed.

Report: the bumped file, old → new version, and the lock-sync outcome
from the script's printed lines.
