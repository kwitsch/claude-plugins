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

This plugin now backs five hooks total: `rtk-rewrite.mjs` above plus four cbm entries
(`SessionStart`, `SubagentStart`, `PreToolUse` `Grep`/`Glob`, `PostToolUse` `Read`) all served by one
`hooks/cbm-context.mjs` dispatching on `hook_event_name`. They are synchronous (`async: true` would
deliver context a turn late) with `hooks.json` `timeout: 10` and a stricter internal 5 s spawn
timeout on the `cbm-launch.sh` child. They are **`command`** hooks rather than `mcp_tool` ones for
two reasons: `SessionStart` fires before any MCP server is connected, and an `mcp_tool` hook's only
output channel is the called tool's own text content — none of cbm's 15 upstream tools can emit
`hookSpecificOutput.additionalContext`.

## userConfig

Two toggles, one per bundled server: boolean `auto_rewrite` and boolean `cbm_enabled`, both
`default: true`. This plugin does **not** qualify for `.claude/rules/plugin-userconfig.md`'s
deliberate no-toggle exception, because the hook is not the whole plugin — with auto-rewrite off
the bundled `rtk` is still on the Bash `PATH` and usable by hand, so disabling the hook is
genuinely different from uninstalling.

`cbm_enabled` is deliberately fail-open despite gating a state-creating action (extracting ~280 MiB
and starting a background process): worst case is one unwanted extraction plus one background stdio
process — no data loss, no security exposure, no repo mutation, reversible via the toggle plus
`rm -rf` of the cache. This is the same explicit fail-open exception to
`.claude/rules/plugin-userconfig.md`'s state-creating clause that `plugins/npm-automations/CLAUDE.md`
already documents — **do not "harmonize" this back to fail-closed**.

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
own `checksums.txt` (plain `sha256sum` format) before any file is replaced — the script requires
exactly one checksum entry per requested asset (an asset missing from, or duplicated in,
`checksums.txt` fails closed) rather than trusting `--ignore-missing` to skip it silently. Version
comparison is
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
- **The literal-`${` rejection for cache paths.** `bin/cbm-launch.sh` and
  `hooks/cbm-context.mjs`'s `resolveBundleCache` both refuse to treat a `CBM_BUNDLE_CACHE` value
  that still contains `${` as a real path, falling back to `${TMPDIR:-/tmp}/claude-cbm-$(id -u)`. No
  other `.mjs`/`.sh` in this repo does this; the repo root has held exactly such an untracked
  `${CLAUDE_PLUGIN_DATA}` directory, so the failure mode is demonstrated, not hypothetical.
- **Committed tarball + lazy `exec`-replacement launcher.** Unlike `bin/rtk` (committed as an
  extracted, ready-to-run binary), cbm's binary is too large to commit directly (see
  `## codebase-memory-mcp bundle` below); `bin/cbm-launch.sh` extracts it into a content-addressed
  cache on first use and then `exec`s it — a single process replacement, not spawn-and-wait, so the
  harness's stdio talks directly to the real cbm process.

## Tests

