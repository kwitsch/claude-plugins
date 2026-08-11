# update-cbm-bundle — script reference

**Invoke:** `bash .claude/skills/update-linux-token-efficiency/update-cbm-bundle.sh --repo-root "$(git rev-parse --show-toplevel)" [--check|--apply] [--tag <vX.Y.Z>]`

A repo-relative path is used deliberately instead of `${CLAUDE_SKILL_DIR}`: this skill only ever
runs inside the claude-plugins repository, so the path is deterministic.

## Parameters

| #   | Name              | Format        | Required | Notes                                                             |
| --- | ----------------- | ------------- | -------- | ----------------------------------------------------------------- |
| 1   | `--repo-root <p>` | absolute path | yes      | repo root containing `plugins/linux-token-efficiency`             |
| 2   | `--check`         | flag          | no       | default mode; reports drift, writes nothing                       |
| 3   | `--apply`         | flag          | no       | downloads, verifies, replaces the tarball, rewrites pin + sidecar |
| 4   | `--tag <vX.Y.Z>`  | release tag   | no       | target a specific release instead of `releases/latest`            |
| 5   | `--help`          | flag          | no       | print usage on stdout, exit 0                                     |

`--check` and `--apply` are mutually exclusive in intent; the last one given wins.

## Environment

| Var                     | Purpose                     | Required                                                                             |
| ----------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| `CBM_RELEASE_BASE_URL`  | GitHub Releases API base    | no — defaults to `https://api.github.com/repos/DeusData/codebase-memory-mcp`         |
| `CBM_DOWNLOAD_BASE_URL` | release-asset download base | no — defaults to `https://github.com/DeusData/codebase-memory-mcp/releases/download` |

Both overrides exist so the bats suite can point at a local fixture tree; no network in tests.

## What it writes

- `plugins/linux-token-efficiency/bin/codebase-memory-mcp-linux-amd64-portable.tar.gz` — the verified
  download itself, committed verbatim (the extracted 279.6 MiB binary exceeds GitHub's 100 MiB
  per-file limit, so the archive is the tracked artifact).
- `plugins/linux-token-efficiency/bin/cbm-checksums.txt` — two `sha256sum`-format lines (tarball,
  extracted binary), written atomically so it can never diverge from the pin.
- `plugins/linux-token-efficiency/cbm-bundle.json` — `cbmVersion`, `releaseTag`, `assetSha256`,
  `binarySha256`.

The archive is extracted only into the script's own `mktemp -d` scratch dir, purely to compute
`binarySha256`; that copy is discarded by the trap. **The runtime lazy-extraction cache
(`${CLAUDE_PLUGIN_DATA}/cbm/<binarySha256[0:16]>/`) is never read, written or cleared by this
script** and never needs clearing: it is content-addressed, so a pin bump simply makes the next
MCP-server start extract into a new directory. Old directories remain until a user deletes them.

Every version bump adds another full ~37.6 MiB copy to git history — keep bumps deliberate.

## Exit codes

| Code | Meaning                              | Notes                                                               |
| ---- | ------------------------------------ | ------------------------------------------------------------------- |
| 0    | up-to-date                           | prints `up-to-date <version>`                                       |
| 2    | usage / missing dependency / bad pin | needs `curl`, `jq`, `tar`, `sha256sum`, `timeout`, `mktemp`         |
| 3    | network failure                      | API query or asset download failed / timed out (`timeout -k 10 60`) |
| 4    | checksum or extraction failure       | nothing written — verification precedes every `mv`                  |
| 5    | non-Linux host                       | nothing written                                                     |
| 10   | update available (`--check`)         | prints `update-available <pinned> -> <latest>`                      |
| 11   | update applied (`--apply`)           | prints each rewritten path plus `updated <old> -> <new>`            |

## Follow-up (human, never run by the script)

```bash
git add plugins/linux-token-efficiency/bin/codebase-memory-mcp-linux-amd64-portable.tar.gz \
  plugins/linux-token-efficiency/bin/cbm-checksums.txt \
  plugins/linux-token-efficiency/cbm-bundle.json
git ls-files -s plugins/linux-token-efficiency/bin/cbm-launch.sh # must print 100755
```

The tarball is data, not executed, so it stays `100644` — no `git update-index --chmod=+x` for it.
Then bump `plugins/linux-token-efficiency/.claude-plugin/plugin.json`'s `version` and update the cbm
version stated in `plugins/linux-token-efficiency/README.md`. Tell users to restart sessions after a
plugin update, so every cbm process (server, hooks, one-shot CLI) runs the same executable build.
