# update-cbm-bundle — script reference

**Invoke:** `bash .claude/skills/update-linux-token-efficiency/update-cbm-bundle.sh --repo-root "$(git rev-parse --show-toplevel)" [--check|--apply] [--tag <vX.Y.Z>]`

A repo-relative path is used deliberately instead of `${CLAUDE_SKILL_DIR}`: this skill only ever
runs inside the claude-plugins repository, so the path is deterministic.

## Parameters

| #   | Name              | Format        | Required | Notes                                                                        |
| --- | ----------------- | ------------- | -------- | ---------------------------------------------------------------------------- |
| 1   | `--repo-root <p>` | absolute path | yes      | repo root containing `plugins/linux-token-efficiency`                        |
| 2   | `--check`         | flag          | no       | default mode; reports drift, writes nothing                                  |
| 3   | `--apply`         | flag          | no       | downloads, verifies and probes the release, rewrites the pin + tool snapshot |
| 4   | `--tag <vX.Y.Z>`  | release tag   | no       | target a specific release instead of `releases/latest`                       |
| 5   | `--help`          | flag          | no       | print usage on stdout, exit 0                                                |

`--check` and `--apply` are mutually exclusive in intent; the last one given wins.

## Environment

| Var                     | Purpose                     | Required                                                                             |
| ----------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| `CBM_RELEASE_BASE_URL`  | GitHub Releases API base    | no — defaults to `https://api.github.com/repos/DeusData/codebase-memory-mcp`         |
| `CBM_DOWNLOAD_BASE_URL` | release-asset download base | no — defaults to `https://github.com/DeusData/codebase-memory-mcp/releases/download` |

Both overrides exist so the bats suite can point at a local fixture tree; no network in tests.

## What it writes

- `plugins/linux-token-efficiency/cbm-bundle.json` — `cbmVersion`, `releaseTag`,
  `binaries[0].asset`, `assetSha256`, `binarySha256`. This pin is read at RUNTIME by
  `plugins/linux-token-efficiency/mcp/linux-token-efficiency-mcp`, so it is the only thing that can move
  users to a new cbm version.
- `plugins/linux-token-efficiency/cbm-tools.json` — `{cbmVersion, tools:[{name, description, inputSchema}]}`,
  regenerated from the extracted binary's own `tools/list` probe. An empty tool list fails
  closed (exit 4) with neither file rewritten.

**Nothing is committed to git besides those two JSON files.** No binary, no tarball, no
checksum sidecar: the archive is downloaded into the script's own `mktemp -d` scratch dir
purely to compute `binarySha256` and to probe `tools/list`, and that copy is discarded by
the trap. The script **never** writes anything under `plugins/linux-token-efficiency/bin/`
(which holds only `bin/rtk`), and never reads, writes or clears the runtime download cache
`${CLAUDE_PLUGIN_DATA}/cbm/<binarySha256[0:16]>/` — that cache is content-addressed and
belongs to `mcp/linux-token-efficiency-mcp`, so a pin bump simply makes the next server start download into
a new directory. Old directories remain until a user deletes them.

## Exit codes

| Code | Meaning                              | Notes                                                                           |
| ---- | ------------------------------------ | ------------------------------------------------------------------------------- |
| 0    | up-to-date                           | prints `up-to-date <version>`                                                   |
| 2    | usage / missing dependency / bad pin | needs `curl`, `jq`, `tar`, `sha256sum`, `timeout`, `mktemp`                     |
| 3    | network failure                      | API query or asset download failed / timed out (`timeout -k 10 60`)             |
| 4    | checksum or extraction failure       | nothing written — verification and the tools/list probe both precede every `mv` |
| 5    | non-Linux host                       | nothing written                                                                 |
| 10   | update available (`--check`)         | prints `update-available <pinned> -> <latest>`                                  |
| 11   | update applied (`--apply`)           | prints each rewritten path plus `updated <old> -> <new>`                        |

## Follow-up (human, never run by the script)

```bash
git add plugins/linux-token-efficiency/cbm-bundle.json plugins/linux-token-efficiency/cbm-tools.json
git ls-files -s plugins/linux-token-efficiency/mcp/linux-token-efficiency-mcp # must print 100755
```

The repo sets `core.fileMode=false`, so a NEW executable needs `chmod +x` **and**
`git update-index --chmod=+x`; `mcp/linux-token-efficiency-mcp` is already tracked as `100755`, so this is a
verification step, not a fix. Then bump
`plugins/linux-token-efficiency/.claude-plugin/plugin.json`'s `version` and update the cbm
version stated in `plugins/linux-token-efficiency/README.md`. Tell users to restart sessions
after a plugin update, so every cbm process runs the same executable build — the first
session after the bump downloads the new release once.
