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

This plugin backs five hooks total: `rtk-rewrite.mjs` above plus four cbm entries
(`SessionStart`, `SubagentStart`, `PreToolUse` `Grep`/`Glob`, `PostToolUse` `Read`), all four `type: "mcp_tool"` on
`plugin:linux-token-efficiency:codebase-memory` (the namespaced form — the bare `.mcp.json` key
resolves to "not connected" on every fire) with an explicit `input` block each, because an omitted
`input` delivers `{}` instead of the hook JSON. Each names its own purpose-built tool
(`hook_session_context`, `hook_subagent_context`, `hook_symbol_context`, `hook_coverage_context`), so
`hookEventName` is hardcoded per tool and can never be wrong.

`timeout: 20` (was `21`, briefly `12`): there is no per-event process any more, so the budget is two
4 s child round-trips (`HOOK_CALL_TIMEOUT_MS`) plus a cold-start handshake (`HOOK_CALL_TIMEOUT_MS *
2`) plus margin, not two 5 s `spawnSync` calls plus Node start-up. `12` under-counted the handshake
cost on the very first call of a session (cold child, cold project cache) — real review finding,
raised to `20` to actually cover the worst case.

`SessionStart` is `status: "limited"` in `.claude/rules/hooks-mcp-tool-event-matrix.md` ("servers
usually not connected yet on first run") and `hooks-mcp-server.md`'s decision tree lists it as a
`command`-hook case. It is `mcp_tool` here anyway, deliberately: on a cold first run the hook simply
fails open (no context, no error, session proceeds), which is the matrix's own prescription, and the
loss is close to zero — the previous CLI-based design never extracted from a hook either, so a cold
cache produced no SessionStart context there too. `SubagentStart`, `PreToolUse` and `PostToolUse` are
all `status: "full"`. **No compensating `command` hook is added**: duplicating the event across two
handler types would double-inject context whenever both fire, for a benefit measured only on the
first session after a fresh install.

**Per-cwd project cache.** Each hook process is a fresh process, so an in-memory cache buys nothing
across invocations — `resolveProjectCacheDir()`/`readProjectCache()`/`writeProjectCache()` persist the
resolved `cwd -> project` mapping as one small JSON file per cwd (keyed by a sha256 of the cwd) under
a `project-cache` subdir of the same `CBM_BUNDLE_CACHE` root the download cache already lives under.
`list_projects` — the mapping's only source — is skipped entirely on a fresh cache hit, so a warm repo
pays exactly one cbm spawn per hook call instead of two; a miss, a corrupt entry, or an entry older
than `PROJECT_CACHE_TTL_MS` (10 minutes — bounds staleness against a fresh `index_repository` adding a
project cbm previously didn't know about) all fall back to the original two-spawn path transparently.
The write is temp-file-then-`rename` (atomic on the same filesystem) so a racing reader never observes
a partial file; any read/write failure is swallowed exactly like every other guard in this file — the
cache is a pure optimization, never a dependency.

## userConfig

Two toggles, one per bundled server: boolean `auto_rewrite` and boolean `cbm_enabled`, both
`default: true`. This plugin does **not** qualify for `.claude/rules/plugin-userconfig.md`'s
deliberate no-toggle exception, because the hook is not the whole plugin — with auto-rewrite off
the bundled `rtk` is still on the Bash `PATH` and usable by hand, so disabling the hook is
genuinely different from uninstalling.

`cbm_enabled` is deliberately fail-open despite gating a state-creating action that now also reaches
the **network**: enabling means one HTTPS GET of a 37.6 MiB release asset from GitHub Releases (once
per pinned version per cache root) plus a ~280 MiB extraction and one background stdio process.
Mitigations are structural, not conventional: the asset **and** the extracted binary are
sha256-verified against the committed pin before anything enters the cache, the download is bounded
by `DOWNLOAD_TIMEOUT_MS` (5 min) and attempted at most once per server process, a failure degrades
silently (hook tools return `{}`, passthrough calls return `isError`) instead of blocking a session,
and nothing is written outside `${CLAUDE_PLUGIN_DATA}/cbm`. Worst case for an unwanted enable is one
download, one extraction, one background process — no data loss, no credential use, no repo mutation,
reversible via the toggle plus `rm -rf` of the cache. This is the same explicit fail-open exception to
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
- **The literal-`${` rejection for cache paths.** `mcp/cbm-context.mjs`'s `resolveBundleCache`
  refuses to treat a `CBM_BUNDLE_CACHE` value that still contains `${` as a real path, falling back to
  `${TMPDIR:-/tmp}/claude-cbm-$(id -u)`. No other `.mjs` in this repo does this; the repo root has held
  exactly such an untracked `${CLAUDE_PLUGIN_DATA}` directory, so the failure mode is demonstrated,
  not hypothetical.
- **Download-on-startup proxy MCP server + transparent tool passthrough.** `mcp/server.mjs` is the
  first server in this repo that spawns an MCP-speaking child and forwards `tools/call` to it
  verbatim (ids remapped, `isError`/`content`/`structuredContent` returned untouched), and the first
  that fetches its own dependency over the network at startup. Only the transport skeleton
  (`send`/`ok`/`fail` + method dispatch) and the per-call timeout idiom have precedent here; child
  spawn, handshake and id remapping are original. `tools/list` is served from the committed
  `cbm-tools.json` snapshot rather than mirrored from the child, so the MCP handshake never waits on
  a download — call-time forwarding is name-agnostic, so a drifted snapshot costs advertisement, never
  a working call.
- **`mcp/` holds two hand-written files.** `server.mjs` imports `./cbm-context.mjs`, keeping ~350
  already-tested pure lines out of the transport file; `mcp/` stays the relocatable, zero-npm-dep
  unit. `server.mjs` is also the repo's first **wrapper-less** MCP server
  (`command: ${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs`, no `bin/mjs-launch.sh`) — the written rule's
  default, knowingly divergent from the three other MCP plugins. Do not "fix" it toward that
  precedent.

## Tests

`test/linux-token-efficiency/` splits by theme: `manifest.bats` (plugin.json / marketplace / CI
matrix), `bundle.bats` (binary, pin, `.gitattributes`, index mode), `hook.bats` (hook behavior via a
copy of the hook in a fake plugin tree with a stub `rtk`), `update-rtk-bundle.bats` (script exit-code
contract), `skill.bats` (SKILL.md shape), `docs.bats` (docs/registration), plus
`rtk-rewrite.test.mjs` (`node:test` unit coverage of the hook's exported helpers). The cbm proxy adds
pin + snapshot + file-mode + `.mcp.json` verification (`cbm-bundle.bats`), server behavior on a
fixture plugin tree with a fake MCP-speaking cbm binary and an ephemeral 127.0.0.1 release server
(`cbm-server.bats`), the four hook tools driven as real `tools/call` requests plus the `hooks.json`
wiring pins (`cbm-hooks.bats`), `node:test` coverage of the pure helpers (`cbm-context.test.mjs`), and
the maintainer-script exit-code contract (`update-cbm-bundle.bats`) — every fixture is fabricated and
few bytes; the real 279.6 MiB binary is never downloaded or extracted.

## codebase-memory-mcp bundle

**Why no committed binary or tarball.** cbm's extracted binary is 293,160,104 bytes (279.6 MiB) —
above GitHub's **100 MiB** per-file limit — so it can never be committed like `bin/rtk` is. With a
server that downloads on first start there is no reason to commit the 37.6 MiB archive either, so
**nothing cbm-related is in git**: `bin/` holds only `rtk`, and the two machine-owned JSON files
`cbm-bundle.json` (the pin) and `cbm-tools.json` (the advertised tool list) are the whole artifact
surface.

**One process model.** `mcp/server.mjs` owns the pin, the first-run download + verification +
extraction, the warm cbm child, the four hook tools and the passthrough. Both the hook reads and the
model's own `mcp__codebase-memory__*` calls go through the same child, so there is exactly one place
that knows how to talk to cbm and one place that peels its result envelope. `mcp_tool` hooks
therefore cost a round-trip, not a fresh Node process plus a fresh 279.6 MiB exec per event.

**Verification discipline** (carried over verbatim from the deleted shell-script launcher): exactly one
pin entry or fail closed; asset sha256 checked before extraction; exactly one `codebase-memory-mcp`
inside the archive or fail closed; extracted-binary sha256 checked before the cache is touched;
population by atomic `rename` into
`${CBM_BUNDLE_CACHE}/<binarySha256[0:16]>/codebase-memory-mcp`. The layout is byte-identical to the
old launcher's, so an existing warm cache is reused. Runtime verifies against the committed pin only
and never fetches the release's `checksums.txt` — a checksum file served by the same origin as the
asset would add no trust; `checksums.txt` is the maintainer script's business.

**`CBM_BUNDLE_CACHE` is ours; `CBM_CACHE_DIR` is upstream's.** `CBM_CACHE_DIR` is cbm's own graph
database root (upstream default `~/.cache/codebase-memory-mcp`), and upstream rejects a genuinely
different canonical root while any cbm process is active. `server.mjs` never sets it — that is an
invariant of the file, asserted by the bats suite — so server, hooks and manual CLI use all share
upstream's default. The only variable the plugin sets is `CBM_BUNDLE_CACHE` (download-cache root,
default `${CLAUDE_PLUGIN_DATA}/cbm`); `CBM_DOWNLOAD_BASE_URL` is only ever _read_ (same name, join
shape and default as `update-cbm-bundle.sh`: `${base}/${releaseTag}/${asset}`, never reconstructed
from a bare host — `upstreamRepo` in the pin is metadata only).

**Upstream result shapes** (read off the pinned v0.10.1 binary directly, which fixed three defects
the earlier CLI-based hooks shipped with):

| Read                   | Real shape                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| every `tools/call`     | `{content:[{type:"text",text:"<json>"}],isError:bool}`, sometimes plus `structuredContent` — peeled by `unwrapToolResult()`; the old parsers never peeled it, so every hook was silent in production |
| `search_graph`         | `format` defaults to a text `tree`; with `format:"json"` it is `{total,count,cols,groups:[{qn_prefix,file,rows:[[…]]}],has_more}` — read via `cols` index lookup in `formatSymbolContext()`          |
| `check_index_coverage` | argument is `paths` (array); result is `{…,paths:[{requested_path,path,coverage_lookup,status,freshness,recommended_action,coverage:[]}],…}` — matched per entry in `formatCoverageContext()`        |

`coverage_lookup === "error"` and `status === "coverage_unavailable"` are checked **first** and mean
silence: no signal is not evidence of a gap, and warning there would fire on every single `Read` in
any repo without recorded coverage. Any unrecognized payload is silence too, so a future upstream
reshape costs context, never correctness. Re-probe at the next pin bump.
