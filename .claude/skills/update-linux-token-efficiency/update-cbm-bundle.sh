#!/usr/bin/env bash
# update-cbm-bundle: compare plugins/linux-token-efficiency/cbm-bundle.json against an
# upstream codebase-memory-mcp release and, with --apply, refresh the runtime pin
# (cbmVersion / releaseTag / assetSha256 / binarySha256) plus the committed upstream
# tool-list snapshot cbm-tools.json. NOTHING is committed to git any more: the release
# tarball is downloaded into a throwaway mktemp scratch dir purely to compute
# binarySha256 and to probe the binary's own tools/list, and the scratch dir is
# discarded. This script NEVER writes anything under plugins/linux-token-efficiency/bin/,
# and never touches the runtime download cache (${CLAUDE_PLUGIN_DATA}/cbm), which the MCP
# server owns. Never commits, never bumps plugin.json, never opens a PR.
#
# Usage: update-cbm-bundle.sh --repo-root <path> [--check|--apply] [--tag <vX.Y.Z>] [--help]
# Exit: 0 up-to-date · 2 usage/missing dependency/bad pin · 3 network failure ·
#       4 checksum/extraction/probe failure · 5 non-Linux host · 10 update available (check) ·
#       11 update applied
set -euo pipefail

CBM_RELEASE_BASE_URL="${CBM_RELEASE_BASE_URL:-https://api.github.com/repos/DeusData/codebase-memory-mcp}"
CBM_DOWNLOAD_BASE_URL="${CBM_DOWNLOAD_BASE_URL:-https://github.com/DeusData/codebase-memory-mcp/releases/download}"
PLUGIN_REL="plugins/linux-token-efficiency"
BINARY_NAME="codebase-memory-mcp"
TOOLS_REL="cbm-tools.json"

usage() {
  cat << 'EOF'
usage: update-cbm-bundle.sh --repo-root <path> [--check|--apply] [--tag <vX.Y.Z>]
  --repo-root <path>  repository root holding plugins/linux-token-efficiency (required)
  --check             (default) report whether a newer cbm release exists; writes nothing
  --apply             download and verify the release, then rewrite cbm-bundle.json and
                      cbm-tools.json (never writes into bin/)
  --tag <vX.Y.Z>      target a specific release tag instead of the latest one
  --help              print this text
EOF
}

# require_arg <flag> <remaining-arg-count> -- shared usage-error guard.
require_arg() {
  [ "$2" -ge 2 ] || {
    echo "usage: $1 needs a value" >&2
    exit 2
  }
}

repo_root=""
mode="check"
tag=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo-root)
      require_arg --repo-root "$#"
      repo_root="$2"
      shift 2
      ;;
    --tag)
      require_arg --tag "$#"
      tag="$2"
      shift 2
      ;;
    --check)
      mode="check"
      shift
      ;;
    --apply)
      mode="apply"
      shift
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    *)
      echo "usage: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done
[ -n "$repo_root" ] || {
  echo "usage: --repo-root is required" >&2
  usage >&2
  exit 2
}

# 1. Linux only -- the probed artifact is a Linux executable and the sha256sum/tar flags
#    below are Linux-specific.
[ "$(uname -s)" = "Linux" ] || {
  echo "refusing to run on a non-Linux host: $(uname -s)" >&2
  exit 5
}

# 2. Hard dependencies.
for dep in curl jq tar sha256sum timeout mktemp; do
  command -v "$dep" > /dev/null 2>&1 || {
    echo "missing required dependency: $dep" >&2
    exit 2
  }
done

# 3. Read the pin. Exactly one bundled asset is supported (same rule the runtime enforces).
pin="$repo_root/$PLUGIN_REL/cbm-bundle.json"
[ -f "$pin" ] || {
  echo "pin file not found: $pin" >&2
  exit 2
}
jq empty "$pin" > /dev/null 2>&1 || {
  echo "pin file is not valid JSON: $pin" >&2
  exit 2
}
# One jq call, one read of the pin file, for all three fields.
IFS=$'\t' read -r pinned binary_count asset < <(
  jq -r '[(.cbmVersion // ""), ((.binaries // []) | length), (.binaries[0].asset // "")] | @tsv' "$pin"
)
[ -n "$pinned" ] || {
  echo "pin file has no cbmVersion: $pin" >&2
  exit 2
}
[ "$binary_count" -eq 1 ] || {
  echo "pin file must list exactly one asset, found $binary_count: $pin" >&2
  exit 2
}
[ -n "$asset" ] || {
  echo "pin file entry is missing asset: $pin" >&2
  exit 2
}

# 4. Resolve the target release. Every network call is timeout -k 10 60 wrapped.
if [ -z "$tag" ]; then
  if ! api_json="$(timeout -k 10 60 curl -fsSL "$CBM_RELEASE_BASE_URL/releases/latest")"; then
    echo "failed to query the upstream release API" >&2
    exit 3
  fi
  tag="$(printf '%s' "$api_json" | jq -r '.tag_name // empty' 2> /dev/null || true)"
  [ -n "$tag" ] || {
    echo "could not read tag_name from the release API response" >&2
    exit 3
  }
