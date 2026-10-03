# CLAUDE.md — linux-token-efficiency/mcp

Scope: `mcp/server.mjs`, `mcp/cbm-context.mjs`, `mcp/binary-fetch.mjs` and the plugin-root `cbm-tools.json`. Hook wiring (`SessionStart` command hook, `mcp_tool` entries): `hooks/CLAUDE.md`. The `cbm_enabled` toggle: root `CLAUDE.md` `## userConfig`.

## codebase-memory-mcp bundle

### Layout

- `server.mjs` (`100755`, `#!/usr/bin/env node`) — the codebase-memory proxy MCP server, a download-on-startup server that spawns an MCP-speaking cbm child and forwards `tools/call` to it verbatim (ids remapped; `isError`/`content`/`structuredContent` returned untouched).
  - It is the repo's first **wrapper-less** MCP server (`command: ${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs`, no `bin/mjs-launch.sh`): the written rule's default, knowingly divergent from the other MCP plugins. Do not "fix" it toward that precedent.
  - Only the transport skeleton (`send`/`ok`/`fail` + method dispatch) and the per-call timeout idiom have precedent in the repo; child spawn, handshake and id remapping are original.
  - `tools/list` is served from the committed `cbm-tools.json` snapshot, so the MCP handshake never waits on a download. Call-time forwarding is name-agnostic: a drifted snapshot costs advertisement, never a working call.
- `cbm-context.mjs` (`100644`, non-executable helper module) — ~350 pure, unit-tested lines kept out of the transport file (project resolution/cache, result peeling, formatters, `usablePath`, `resolveBundleCache`).
- `binary-fetch.mjs` — the download/verify/extract helpers (`fetchExpectedSha`/`downloadToFile`/`findBinaries`) shared with `hooks/rtk-install.mjs`. `mcp/` stays the relocatable, zero-npm-dep unit both consumers import; each keeps its own asset name, binary name and target path.
- `cbm-tools.json` is machine-owned.

### No committed binary or tarball

- cbm's extracted binary is 279.6 MiB, above GitHub's **100 MiB** per-file limit, and with a download-on-first-start server there is no reason to commit the archive either. **Nothing cbm-related is in git**; `cbm-tools.json` is the whole artifact surface.
- `bin/` holds only `context-mode-launch.sh` and the `rtk` PATH-bridge wrapper — neither is cbm-related.

### One process model

- `server.mjs` owns first-run download + verification + extraction, the warm cbm child, the four hook tools and the passthrough.
- Hook reads and the model's own `mcp__plugin_linux-token-efficiency_codebase-memory__*` calls go through the same child: exactly one place knows how to talk to cbm and peel its result envelope, and `mcp_tool` hooks cost a round-trip, not a fresh Node process plus a fresh 279.6 MiB exec per event.

### Download and verification discipline

- Applies to every runtime download in this plugin (cbm here, rtk in `hooks/rtk-install.mjs`):
  - Fetch the release's own `checksums.txt` at download time and require exactly one entry for the asset, or fail closed.
  - Check the downloaded tarball's sha256 against that entry before extraction.
  - Require exactly one `codebase-memory-mcp` inside the archive, or fail closed.
  - The extracted binary is trusted, not re-hashed.
  - Populate by atomic `rename` into `${CBM_BUNDLE_CACHE}/<assetSha256[0:16]>/codebase-memory-mcp`.
- A `checksums.txt` served by the same origin as the asset is not an independent trust anchor — only same-origin corruption/truncation detection, the accepted trade for always tracking the latest release.
- Downloads are bounded by `DOWNLOAD_TIMEOUT_MS` (5 min) and attempted at most once per server process. A failure degrades silently: hook tools return `{}`, passthrough calls return `isError`, a session is never blocked.

### `cbm_enabled` blast radius (why fail-open is accepted)

