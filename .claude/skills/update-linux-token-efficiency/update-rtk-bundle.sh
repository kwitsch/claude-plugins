#!/usr/bin/env bash
# update-rtk-bundle: compare plugins/linux-token-efficiency/rtk-bundle.json against an
# upstream rtk release and, with --apply, re-download every bundled binary
# (checksum-verified against the release's own checksums.txt), replace it in the working
# tree and rewrite the pin. Never commits, never bumps plugin.json, never opens a PR.
#
# Usage: update-rtk-bundle.sh --repo-root <path> [--check|--apply] [--tag <vX.Y.Z>] [--help]
# Exit: 0 up-to-date · 2 usage/missing dependency/bad pin · 3 network failure ·
#       4 checksum/extraction failure · 5 non-Linux host · 10 update available (check) ·
#       11 update applied
set -euo pipefail

RTK_RELEASE_BASE_URL="${RTK_RELEASE_BASE_URL:-https://api.github.com/repos/rtk-ai/rtk}"
RTK_DOWNLOAD_BASE_URL="${RTK_DOWNLOAD_BASE_URL:-https://github.com/rtk-ai/rtk/releases/download}"
PLUGIN_REL="plugins/linux-token-efficiency"

usage() {
  cat << 'EOF'
usage: update-rtk-bundle.sh --repo-root <path> [--check|--apply] [--tag <vX.Y.Z>]
  --repo-root <path>  repository root holding plugins/linux-token-efficiency (required)
  --check             (default) report whether a newer rtk release exists; writes nothing
  --apply             download, verify and replace every bundled binary, rewrite the pin
  --tag <vX.Y.Z>      target a specific release tag instead of the latest one
  --help              print this text
EOF
}

# require_arg <flag> <remaining-arg-count> -- shared usage-error guard for every
# value-taking flag below.
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

# 1. Linux only -- the extracted binary's exec bit and the sha256sum/tar flags below
#    are Linux-specific, and the bundled artifacts are Linux executables.
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

# 3. Read the pin.
pin="$repo_root/$PLUGIN_REL/rtk-bundle.json"
[ -f "$pin" ] || {
  echo "pin file not found: $pin" >&2
  exit 2
}
jq empty "$pin" > /dev/null 2>&1 || {
  echo "pin file is not valid JSON: $pin" >&2
  exit 2
}
pinned="$(jq -r '.rtkVersion // empty' "$pin")"
[ -n "$pinned" ] || {
  echo "pin file has no rtkVersion: $pin" >&2
  exit 2
}
binary_count="$(jq -r '(.binaries // []) | length' "$pin")"
[ "$binary_count" -ge 1 ] || {
  echo "pin file lists no binaries: $pin" >&2
  exit 2
}

# 4. Resolve the target release. Every network call is timeout -k 10 60 wrapped so a
#    hung curl surfaces as exit 3 instead of stalling forever.
if [ -z "$tag" ]; then
  if ! api_json="$(timeout -k 10 60 curl -fsSL "$RTK_RELEASE_BASE_URL/releases/latest")"; then
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

# 5./6. Compare (string equality, no semver ordering -- a retag reads as "update available").
if [ "$latest" = "$pinned" ]; then
  echo "up-to-date $pinned"
  exit 0
fi
if [ "$mode" = "check" ]; then
  echo "update-available $pinned -> $latest"
  exit 10
fi

# 7. Apply: download everything and verify BEFORE the first mv.
tmp="$(mktemp -d)" || {
  echo "failed to create a temporary directory" >&2
  exit 2
}
trap 'rm -rf "$tmp"' EXIT

if ! timeout -k 10 60 curl -fsSL -o "$tmp/checksums.txt" "$RTK_DOWNLOAD_BASE_URL/$tag/checksums.txt"; then
  echo "failed to download checksums.txt for $tag" >&2
  exit 3
fi

mapfile -t assets < <(jq -r '.binaries[].asset' "$pin")
mapfile -t targets < <(jq -r '.binaries[].path' "$pin")

for asset in "${assets[@]}"; do
  if ! timeout -k 10 60 curl -fsSL -o "$tmp/$asset" "$RTK_DOWNLOAD_BASE_URL/$tag/$asset"; then
    echo "failed to download $asset for $tag" >&2
    exit 3
  fi
done

if ! (cd "$tmp" && sha256sum --check --ignore-missing --status checksums.txt); then
  echo "checksum verification failed for $tag" >&2
  exit 4
fi

# 8a. Extract every asset first -- no target file is touched until all extractions passed.
extracted_paths=()
i=0
for asset in "${assets[@]}"; do
  xdir="$tmp/x-$i"
  mkdir -p "$xdir"
  if ! tar -xzf "$tmp/$asset" -C "$xdir"; then
    echo "failed to extract $asset" >&2
    exit 4
  fi
  found="$(find "$xdir" -type f -name rtk | head -n 1)"
  [ -n "$found" ] || {
    echo "no rtk binary found inside $asset" >&2
    exit 4
  }
  # A mktemp/extract path never inherits the target's mode -- force it here.
  chmod +x "$found"
  extracted_paths+=("$found")
  i=$((i + 1))
done

# 8b. Move each extracted binary into place. Every mv is &&-gated on its own preceding
#     step; no `|| true` and no subshell may swallow a status here.
i=0
for target in "${targets[@]}"; do
  dest="$repo_root/$PLUGIN_REL/$target"
  mkdir -p "$(dirname "$dest")" && mv -f "${extracted_paths[$i]}" "$dest"
  chmod +x "$dest"
  echo "replaced $PLUGIN_REL/$target"
  i=$((i + 1))
done

# 9. Rewrite the (entirely machine-owned) pin via jq, gated on jq succeeding.
cp "$pin" "$tmp/pin-work.json"
i=0
for asset in "${assets[@]}"; do
  dest="$repo_root/$PLUGIN_REL/${targets[$i]}"
  asset_sha="$(awk -v f="$asset" '$2 == f { print $1 }' "$tmp/checksums.txt" | head -n 1)"
  [ -n "$asset_sha" ] || {
    echo "no checksum entry for $asset" >&2
    exit 4
  }
  binary_sha="$(sha256sum "$dest" | cut -d' ' -f1)"
  jq --argjson i "$i" --arg a "$asset_sha" --arg b "$binary_sha" \
    '.binaries[$i].assetSha256 = $a | .binaries[$i].binarySha256 = $b' \
    "$tmp/pin-work.json" > "$tmp/pin-next.json" \
    && mv -f "$tmp/pin-next.json" "$tmp/pin-work.json"
  i=$((i + 1))
done
jq --arg v "$latest" --arg t "$tag" '.rtkVersion = $v | .releaseTag = $t' \
  "$tmp/pin-work.json" > "$tmp/pin-final.json" \
  && mv -f "$tmp/pin-final.json" "$pin"

# 10. Report.
echo "rewrote $PLUGIN_REL/rtk-bundle.json"
echo "updated $pinned -> $latest"
exit 11