fi
latest="${tag#v}"

# 5. Compare (string equality, no semver ordering -- a retag reads as "update available").
if [ "$latest" = "$pinned" ]; then
  echo "up-to-date $pinned"
  exit 0
fi
if [ "$mode" = "check" ]; then
  echo "update-available $pinned -> $latest"
  exit 10
fi

# 6. Apply: download and verify everything inside a throwaway scratch dir.
tmp="$(mktemp -d)" || {
  echo "failed to create a temporary directory" >&2
  exit 2
}
trap 'rm -rf "$tmp"' EXIT

if ! timeout -k 10 60 curl -fsSL -o "$tmp/checksums.txt" "$CBM_DOWNLOAD_BASE_URL/$tag/checksums.txt"; then
  echo "failed to download checksums.txt for $tag" >&2
  exit 3
fi
if ! timeout -k 10 60 curl -fsSL -o "$tmp/$asset" "$CBM_DOWNLOAD_BASE_URL/$tag/$asset"; then
  echo "failed to download $asset for $tag" >&2
  exit 3
fi

# Exactly one checksums.txt entry for the asset -- 0 or >1 fails closed instead of being
# silently skipped by --ignore-missing.
expected="$tmp/expected.sha256"
# sha256sum -b (binary mode) prefixes the filename column with '*'; match either form.
matches="$(awk -v f="$asset" '$2 == f || $2 == "*" f' "$tmp/checksums.txt")"
line_count="$(printf '%s' "$matches" | grep -c . || true)"
if [ "$line_count" -eq 0 ]; then
  echo "no checksum entry for $asset in checksums.txt" >&2
  exit 4
fi
if [ "$line_count" -gt 1 ]; then
  echo "duplicate checksum entries for $asset in checksums.txt" >&2
  exit 4
fi
printf '%s\n' "$matches" > "$expected"
if ! (cd "$tmp" && sha256sum --check --status "$expected"); then
  echo "checksum verification failed for $tag" >&2
  exit 4
fi
asset_sha="$(awk -v f="$asset" '$2 == f { print $1 }' "$tmp/checksums.txt" | head -n 1)"

# 7. Throwaway extraction: binarySha256 plus the tool-list probe. Discarded by the trap.
mkdir -p "$tmp/x"
if ! tar -xzf "$tmp/$asset" -C "$tmp/x"; then
  echo "failed to extract $asset" >&2
  exit 4
fi
mapfile -t found < <(find "$tmp/x" -type f -name "$BINARY_NAME")
if [ "${#found[@]}" -ne 1 ]; then
  echo "expected exactly one $BINARY_NAME inside $asset, found ${#found[@]}" >&2
  exit 4
fi
chmod +x "${found[0]}"
binary_sha="$(sha256sum "${found[0]}" | cut -d' ' -f1)"

# 8. Probe the extracted binary's own tools/list over stdio (no args => cbm's MCP mode).
#    The exit status is deliberately ignored: a server that keeps running until stdin EOF
#    can be reaped by `timeout` even after answering. The tool array is the real check.
probe="$tmp/probe.ndjson"
set +e
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"update-cbm-bundle","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | timeout -k 10 60 "${found[0]}" > "$probe" 2> /dev/null
set -e
tools="$(jq -sc '[.[] | select(.id == 2) | .result.tools[]? | {name, description, inputSchema}] | unique_by(.name)' "$probe" 2> /dev/null || true)"
tool_count="$(printf '%s' "${tools:-[]}" | jq -r 'length' 2> /dev/null || echo 0)"
if [ "${tool_count:-0}" -lt 1 ]; then
  echo "could not read a tool list from $BINARY_NAME $tag; refusing to write a partial snapshot" >&2
  exit 4
fi

# 9. Render BOTH machine-owned files into the scratch dir first, so a jq failure can never
#    leave one rewritten and the other stale -- neither working-tree file is touched until
#    both renders have succeeded.
tools_file="$repo_root/$PLUGIN_REL/$TOOLS_REL"
jq -n --arg v "$latest" --argjson t "$tools" '{cbmVersion: $v, tools: $t}' > "$tmp/tools-next.json"
jq --arg a "$asset_sha" --arg b "$binary_sha" --arg v "$latest" --arg t "$tag" \
  '.binaries[0].assetSha256 = $a | .binaries[0].binarySha256 = $b | .cbmVersion = $v | .releaseTag = $t' \
  "$pin" > "$tmp/pin-next.json"

# 10. Both renders succeeded -- move both into place back-to-back.
mv -f "$tmp/tools-next.json" "$tools_file"
echo "rewrote $PLUGIN_REL/$TOOLS_REL ($tool_count tools)"
mv -f "$tmp/pin-next.json" "$pin"
echo "rewrote $PLUGIN_REL/cbm-bundle.json"

echo "updated $pinned -> $latest"
exit 11