`test/linux-token-efficiency/` splits by theme: `manifest.bats` (plugin.json / marketplace / CI
matrix), `bundle.bats` (binary, pin, `.gitattributes`, index mode), `hook.bats` (hook behavior via a
copy of the hook in a fake plugin tree with a stub `rtk`), `update-rtk-bundle.bats` (script exit-code
contract), `skill.bats` (SKILL.md shape), `docs.bats` (docs/registration), plus
`rtk-rewrite.test.mjs` (`node:test` unit coverage of the hook's exported helpers). The cbm bundle
adds `cbm-bundle.json` verification (`cbm-bundle.bats`), launcher behavior on fabricated fixture
trees (`cbm-launch.bats`), hook behavior on fixture trees with a stub launcher (`cbm-hooks.bats`),
`node:test` unit coverage of the hook's exported helpers (`cbm-context.test.mjs`), and the
maintainer-script exit-code contract (`update-cbm-bundle.bats`) — all fixtures are few-byte
fabricated tarballs and a stub cbm binary; the real 279.6 MiB binary is never extracted or
downloaded in tests.

## codebase-memory-mcp bundle

**Storage differs from rtk's direct commit on purpose.** cbm's extracted binary is 293,160,104 bytes
(279.6 MiB) — above GitHub's **100 MiB** per-file limit — so the committed artifact is the
39,482,833-byte release tarball, and `bin/cbm-launch.sh` extracts it lazily on the MCP server's
first start. `cbm-bundle.json` therefore points `binaries[0].path` at the tarball: `assetSha256` is
the hash of the tracked file (offline-checkable) and `binarySha256` is the hash extraction must
produce.

**Two hash homes, by design.** `bin/cbm-checksums.txt` exists so the launcher can verify with
`sha256sum --check` + `awk` alone — no `jq` and no Node on the MCP start path. `update-cbm-bundle.sh`
writes both it and `cbm-bundle.json` from the same verified values, and `cbm-bundle.bats` asserts
they agree, so the duplication cannot drift.

**`CBM_BUNDLE_CACHE` is ours; `CBM_CACHE_DIR` is upstream's.** `CBM_CACHE_DIR` is cbm's own graph
database root (upstream default `~/.cache/codebase-memory-mcp`), and upstream rejects a genuinely
different canonical root while any cbm process is active. This plugin never sets it — server, hooks
and manual CLI use all share upstream's default. The only `CBM_*` variables this plugin sets are
`CBM_BUNDLE_CACHE` (extraction cache root, content-addressed as
`${CLAUDE_PLUGIN_DATA}/cbm/<binarySha256[0:16]>/`) and `CBM_NO_EXTRACT`.

**`CBM_NO_EXTRACT` contract.** Every hook spawn sets it to `1`, so a hook can never trigger the
~280 MiB extraction: a cold cache is silence. Extraction happens in exactly one place — the MCP
server's own first start, where the harness already tolerates startup latency (a `SessionStart`
hook must stay fast).

**Upstream result shapes.** Upstream documents the tool names, `--json`, and that flags are
generated from each tool's input schema (kebab-case), but not the result-field names of
`list_projects`, `index_status` or `check_index_coverage`. Each parser therefore accepts a set of
key aliases and returns `null` ("nothing to say") on anything unrecognized, so an upstream schema
change costs context, never correctness:

| Parser                  | Accepted keys                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pickProject`           | array at root or under `projects`/`items`/`entries`; name from `name`/`project`/`project_name`/`projectName`/`id`; path from `path`/`root`/`repo_path`/`repoPath`/`root_path`/`rootPath`/`directory`                                                                                                                     |
| `formatSessionContext`  | `status`/`state`/`index_status`/`indexStatus`, `files`/`file_count`/`fileCount`/`indexed_files`/`indexedFiles`, `symbols`/`symbol_count`/`symbolCount`, `stale`/`is_stale`/`isStale`, `last_indexed`/`lastIndexed`/`updated_at`/`updatedAt`                                                                              |
| `formatSymbolContext`   | array under `results`/`symbols`/`matches`/`nodes`/`items`; `qualified_name`/`qualifiedName`/`fqn`/`name`/`symbol`, `file`/`path`/`file_path`/`filePath`/`location`, `line`/`start_line`/`startLine`/`lineno`                                                                                                             |
| `formatCoverageContext` | booleans `skipped`/`excluded`/`partial`/`partially_parsed`/`partiallyParsed`/`unsupported`/`truncated`, `indexed`/`covered` `=== false`, or a `status`/`state`/`coverage`/`coverage_status`/`reason`/`parse_error`/`error` string matching `skip \| exclud \| partial \| unsupported \| error \| missing \| not indexed` |

Narrowing these lists to the real field names is a follow-up for whoever next runs the bundled
binary on an indexed repo:

```bash
plugins/linux-token-efficiency/bin/cbm-launch.sh cli check_index_coverage --help
plugins/linux-token-efficiency/bin/cbm-launch.sh cli list_projects --json
plugins/linux-token-efficiency/bin/cbm-launch.sh cli index_status --project < p > --json
```
