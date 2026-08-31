---
name: update-linux-token-efficiency
description: Checks whether the rtk binaries and the codebase-memory-mcp release tarball bundled in plugins/linux-token-efficiency are still the current upstream releases and refreshes them (checksum-verified, executable bit intact) when they are stale. Use before releasing a new linux-token-efficiency version or when rtk-ai/rtk or DeusData/codebase-memory-mcp ships a release.
argument-hint: "[check|apply]"
disable-model-invocation: true
allowed-tools: Read, Bash
---

# Update the rtk pin

Keeps the pin `plugins/linux-token-efficiency/rtk-bundle.json` in step with the upstream
`rtk-ai/rtk` releases; no binary is committed (the runtime installer places rtk into
`~/.local/bin/rtk`). Mode comes from `$ARGUMENTS`: `check` (default) or `apply`.
The same skill keeps the pin `cbm-bundle.json` and the upstream tool-list snapshot
`cbm-tools.json` in step with the upstream `DeusData/codebase-memory-mcp` releases; nothing
cbm-related is committed to git.
The skill only edits the working tree — it never commits, never bumps the plugin version and
never opens a PR.

## Step 1 — Detect the environment

```!
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo n/a)"
echo "OS=$(uname -s)"
echo "ARCH=$(uname -m)"
echo "REPO_ROOT=$REPO_ROOT"
echo "PINNED=$(jq -r '.rtkVersion // "n/a"' "$REPO_ROOT/plugins/linux-token-efficiency/rtk-bundle.json" 2>/dev/null || echo n/a)"
echo "INSTALLER=$([ -x "$REPO_ROOT/plugins/linux-token-efficiency/hooks/rtk-install.mjs" ] && echo yes || echo no)"
echo "CBM_PINNED=$(jq -r '.cbmVersion // "n/a"' "$REPO_ROOT/plugins/linux-token-efficiency/cbm-bundle.json" 2> /dev/null || echo n/a)"
echo "CBM_SERVER=$([ -x "$REPO_ROOT/plugins/linux-token-efficiency/mcp/server.mjs" ] && echo yes || echo no)"
echo "CURL=$(command -v curl >/dev/null 2>&1 && echo yes || echo no)"
echo "JQ=$(command -v jq >/dev/null 2>&1 && echo yes || echo no)"
echo "TAR=$(command -v tar >/dev/null 2>&1 && echo yes || echo no)"
echo "SHA256SUM=$(command -v sha256sum >/dev/null 2>&1 && echo yes || echo no)"
```

If the block above rendered literally as `[shell command execution disabled by policy]`, stop
and report that shell execution is disabled for skills; do not guess any of those values.

Stop and report instead of proceeding when: `OS` is not `Linux` (the script exits 5 there), or any
of `CURL`/`JQ`/`TAR`/`SHA256SUM` is `no` (the script exits 2). The pin, not any binary, is the
source of truth — the script recomputes it and no artifact is committed to the tree.

## Step 2 — Read the script references

Read `.claude/skills/update-linux-token-efficiency/update-rtk-bundle.reference.md` **and**
`.claude/skills/update-linux-token-efficiency/update-cbm-bundle.reference.md` — they hold the
canonical parameter, environment and exit-code contract for the two scripts invoked in Step 3.
Both share the same `0` / `2` / `3` / `4` / `5` / `10` / `11` exit-code contract.

## Step 3 — Run the script

Default (`check`), or when `$ARGUMENTS` is empty or `check`:

```bash
bash .claude/skills/update-linux-token-efficiency/update-rtk-bundle.sh --repo-root "$(git rev-parse --show-toplevel)" --check
```

Only when `$ARGUMENTS` is `apply`, or after reporting a pending update and the user asks for it:

```bash
bash .claude/skills/update-linux-token-efficiency/update-rtk-bundle.sh --repo-root "$(git rev-parse --show-toplevel)" --apply
```

Then the same two modes for the codebase-memory-mcp bundle (run independently — one artifact being
current says nothing about the other):

```bash
bash .claude/skills/update-linux-token-efficiency/update-cbm-bundle.sh --repo-root "$(git rev-parse --show-toplevel)" --check
```

```bash
bash .claude/skills/update-linux-token-efficiency/update-cbm-bundle.sh --repo-root "$(git rev-parse --show-toplevel)" --apply
```

## Step 4 — Report

One line per outcome, mapping the script's exit code per the reference doc's exit-code table:

- `0` — the bundle is current; nothing to do.
- `10` — a newer release exists; state both versions and offer to re-run with `apply`.
- `11` — the bundle was updated; list every replaced path, then print the follow-up block below.
- `2` / `3` / `4` / `5` — report the failure verbatim; nothing was written.

After a successful `apply`, print these commands for the human to run (the skill never runs them):

```bash
git add plugins/linux-token-efficiency/rtk-bundle.json
git ls-files -s plugins/linux-token-efficiency/hooks/rtk-install.mjs # must print 100755
```

Also tell the human to bump `plugins/linux-token-efficiency/.claude-plugin/plugin.json`'s `version`
and update the rtk version stated in `plugins/linux-token-efficiency/README.md`. No binary is
committed — the installer downloads rtk into `~/.local/bin/rtk` on the next session.

After a successful cbm `apply`, print this block instead (only two machine-owned JSON files
change; nothing cbm-related is committed as a binary, tarball or checksum sidecar):

```bash
git add plugins/linux-token-efficiency/cbm-bundle.json plugins/linux-token-efficiency/cbm-tools.json
git ls-files -s plugins/linux-token-efficiency/mcp/server.mjs # must print 100755
```

Also tell the human: bump `plugins/linux-token-efficiency/.claude-plugin/plugin.json`'s `version`,
update the cbm version stated in `plugins/linux-token-efficiency/README.md`, and restart sessions
after the plugin update so every cbm process runs the same executable build. The runtime download
cache is content-addressed and is never touched by this skill; the first session after the bump
downloads the new release once.
