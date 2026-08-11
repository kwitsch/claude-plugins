---
name: update-linux-token-efficiency
description: Checks whether the rtk binaries bundled in plugins/linux-token-efficiency/bin are still the current upstream release and refreshes them (checksum-verified, executable bit intact) when they are stale. Use before releasing a new linux-token-efficiency version or when rtk upstream ships a release.
argument-hint: "[check|apply]"
disable-model-invocation: true
allowed-tools: Read, Bash
---

# Update the bundled rtk binaries

Keeps `plugins/linux-token-efficiency/bin/*` and its pin `rtk-bundle.json` in step with the
upstream `rtk-ai/rtk` releases. Mode comes from `$ARGUMENTS`: `check` (default) or `apply`.
The skill only edits the working tree — it never commits, never bumps the plugin version and
never opens a PR.

## Step 1 — Detect the environment

```!
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo n/a)"
echo "OS=$(uname -s)"
echo "ARCH=$(uname -m)"
echo "REPO_ROOT=$REPO_ROOT"
echo "PINNED=$(jq -r '.rtkVersion // "n/a"' "$REPO_ROOT/plugins/linux-token-efficiency/rtk-bundle.json" 2>/dev/null || echo n/a)"
echo "BUNDLED=$("$REPO_ROOT/plugins/linux-token-efficiency/bin/rtk" --version 2>/dev/null || echo n/a)"
echo "CURL=$(command -v curl >/dev/null 2>&1 && echo yes || echo no)"
echo "JQ=$(command -v jq >/dev/null 2>&1 && echo yes || echo no)"
echo "TAR=$(command -v tar >/dev/null 2>&1 && echo yes || echo no)"
echo "SHA256SUM=$(command -v sha256sum >/dev/null 2>&1 && echo yes || echo no)"
```

If the block above rendered literally as `[shell command execution disabled by policy]`, stop
and report that shell execution is disabled for skills; do not guess any of those values.

Stop and report instead of proceeding when: `OS` is not `Linux` (the script exits 5 there), or any
of `CURL`/`JQ`/`TAR`/`SHA256SUM` is `no` (the script exits 2). `BUNDLED=n/a` on a non-x86_64 host is
expected and not an error — the pin, not the binary, is the source of truth.

## Step 2 — Read the script reference

Read `.claude/skills/update-linux-token-efficiency/update-rtk-bundle.reference.md` — it holds the
canonical parameter, environment and exit-code contract for the script invoked in Step 3.

## Step 3 — Run the script

Default (`check`), or when `$ARGUMENTS` is empty or `check`:

```bash
bash .claude/skills/update-linux-token-efficiency/update-rtk-bundle.sh --repo-root "$(git rev-parse --show-toplevel)" --check
```

Only when `$ARGUMENTS` is `apply`, or after reporting a pending update and the user asks for it:

```bash
bash .claude/skills/update-linux-token-efficiency/update-rtk-bundle.sh --repo-root "$(git rev-parse --show-toplevel)" --apply
```

## Step 4 — Report

One line per outcome, mapping the script's exit code per the reference doc's exit-code table:

- `0` — the bundle is current; nothing to do.
- `10` — a newer release exists; state both versions and offer to re-run with `apply`.
- `11` — the bundle was updated; list every replaced path, then print the follow-up block below.
- `2` / `3` / `4` / `5` — report the failure verbatim; nothing was written.

After a successful `apply`, print these commands for the human to run (the skill never runs them):

```bash
git update-index --chmod=+x plugins/linux-token-efficiency/bin/rtk # only needed for an already-tracked file whose mode must change
git add plugins/linux-token-efficiency/bin/rtk plugins/linux-token-efficiency/rtk-bundle.json
git ls-files -s plugins/linux-token-efficiency/bin/rtk  # index: must print 100755 before committing
git ls-tree HEAD plugins/linux-token-efficiency/bin/rtk # post-commit human sanity check only
```

Also tell the human to bump `plugins/linux-token-efficiency/.claude-plugin/plugin.json`'s `version`
and to update the rtk version stated in `plugins/linux-token-efficiency/README.md`.