- Enabling means one HTTPS GET of the latest release asset from GitHub Releases (once per release per cache root), a ~280 MiB extraction and one background stdio process — network access plus state creation.
- Nothing is written outside `${CLAUDE_PLUGIN_DATA}/cbm`; no data loss, no credential use, no repo mutation. Reversible via the toggle plus `rm -rf` of the cache.
- This is the explicit fail-open exception to `.claude/rules/plugin-userconfig.md`'s state-creating clause, same as `plugins/npm-automations/hooks/CLAUDE.md` `## Toggles` documents. **Do not "harmonize" it back to fail-closed.**

### Cache roots

- `CBM_BUNDLE_CACHE` is ours; `CBM_CACHE_DIR` is upstream's.
  - `CBM_CACHE_DIR` is cbm's own graph-database root (upstream default `~/.cache/codebase-memory-mcp`); upstream rejects a genuinely different canonical root while any cbm process is active.
  - `server.mjs` NEVER sets `CBM_CACHE_DIR` (asserted by the bats suite), so server, hooks and manual CLI use all share upstream's default.
  - The only variable the plugin sets is `CBM_BUNDLE_CACHE` (download-cache root, default `${CLAUDE_PLUGIN_DATA}/cbm`).
- `CBM_DOWNLOAD_BASE_URL` is only ever _read_. Default `https://github.com/DeusData/codebase-memory-mcp/releases/latest/download` (the newest-release redirect alias, so `${base}/${asset}` and `${base}/checksums.txt` both resolve there) — never reconstructed from a bare host.
- `resolveBundleCache` fallback chain: `CBM_BUNDLE_CACHE` → `${CLAUDE_PLUGIN_DATA}/cbm` → `${XDG_CACHE_HOME}/claude-cbm` → `${HOME}/.cache/claude-cbm` → `${TMPDIR:-/tmp}/claude-cbm-<uid>`.
  - A value still containing a literal `${` is rejected as a path (`usablePath`), a check no other `.mjs` here does: the repo root has held exactly such an untracked `${CLAUDE_PLUGIN_DATA}` directory, so the failure mode is real.

### Per-cwd project cache

- Every hook process is fresh, so an in-memory cache buys nothing: `resolveProjectCacheDir()`/`readProjectCache()`/`writeProjectCache()` persist the `cwd -> project` mapping as one small JSON file per cwd (keyed by a sha256 of the cwd) in a `project-cache` subdir of the `CBM_BUNDLE_CACHE` root.
- `list_projects` — the mapping's only source — is skipped on a fresh hit, so a warm repo pays one cbm spawn per hook call instead of two.
- A miss, a corrupt entry, or an entry older than `PROJECT_CACHE_TTL_MS` (10 minutes; bounds staleness against a fresh `index_repository`) falls back to the two-spawn path transparently.
- Writes are temp-file-then-`rename` (atomic on one filesystem), so a racing reader never sees a partial file. Any read/write failure is swallowed: the cache is a pure optimization, never a dependency.

### Upstream result shapes

Read off the cbm binary directly; re-probe whenever upstream cuts a new release.

| Read                   | Real shape                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| every `tools/call`     | `{content:[{type:"text",text:"<json>"}],isError:bool}`, sometimes plus `structuredContent` — peeled by `unwrapToolResult()`; a parser that skips the peel leaves every hook silent in production |
| `search_graph`         | `format` defaults to a text `tree`; with `format:"json"` it is `{total,count,cols,groups:[{qn_prefix,file,rows:[[…]]}],has_more}` — read via `cols` index lookup in `formatSymbolContext()`      |
| `check_index_coverage` | argument is `paths` (array); result is `{…,paths:[{requested_path,path,coverage_lookup,status,freshness,recommended_action,coverage:[]}],…}` — matched per entry in `formatCoverageContext()`    |

- `coverage_lookup === "error"` and `status === "coverage_unavailable"` are checked **first** and mean silence: no signal is not evidence of a gap, and warning there would fire on every `Read` in any repo without recorded coverage.
- Any unrecognized payload is silence too, so a future upstream reshape costs context, never correctness.
