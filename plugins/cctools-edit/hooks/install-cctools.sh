#!/usr/bin/env bash
# Idempotently install the cc-tools binary for this host, invoked from the
# SessionStart hook. Fail-open by design: any error logs to stderr and exits 0.
# A failed install must never break the session — and because the PreToolUse
# hook only fires when the binary is present, a missing binary simply leaves the
# native file tools usable.
#
# Modes:
#   install-cctools.sh                 install if missing/broken, else no-op
#   install-cctools.sh --print-asset   print the resolved release asset name
#   install-cctools.sh --print-bin     print the resolved binary path
#   install-cctools.sh --print-url     print the resolved download URL
#
# Environment:
#   CCTOOLS_FORCE=1         reinstall even if a runnable binary is present
#   CCTOOLS_SKIP_INSTALL=1  do nothing (for users who manage the binary themselves)
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

log() { printf 'cctools-edit: %s\n' "$1" >&2; }

case "${1:-}" in
  --print-asset) cctools_asset;        echo; exit 0 ;;
  --print-bin)   cctools_bin;          echo; exit 0 ;;
  --print-url)   cctools_download_url; echo; exit 0 ;;
esac

[ -n "${CCTOOLS_SKIP_INSTALL:-}" ] && exit 0

BIN="$(cctools_bin)"
HOME_DIR="$(cctools_home)"

# Already installed and runnable -> nothing to do.
if [ -z "${CCTOOLS_FORCE:-}" ] && [ -x "$BIN" ] && "$BIN" --version >/dev/null 2>&1; then
  exit 0
fi

ASSET="$(cctools_asset)"
URL="$(cctools_download_url)"

# Need a downloader.
if command -v curl >/dev/null 2>&1; then
  download() { curl -fsSL -o "$1" "$2"; }
elif command -v wget >/dev/null 2>&1; then
  download() { wget -qO "$1" "$2"; }
else
  log "neither curl nor wget found; cannot install. Native file tools stay enabled."
  exit 0
fi

tmp="$(mktemp -d 2>/dev/null)" || { log "mktemp failed; cannot install."; exit 0; }
trap 'rm -rf "$tmp"' EXIT

log "installing cc-tools $CCTOOLS_VERSION ($ASSET) -> $BIN"
if ! download "$tmp/$ASSET" "$URL"; then
  log "download failed: $URL (native file tools stay enabled)"
  exit 0
fi

# Extract the archive.
case "$ASSET" in
  *.zip)
    command -v unzip >/dev/null 2>&1 || { log "unzip not found; cannot extract $ASSET"; exit 0; }
    unzip -qo "$tmp/$ASSET" -d "$tmp/x" || { log "unzip failed"; exit 0; } ;;
  *.tar.gz)
    mkdir -p "$tmp/x"
    tar xzf "$tmp/$ASSET" -C "$tmp/x" || { log "tar extract failed"; exit 0; } ;;
  *)
    log "unknown asset type: $ASSET"; exit 0 ;;
esac

# The archive holds <os>_<arch>/cctools[.exe] (plus docs/); find the binary
# wherever it landed.
EXE="cctools$(cctools_exe)"
src="$(find "$tmp/x" -type f -name "$EXE" 2>/dev/null | head -1)"
[ -n "$src" ] || { log "binary $EXE not found inside $ASSET"; exit 0; }

# Ensure both the home dir (for prompt.md) and the binary's own dir exist — they
# differ when CCTOOLS_BIN points outside CCTOOLS_HOME.
mkdir -p "$HOME_DIR" "$(dirname "$BIN")" || { log "cannot create install dirs"; exit 0; }

# Install atomically: copy into the destination dir under a temp name, mark
# executable, then mv into place so a half-written binary is never observed.
dst_tmp="$BIN.tmp.$$"
if ! { cp "$src" "$dst_tmp" && chmod +x "$dst_tmp" && mv -f "$dst_tmp" "$BIN"; }; then
  log "install copy failed"
  rm -f "$dst_tmp"
  exit 0
fi

# Stash the shipped prompt.md as an on-disk reference; session-start.sh points
# the model at it when present.
prompt_src="$(find "$tmp/x" -type f -name 'prompt.md' 2>/dev/null | head -1)"
[ -n "$prompt_src" ] && cp "$prompt_src" "$HOME_DIR/prompt.md" 2>/dev/null

if "$BIN" --version >/dev/null 2>&1; then
  log "installed $("$BIN" --version 2>/dev/null | head -1)"
else
  log "installed but '$BIN --version' did not run cleanly"
fi
exit 0
