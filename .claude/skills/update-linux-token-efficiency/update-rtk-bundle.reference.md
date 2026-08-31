# update-rtk-bundle — script reference

**Invoke:** `bash .claude/skills/update-linux-token-efficiency/update-rtk-bundle.sh --repo-root "$(git rev-parse --show-toplevel)" [--check|--apply] [--tag <vX.Y.Z>]`

A repo-relative path is used deliberately instead of `${CLAUDE_SKILL_DIR}`: this skill only ever
runs inside the claude-plugins repository, so the path is deterministic.

## Parameters

| #   | Name              | Format        | Required | Notes                                                               |
| --- | ----------------- | ------------- | -------- | ------------------------------------------------------------------- |
| 1   | `--repo-root <p>` | absolute path | yes      | repo root containing `plugins/linux-token-efficiency`               |
| 2   | `--check`         | flag          | no       | default mode; reports drift, writes nothing                         |
| 3   | `--apply`         | flag          | no       | downloads, verifies, and recomputes the pin (never writes a binary) |
| 4   | `--tag <vX.Y.Z>`  | release tag   | no       | target a specific release instead of `releases/latest`              |
| 5   | `--help`          | flag          | no       | print usage on stdout, exit 0                                       |

`--check` and `--apply` are mutually exclusive in intent; the last one given wins.

## Environment

| Var                     | Purpose                     | Required                                                           |
| ----------------------- | --------------------------- | ------------------------------------------------------------------ |
| `RTK_RELEASE_BASE_URL`  | GitHub Releases API base    | no — defaults to `https://api.github.com/repos/rtk-ai/rtk`         |
| `RTK_DOWNLOAD_BASE_URL` | release-asset download base | no — defaults to `https://github.com/rtk-ai/rtk/releases/download` |

Both overrides exist so the bats suite can point at a local fixture tree; no network in tests.

## Exit codes

| Code | Meaning                              | Notes                                                               |
| ---- | ------------------------------------ | ------------------------------------------------------------------- |
| 0    | up-to-date                           | prints `up-to-date <version>`                                       |
| 2    | usage / missing dependency / bad pin | needs `curl`, `jq`, `tar`, `sha256sum`, `timeout`, `mktemp`         |
| 3    | network failure                      | API query or asset download failed / timed out (`timeout -k 10 60`) |
| 4    | checksum or extraction failure       | nothing written — verification precedes every `mv`                  |
| 5    | non-Linux host                       | nothing written                                                     |
| 10   | update available (`--check`)         | prints `update-available <pinned> -> <latest>`                      |
| 11   | update applied (`--apply`)           | prints `rewrote …/rtk-bundle.json` plus `updated <old> -> <new>`    |

## Follow-up (human, never run by the script)

```bash
git add plugins/linux-token-efficiency/rtk-bundle.json
```

Then bump `plugins/linux-token-efficiency/.claude-plugin/plugin.json`'s `version` and update the
rtk version stated in `plugins/linux-token-efficiency/README.md`. There is no committed binary to
re-stage — the runtime installer (`hooks/rtk-install.mjs`) places rtk into `~/.local/bin/rtk`.
