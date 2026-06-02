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

# cctools_is_legacy_file <path>
# Returns 0 (true) only if <path> is an existing, non-empty, regular file whose
# on-disk encoding is "legacy" — i.e. NOT UTF-8 and NOT ASCII (e.g. ISO-8859-1 /
# Windows-1252). Returns 1 (safe) for everything else: missing, empty, a
# directory/special file, ASCII, UTF-8, or detected binary.
#
# Classification (precision-biased; fail OPEN = treat as safe on uncertainty):
#   1. `file --mime-encoding`: us-ascii / utf-8 / binary -> safe; anything else
#      (iso-8859-1, unknown-8bit, ...) -> legacy.
#   2. If `file` is unavailable, fall back to `iconv -f UTF-8 -t UTF-8`: valid
#      UTF-8 (incl. ASCII) round-trips with exit 0 -> safe; failure -> legacy.
#   3. If NEITHER tool exists, fail open (return 1 = safe).
#
# NOTE: the cc-tools binary is intentionally NOT used here — its detector
# mislabels plain ASCII as ISO-8859-1, which would cause false positives.
cctools_is_legacy_file() {
  local path="$1"
  # Must be an existing, non-empty, regular file.
  [ -n "$path" ] || return 1
  [ -f "$path" ] || return 1
  [ -s "$path" ] || return 1   # -s also rejects empty files

  if command -v file >/dev/null 2>&1; then
    local enc
    enc=$(file --mime-encoding -b "$path" 2>/dev/null | tr '[:upper:]' '[:lower:]')
    # Keep only the leading token (drop any trailing whitespace / CR / suffix),
    # so a stray space or CRLF can't push a safe value into the legacy branch.
    enc="${enc%%[[:space:]]*}"
    case "$enc" in
      us-ascii | ascii | utf-8 | utf8 | binary | '')
        return 1 ;;   # safe (or undetermined -> fail open)
      *)
        return 0 ;;   # legacy encoding
    esac
  elif command -v iconv >/dev/null 2>&1; then
    if iconv -f UTF-8 -t UTF-8 "$path" >/dev/null 2>&1; then
      return 1        # valid UTF-8 / ASCII -> safe
    else
      return 0        # not valid UTF-8 -> legacy
    fi
  fi

  # Neither tool available -> fail open (safe).
  return 1
}
