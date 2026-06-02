#!/usr/bin/env bash
# Shared helpers for the cctools-edit hooks: platform detection, release-asset
# naming, and the resolved install paths. Sourced by install-cctools.sh,
# session-start.sh and redirect-to-cctools.sh so all three agree on where the
# binary lives and which release asset to fetch. Sourcing has no side effects.
#
# Overridable via environment (handy for tests / custom layouts):
#   CCTOOLS_VERSION  release tag to install            (default v1.0.0.0)
#   CCTOOLS_HOME     install directory                 (default ~/.claude/cctools)
#   CCTOOLS_BIN      full path to the binary           (default $CCTOOLS_HOME/cctools[.exe])
#   CCTOOLS_OS       override `uname -s` for detection
#   CCTOOLS_ARCH     override `uname -m` for detection

# Pinned release tag. Override CCTOOLS_VERSION to track a different one.
: "${CCTOOLS_VERSION:=v1.0.0.0}"

# Install directory.
cctools_home() { printf '%s' "${CCTOOLS_HOME:-${HOME:-.}/.claude/cctools}"; }

# Normalise `uname -s` (or the CCTOOLS_OS override) to the release's GOOS token.
cctools_goos() {
  local os="${CCTOOLS_OS:-$(uname -s 2>/dev/null)}"
  case "$os" in
    Linux*)                                printf 'linux' ;;
    Darwin*)                               printf 'darwin' ;;
    FreeBSD*)                              printf 'freebsd' ;;
    MINGW*|MSYS*|CYGWIN*|Windows*|windows) printf 'windows' ;;
    *) printf '%s' "$(printf '%s' "$os" | tr '[:upper:]' '[:lower:]')" ;;
  esac
}

# Normalise `uname -m` (or the CCTOOLS_ARCH override) to the release's GOARCH token.
cctools_goarch() {
  local arch="${CCTOOLS_ARCH:-$(uname -m 2>/dev/null)}"
  case "$arch" in
    x86_64|amd64)            printf 'amd64' ;;
    aarch64|arm64)           printf 'arm64' ;;
    i386|i486|i586|i686|386) printf '386' ;;
    *)                       printf '%s' "$arch" ;;
  esac
}

# Windows ships a .zip with cctools.exe; everything else a .tar.gz with cctools.
cctools_ext() { [ "$(cctools_goos)" = windows ] && printf 'zip' || printf 'tar.gz'; }
cctools_exe() { [ "$(cctools_goos)" = windows ] && printf '.exe' || printf ''; }

# Release asset filename, e.g. cctools_linux_amd64.tar.gz / cctools_windows_amd64.zip
cctools_asset() { printf 'cctools_%s_%s.%s' "$(cctools_goos)" "$(cctools_goarch)" "$(cctools_ext)"; }

# Full path to the installed binary.
cctools_bin() {
  if [ -n "${CCTOOLS_BIN:-}" ]; then printf '%s' "$CCTOOLS_BIN"; return; fi
  printf '%s/cctools%s' "$(cctools_home)" "$(cctools_exe)"
}

# GitHub release download URL for this platform's asset.
cctools_download_url() {
  printf 'https://github.com/devslimbr/cc-tools/releases/download/%s/%s' \
    "$CCTOOLS_VERSION" "$(cctools_asset)"
}
