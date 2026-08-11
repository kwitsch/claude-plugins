# CLAUDE.md — linux-token-efficiency

Bundles the upstream rtk Linux binary and auto-rewrites Bash commands through it.

## Committed binary and the exec bit

`bin/rtk` is the extracted upstream release binary, committed verbatim (~10 MB, no Git LFS —
the repo already commits multi-MB `.wasm` sidecars in `universal-format`). `.gitattributes` marks
`plugins/linux-token-efficiency/bin/*` as `binary` so a `text=auto` repo never EOL-translates it.

**This repo sets `core.fileMode=false`**, so a filesystem `chmod +x` is NOT picked up by `git add`.
`.claude/rules/bin-executable.md` and `.claude/rules/hooks-executable.md` prescribe only
`chmod +x` + `ls -la` and never mention this — following them literally commits a `100644` that
Claude Code then silently skips. Whenever `bin/rtk` or `hooks/rtk-rewrite.mjs` is added or replaced:

```bash
chmod +x plugins/linux-token-efficiency/bin/rtk plugins/linux-token-efficiency/hooks/rtk-rewrite.mjs
git add plugins/linux-token-efficiency/bin/rtk plugins/linux-token-efficiency/hooks/rtk-rewrite.mjs
git update-index --chmod=+x plugins/linux-token-efficiency/bin/rtk plugins/linux-token-efficiency/hooks/rtk-rewrite.mjs
git ls-files -s plugins/linux-token-efficiency/bin/rtk # must print 100755
```

Automated assertions read the **index** (`git ls-files -s`) because the suite runs before the
adding commit exists; `git ls-tree HEAD` is only a post-commit human check.

## Hook design

`hooks/rtk-rewrite.mjs` is a `PreToolUse`/`Bash` **command** hook (the `plugins/CLAUDE.md` hook
decision tree's single-hook exception; a `PreToolUse` hook returning `updatedInput` must also run
synchronously, so it is not `async`). It spawns the bundled binary **by absolute path**
(`<plugin>/bin/rtk hook claude`) and emits rtk's rewritten command **verbatim** — no `PATH` prefix,
no absolute-path substitution. The bare `rtk` in that command resolves because Claude Code puts an
enabled plugin's `bin/` on the Bash `PATH`.

Two preflight rules keep that dependency safe: the hook no-ops when `rtk` does not resolve on its
own `PATH` at all (never emit an unresolvable command), and when the resolved `rtk` is not this
plugin's `bin/rtk` (a global `rtk init -g` install owns the rewrite; never double-wire).

`updatedInput` is `{ ...tool_input, command: final }` — it replaces the **entire** input object, so
constructing a fresh `{command, description}` would silently drop `timeout` / `run_in_background`
and turn a backgrounded Bash call into a blocking one. `permissionDecision` is never emitted
(`allow` makes the harness drop `updatedInput`).

Every failure path is a bare `return` inside `main()`'s single `try/catch` — never
`process.exit()`, matching `encoding-guard.mjs` and `lint-file.mjs`.

## userConfig

One feature, one toggle: boolean `auto_rewrite`, `default: true`. This plugin does **not** qualify
for `.claude/rules/plugin-userconfig.md`'s deliberate no-toggle exception, because the hook is not
the whole plugin — with auto-rewrite off the bundled `rtk` is still on the Bash `PATH` and usable by
hand, so disabling the hook is genuinely different from uninstalling.

The hook reads `CLAUDE_PLUGIN_OPTION_AUTO_REWRITE`, **not** a `${user_config.auto_rewrite}`
placeholder in `hooks.json` — the `npm-automations` precedent: the placeholder hard-errors when the
plugin was never configured via `/plugin manage` even though a `default` is declared, and Claude
Code ≥ 2.1.207 rejects `${user_config.*}` in shell-run hook `command` fields outright. Same accepted,
documented gap as `npm-automations`: if the env var is never populated for a command-hook
subprocess, an explicit `false` goes unhonored and the feature stays enabled.

Fail-open (not the rule's fail-closed exception): the hook creates no files and no external state,
so only the literal string `false` (after `trim()`) disables it.

## Skill design (update-linux-token-efficiency)

The maintainer skill lives at repo level in `.claude/skills/`, next to `create-plugin` and
`update-cc-references` — it edits the git **working tree** (the committed binary), so running it
from an installed plugin cache would be pointless.

It carries `disable-model-invocation: true`: it downloads a ~10 MB executable from the network and
overwrites a committed artifact — an explicit destructive-side-effect exception to
`.claude/rules/skill-invocation-control.md`'s model-invocable default.

Download source is the upstream GitHub release; **verification is mandatory** against the release's
own `checksums.txt` (plain `sha256sum` format) before any file is replaced. Version comparison is
plain string equality between the pin's `rtkVersion` and `tag_name` minus a leading `v` — no semver
ordering, so a retagged or yanked release conservatively reads as "update available". The script
never commits, never bumps `plugin.json` and never opens a PR.

## Novel-in-repo mechanics (deliberate, not convention)

- **`spawnSync`'s `input` option** pipes the hook's stdin into the child. First use in this repo;
  chosen over an async `spawn` write loop because the repo uses `spawnSync` exclusively and a
  `PreToolUse` `updatedInput` hook must be synchronous anyway.
- **`checksums.txt` artifact verification** on every download — no in-repo precedent.
- **`jq`-based rewrite of `rtk-bundle.json`.** `bump-version.sh` deliberately avoids `jq` for its
  JSON writes to preserve hand-maintained formatting; `rtk-bundle.json` is entirely machine-owned,
  so `jq` is correct here.
- **Stubbed `curl` + env-overridable base URLs** (`RTK_RELEASE_BASE_URL`,
  `RTK_DOWNLOAD_BASE_URL`) give the bats suite a local fixture release tree — no network in tests.

## Tests

`test/linux-token-efficiency/` splits by theme: `manifest.bats` (plugin.json / marketplace / CI
matrix), `bundle.bats` (binary, pin, `.gitattributes`, index mode), `hook.bats` (hook behavior via a
copy of the hook in a fake plugin tree with a stub `rtk`), `update-rtk-bundle.bats` (script exit-code
contract), `skill.bats` (SKILL.md shape), `docs.bats` (docs/registration), plus
`rtk-rewrite.test.mjs` (`node:test` unit coverage of the hook's exported helpers).
