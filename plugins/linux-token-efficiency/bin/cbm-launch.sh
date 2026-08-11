#!/usr/bin/env bash
# bin/cbm-launch.sh — linux-token-efficiency: MCP stdio `command` for the bundled
# codebase-memory-mcp (cbm). Verifies the committed tarball against the committed
# bin/cbm-checksums.txt sidecar, extracts the binary ONCE into a content-addressed
# directory under $CBM_BUNDLE_CACHE, and `exec`s it so the harness's stdio is wired to
# the real process (single process replacement, signals included).
#
# stdout is the MCP JSON-RPC channel: NOTHING is ever written to it before `exec`; every
# diagnostic goes to stderr. Dependencies: bash, uname, tar, sha256sum, awk, mktemp,
# mkdir, chmod, mv, rm, id, dirname — no jq, no node, no curl, no network.
#
# Env contract:
#   CLAUDE_PLUGIN_OPTION_CBM_ENABLED  fail-open toggle; only the trimmed literal
#                                     `false` (case-sensitive) disables.
#   CBM_BUNDLE_CACHE                  extraction cache root. Rejected when empty or when
#                                     it still holds a literal `${` (uninterpolated).
#   CBM_NO_EXTRACT                    non-empty => never extract; a cold cache exits 0
#                                     silently. Every hook sets this; the server never does.
# This script sets no cbm-owned variable — in particular never CBM_CACHE_DIR (cbm's own
# graph-database root), so server, hooks and manual CLI use share upstream's default root.
set -euo pipefail

ARCHIVE_NAME="codebase-memory-mcp-linux-amd64-portable.tar.gz"
BINARY_NAME="codebase-memory-mcp"

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUMS="$PLUGIN_ROOT/bin/cbm-checksums.txt"
ARCHIVE="$PLUGIN_ROOT/bin/$ARCHIVE_NAME"

# 1. Fail-open toggle gate. A disabled feature is not an error: exit 0, touch nothing.
if [[ "${CLAUDE_PLUGIN_OPTION_CBM_ENABLED:-}" =~ ^[[:space:]]*false[[:space:]]*$ ]]; then
  echo "cbm-launch: disabled by the cbm_enabled plugin option; not starting codebase-memory-mcp" >&2
  exit 0
fi

# 2. Linux x86_64 guard — the bundled binary cannot exec anywhere else.
if [ "$(uname -s)" != "Linux" ] || [ "$(uname -m)" != "x86_64" ]; then
  echo "cbm-launch: bundled codebase-memory-mcp is Linux x86_64 only (host: $(uname -s)/$(uname -m))" >&2
  exit 0
fi

# 3. Cache root. An uninterpolated ${...} value must never become a directory.
CACHE_ROOT="${CBM_BUNDLE_CACHE:-}"
if [ -z "$CACHE_ROOT" ] || [ "$CACHE_ROOT" != "${CACHE_ROOT#*'${'}" ]; then
  echo "cbm-launch: CBM_BUNDLE_CACHE unusable ('${CACHE_ROOT}'); using a temporary cache root" >&2
  CACHE_ROOT="${TMPDIR:-/tmp}/claude-cbm-$(id -u)"
fi

# 4. Content-addressed cache path, from exactly one sidecar entry (fail closed on 0 or >1).
[ -f "$SUMS" ] || {
  echo "cbm-launch: missing checksum sidecar: $SUMS" >&2
  exit 1
}
BIN_SHA="$(awk -v n="$BINARY_NAME" '$2 == n { print $1; c++ } END { exit c != 1 }' "$SUMS")" || {
  echo "cbm-launch: expected exactly one '$BINARY_NAME' entry in $SUMS" >&2
  exit 1
}
CACHE_DIR="$CACHE_ROOT/${BIN_SHA:0:16}"
CACHE_BIN="$CACHE_DIR/$BINARY_NAME"

# 5. Fast path: the path is derived from the verified hash and only ever created after
#    verification, so a warm start never re-hashes ~280 MiB.
if [ -x "$CACHE_BIN" ]; then
  exec "$CACHE_BIN" "$@"
fi

# 6. Never-extract mode (all hooks): a cold cache is silence, never a ~280 MiB write.
if [ -n "${CBM_NO_EXTRACT:-}" ]; then
  echo "cbm-launch: cache cold, extraction skipped (CBM_NO_EXTRACT set)" >&2
  exit 0
fi

# 7. Extract. Verify the committed tarball BEFORE anything is unpacked.
[ -f "$ARCHIVE" ] || {
  echo "cbm-launch: missing committed archive: $ARCHIVE" >&2
  exit 1
}
mkdir -p "$CACHE_ROOT"
TMP="$(mktemp -d "$CACHE_ROOT/.tmp.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

awk -v n="$ARCHIVE_NAME" '$2 == n { print; c++ } END { exit c != 1 }' "$SUMS" > "$TMP/expected.sha256" || {
  echo "cbm-launch: expected exactly one '$ARCHIVE_NAME' entry in $SUMS" >&2
  exit 1
}
if ! (cd "$PLUGIN_ROOT/bin" && sha256sum --check --status "$TMP/expected.sha256"); then
  echo "cbm-launch: checksum mismatch for $ARCHIVE_NAME; refusing to extract" >&2
  exit 1
fi

if ! tar -xzf "$ARCHIVE" -C "$TMP"; then
  echo "cbm-launch: failed to extract $ARCHIVE_NAME" >&2
  exit 1
fi
# The archive carries more than the binary (upstream ships an install.sh too): locate the
# executable by name and fail closed on 0 or >1 matches.
mapfile -t found < <(find "$TMP" -type f -name "$BINARY_NAME")
if [ "${#found[@]}" -ne 1 ]; then
  echo "cbm-launch: expected exactly one '$BINARY_NAME' inside $ARCHIVE_NAME, found ${#found[@]}" >&2
  exit 1
fi
chmod +x "${found[0]}"
printf '%s  %s\n' "$BIN_SHA" "${found[0]}" > "$TMP/expected-bin.sha256"
if ! sha256sum --check --status "$TMP/expected-bin.sha256"; then
  echo "cbm-launch: extracted binary does not match the pinned hash; nothing cached" >&2
  exit 1
fi

# Only now is the cache touched. `mv` inside one filesystem is atomic, so two servers
# racing on a cold cache both end up with the identical verified file.
mkdir -p "$CACHE_DIR"
mv -f "${found[0]}" "$CACHE_BIN"
# `exec` replaces this process, so the EXIT trap would never fire: clean the staging
# directory up front and disarm the trap, leaving no .tmp.* residue in the cache root.
rm -rf "$TMP"
trap - EXIT
exec "$CACHE_BIN" "$@"
