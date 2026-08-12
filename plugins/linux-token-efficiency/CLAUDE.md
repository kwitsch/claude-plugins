# CLAUDE.md — linux-token-efficiency

Bundles the upstream rtk Linux binary and auto-rewrites Bash commands through it.

## Committed binary and the exec bit

`bin/rtk` is the extracted upstream release binary, committed verbatim (~10 MB, no Git LFS —
the repo already commits multi-MB `.wasm` sidecars in `universal-format`). `.gitattributes` marks
`plugins/linux-token-efficiency/bin/*` as `binary` so a `text=auto` repo never EOL-translates it.
`bin/` also holds `context-mode-launch.sh` (see `## context-mode`), which is plain text, so a second
`.gitattributes` line overrides the wildcard for it: `bin/*.sh -binary` (last matching pattern wins
per attribute). `-binary` is required and was verified empirically — `text eol=lf` as the override
still leaves `binary: set` / `diff: unset` and `git diff` still prints "Binary files … differ";
`-binary` restores a textual patch and lets the root `* text=auto eol=lf` apply. Never narrow the
wildcard line itself: two tests grep its exact literal.

**This repo sets `core.fileMode=false`**, so a filesystem `chmod +x` is NOT picked up by `git add`.
`.claude/rules/bin-executable.md` and `.claude/rules/hooks-executable.md` prescribe only
`chmod +x` + `ls -la` and never mention this — following them literally commits a `100644` that
Claude Code then silently skips. Whenever `bin/rtk`, `bin/context-mode-launch.sh` or `hooks/rtk-rewrite.mjs` is added or replaced:

```bash
chmod +x plugins/linux-token-efficiency/bin/rtk plugins/linux-token-efficiency/hooks/rtk-rewrite.mjs
git add plugins/linux-token-efficiency/bin/rtk plugins/linux-token-efficiency/hooks/rtk-rewrite.mjs
git update-index --chmod=+x plugins/linux-token-efficiency/bin/rtk plugins/linux-token-efficiency/hooks/rtk-rewrite.mjs
git ls-files -s plugins/linux-token-efficiency/bin/rtk # must print 100755

chmod +x plugins/linux-token-efficiency/bin/context-mode-launch.sh
git add plugins/linux-token-efficiency/bin/context-mode-launch.sh
git update-index --chmod=+x plugins/linux-token-efficiency/bin/context-mode-launch.sh
git ls-files -s plugins/linux-token-efficiency/bin/context-mode-launch.sh # must print 100755
```

`hooks/SessionStart.md` and `hooks/subagent-nudge.md` are the deliberate exception: they stay
`100644` (both are `cat`-ed, not executed, and `.claude/rules/hooks-executable.md` globs only
`hooks/*.sh` and `hooks/*.mjs`).

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

This plugin backs seven hooks total: `rtk-rewrite.mjs` above, `SessionStart` →
`mcp/server.mjs --session-start-hook` (a `command` hook — see the correction note below), three
remaining cbm entries (`SubagentStart`, `PreToolUse` `Grep`/`Glob`, `PostToolUse` `Read`), all
`type: "mcp_tool"` on `plugin:linux-token-efficiency:codebase-memory` (the namespaced form — the
bare `.mcp.json` key resolves to "not connected" on every fire) with an explicit `input` block each,
because an omitted `input` delivers `{}` instead of the hook JSON, a second `SessionStart` entry
that `cat`s `hooks/SessionStart.md`, and a second `SubagentStart` entry that `cat`s
`hooks/subagent-nudge.md` (both static files, see `## context-mode`) — a plain `command` hook
rather than a fifth cbm `mcp_tool`, since the nudge is generic subagent-behavior guidance plus
context-mode awareness, unrelated to the cbm graph, so folding it into `hook_subagent_context` would
be a category mismatch. Each cbm entry names its own purpose-built tool (`hook_subagent_context`,
`hook_symbol_context`, `hook_coverage_context`), so `hookEventName` is hardcoded per tool and can
never be wrong.

`timeout: 20` (was `21`, briefly `12`): there is no per-event process any more, so the budget is two
4 s child round-trips (`HOOK_CALL_TIMEOUT_MS`) plus a cold-start handshake (`HOOK_CALL_TIMEOUT_MS *
2`) plus margin, not two 5 s `spawnSync` calls plus Node start-up. `12` under-counted the handshake
cost on the very first call of a session (cold child, cold project cache) — real review finding,
raised to `20` to actually cover the worst case.

> Correction note (2026-08-12): `SessionStart` was `mcp_tool` here through 0.1.0, on the assumption
> that a cold first run would fail open silently (the matrix's own "servers usually not connected
> yet" prescription for its `status: "limited"` rating). Live behavior is stricter than that: every
> `SessionStart` fire produced a visible `SessionStart:startup hook error — mcp_tool hooks are not
available for the 'SessionStart' hook event (no MCP client context)`, not a silent no-op — this
> event apparently rejects `mcp_tool` outright rather than merely finding the server unconnected.
> Fixed by moving `SessionStart` to a `command` hook per `hooks-mcp-server.md`'s decision tree (rule
> 2: event fires before the server connects). Rather than duplicating `projectStatusHandler`'s
> env/cache/child-spawn logic in a second file, `mcp/server.mjs` itself gained a `--session-start-hook`
> CLI branch (checked before `startServer()`/`ensureBinary()` run) that reads the hook JSON off stdin,
> calls `projectStatusHandler(args, "SessionStart")` directly (bypassing the JSON-RPC loop — no
> persistent server involved), prints the result, and exits. `hooks.json`'s `SessionStart` entry is
> now `{"type":"command","command":"${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs","args":["--session-start-hook"]}`.
> `SubagentStart`, `PreToolUse` and `PostToolUse` stay `mcp_tool` (`status: "full"`, genuinely
> mid-session) — this correction is `SessionStart`-only.

This is not contradicted by the second `SessionStart` entry added for context-mode (a plain `cat`,
unrelated to `--session-start-hook`): it injects a **different**, static document (upstream's
routing rules) that no other handler produces, so nothing is double-injected between the two.

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

Two toggles, one per gated feature: boolean `auto_rewrite` and boolean `cbm_enabled`, both
`default: true`. This plugin does **not** qualify for
`.claude/rules/plugin-userconfig.md`'s
deliberate no-toggle exception, because the hook is not the whole plugin — with auto-rewrite off
the bundled `rtk` is still on the Bash `PATH` and usable by hand, so disabling the hook is
genuinely different from uninstalling. `context-mode` (below) deliberately has no toggle at all —
it is always enabled, by explicit user decision, not an oversight.

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

## Output style

`output-styles/terse.md` is a third fixed, always-on component next to the rtk rewrite hook and the
cbm server. **No toggle, deliberately**: the style creates no state, and `force-for-plugin` is static
frontmatter that no `userConfig` value can drive (`${user_config.*}` placeholders are rejected in hook
`command` fields anyway, see above).

- `force-for-plugin: true` auto-applies the style whenever the plugin is enabled and **overrides the
  user's own `outputStyle` setting** by design; "first loaded wins if several set it".
- `keep-coding-instructions: true` keeps Claude Code's built-in software-engineering instructions in
  the system prompt, so only communication form changes, never coding behavior.
- The body must stay short — one heading plus 6 bullets, deliberately **not** a
  `kiwi-code-style`-shaped machine contract. `output-style.bats`'s ≤ 40-line cap is the tripwire that
  enforces it; raising it is a design decision, not a test fix.
- Scope: the main conversation only (a subagent has its own system prompt and never sees it), and it
  takes effect in a new session or after `/clear`.
- It is the plugin's **only OS-independent component** — which is why every "Linux only" claim in this
  plugin's manifests and docs (`plugin.json`, the root `marketplace.json` entry, the plugin README
  banner, the root README row) is scoped to the **bundled tooling**, never to the plugin as a whole.
  Do not "simplify" those strings back to "this plugin does not work": the same edit must keep the
  literal `does not work` with a **singular** subject, because `manifest.bats` matches that string in
  both manifests.
- If `kiwi-code-style` is enabled too, both force a style and only one wins — load-order dependent,
  not controllable from here. Accepted; do not build detection or a precedence mechanism.

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
- **A hook whose `command` is a bare PATH-resolved system binary.** The second `SessionStart` entry
  and the second `SubagentStart` entry are both
  `{"type":"command","command":"cat","args":["${CLAUDE_PLUGIN_ROOT}/hooks/<file>.md"]}` — the first
  hooks in this repo that run a system tool instead of a plugin-bundled script, and the second- and
  third-ever use of `args` in a hook (after `plugins/memory-enhancement/hooks/hooks.json`). `cat` is
  POSIX-universal on the Linux hosts this plugin targets, and exec form keeps the path an
  untokenized argument. A `.mjs` reader (kiwi-code-style's `inject-ponytail-guidelines.mjs`) exists
  only because it _transforms_ its input; static files that must not be transformed get a bare `cat`
  instead. `hooks-json-authoring.md` documents plain stdout reaching Claude with no JSON wrapper
  specifically for `SessionStart`; extending that to `SubagentStart` here is by analogy (identical
  `block_mechanism: "context_only"` classification in the event matrix, same "additional_context: true,
  no blocking" contract) rather than an independently documented fact — re-verify if this hook is
  ever seen to silently not land. USER DECISION: for purely static content, a `cat`-a-file hook is
  preferred over a script that only ever emits the same hardcoded string — no interpreter startup, no
  code to review for a string that never changes at runtime; `subagent-nudge.mjs` was replaced with
  `subagent-nudge.md` + this `cat` entry for exactly that reason. See `## context-mode`.
- **A `bin/` wrapper that launches an EXTERNAL npm package.** `bin/context-mode-launch.sh` execs
  `bunx`/`npx --yes` against a pinned published package spec rather than a local `.mjs` — the first
  such wrapper here; the three `bin/mjs-launch.sh` copies all exec a runtime against a bundled file.
  See `## context-mode`.

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
few bytes; the real 279.6 MiB binary is never downloaded or extracted. context-mode adds
`context-mode.bats`: the launcher's runtime selection against stubbed `bunx`/`npx` on an isolated
PATH (the real runners are never invoked and the npm registry is never reached), the `.mcp.json`
server entry, the verbatim `hooks/SessionStart.md` (first/last line, load-bearing literals, index
mode), the `SessionStart` `cat` wiring, the `hooks/subagent-nudge.md` content and its `SubagentStart`
`cat` wiring, the PreToolUse/PostToolUse zero-nudge-hook tripwire and the
`.prettierignore`/`.coderabbit.yaml` verbatim guards. The forced output style adds `output-style.bats`
(style presence, frontmatter keys read strictly between the real `---` fences, the exact first body
heading, the ≤ 40-line brevity cap, required directive tokens).

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

## context-mode

Registers the EXTERNAL npm package `context-mode` (upstream <https://github.com/mksglu/context-mode>,
Elastic License 2.0) as the `context-mode` MCP stdio server, and injects upstream's own routing-rules
document verbatim at every session start. Nothing is vendored, proxied or committed except that one
document.

**Why a wrapper instead of the canonical direct-`command` form.** Every other MCP server here points
`.mcp.json`'s `command` at a bundled file. An external npm package has no local file to exec, and
registering `npx` directly (upstream's own documented
`claude mcp add context-mode -- npx -y context-mode`) would lose the bun preference — the wrapper is
what lets `bunx` win when available.

**Why `bin/context-mode-launch.sh` is not a copy of `bin/mjs-launch.sh`** (the identical copies in
`coding-toolbox`, `universal-format`, `claude-code-knowledge`): that wrapper's contract is "exec a
runtime against the `.mjs` path in `$1`", which is why it carries a missing-argument exit-64 guard.
Here the target is a fixed package spec baked into the wrapper, so there is no mandatory argv and no
guard; `"$@"` is still forwarded as harmless future-proofing. The probes are `bunx` and `npx` — the
package RUNNERS — because `command -v node` would be the wrong check: node alone does not run `npx`.
A `.mjs` launcher was rejected outright: it must be started by a runtime _before_ it can pick one.

**PATH hardening.** `export PATH="${PATH:+${PATH}:}${HOME:-}/.local/bin:${HOME:-}/.bun/bin"` — the
user dirs are APPENDED (inherited PATH wins), so a stale user-dir binary can never shadow a canonical
system tool; this matches the hardened sibling wrappers rather than the prepending template in
`.claude/rules/hooks-mcp-server.md`. `${PATH:+${PATH}:}` keeps the expansion empty when PATH is unset
or empty — an empty PATH segment resolves to cwd. `${HOME:-}`, never a bare `~`. Every diagnostic
goes to stderr: stdout is the MCP stdio channel.

**Pinned by hand.** `CONTEXT_MODE_SPEC="context-mode@1.0.169"` lives in the wrapper only — an exact
version pin like every other dependency this plugin ships (`rtk-bundle.json` pins `0.45.0`,
`cbm-bundle.json` pins `0.10.1`). `npx --yes`, never `-y` (repo convention,
`plugins/universal-lint/hooks/lint-file.mjs:249`). `.claude/skills/update-linux-token-efficiency`
does **NOT** cover this pin — it only knows `rtk-bundle.json` and `cbm-bundle.json` — so keeping it
current is a manual edit and the pin can silently rot. A `context-mode-bundle.json` pin file was
rejected as YAGNI for one consumer with no automated updater.

**Integrity delta vs `cbm_enabled` — read this before assuming a pin exists.** cbm's download is
sha256-verified, both the release asset and the extracted binary, against a committed pin before
anything enters a plugin-owned `${CLAUDE_PLUGIN_DATA}` cache. A registry fetch through `bunx` /
`npx --yes` has **no** sha256 pin available at all, and it lands in the runtime's own global package
cache, outside `${CLAUDE_PLUGIN_DATA}`. The version pin buys reproducibility, not integrity. Do not
restate cbm's mitigation language for this server — the two are not equivalent.

**`ctx_execute` / `ctx_batch_execute` bypass `Bash` `PreToolUse` hooks.** This server hands the model
a code- and shell-execution path that no `Bash` `PreToolUse` hook observes — not this plugin's own
`rtk-rewrite.mjs`, not another plugin's hard deny gates (e.g. `coding-toolbox`'s
`encoding-guard.mjs`): an MCP tool call can never match a `Bash` matcher. There is no toggle to gate
this with — see "No toggle, by explicit decision" below.

**The verbatim-file contract.** `hooks/SessionStart.md` is upstream's
`configs/claude-code/CLAUDE.md` byte-for-byte (5,185 bytes, 97 lines, git mode `100644`). It is NEVER
edited — not by a formatter, not by a markdownlint fix, not by an applied CodeRabbit suggestion. Two
mechanical guards plus one rule: `.prettierignore` lists it (`universal-format` prettier-formats
`.md` on every `Write`/`Edit` and honors `.prettierignore`, exactly the reliance its
`plugins/universal-format/mcp/server.mjs` entry already documents), and `.coderabbit.yaml`'s
`reviews.path_filters` excludes it — the inline `<!-- coderabbit-skip: … -->` alternative from
`.claude/rules/coderabbit-md-review.md` is unusable here, since the comment itself would break
verbatim fidelity. `universal-lint`'s markdownlint pass is check-only and never rewrites a file, so
any finding it prints on this one is knowingly left unfixed. Re-syncing with upstream is a plain file
copy plus a diff, nothing else. That `.coderabbit.yaml` filter is the repointed former
`cave-context` exclusion — same upstream project, same license, same reason.

**Accepted limitation: the document's "BLOCKED" claims are upstream's, not ours.** Its
`## BLOCKED — do NOT attempt` sections ("curl / wget — BLOCKED. Intercepted and replaced with error",
"Inline HTTP — BLOCKED", "WebFetch — BLOCKED") describe upstream's own routing engine
(`hooks/core/routing.mjs`, ~44 KB), which this plugin deliberately does not port. Nothing here
intercepts `curl`, `wget`, inline HTTP or `WebFetch`; those tools keep working normally. The file is
NOT patched to say so, because byte-for-byte fidelity is what keeps an upstream re-sync a plain copy,
and no compensating hook or correction document is added (a third `SessionStart` entry `cat`-ing a
correction file was considered and rejected as more machinery than four lines justify). Practical
effect: the model may steer away from those tools believing they are blocked — the same direction as
the intended nudge, and no tool is actually withheld.

**No toggle, by explicit decision.** Unlike `auto_rewrite` and `cbm_enabled`, `context-mode` has no
`userConfig` entry at all — the server is always registered and the `cat` hook always fires. A
`context_mode_enabled` toggle was implemented (fail-open, mirroring `cbm_enabled`) and then removed
on explicit user instruction: "remove the toggle, context-mode should always be enabled" — not a
plan/review oversight. Enabling the plugin is the only consent step, same as for `cbm_enabled`, and
there is no way to run rtk/cbm without context-mode alongside them. Both the wrapper's unconditional
exec and the `cat` hook's unconditional injection are therefore consistent with each other by
construction — there is no partial-disable state to keep them in sync with.

**Native Windows caveat.** The top-level `description`'s Linux-only clause names only the rtk and
codebase-memory features (bundled Linux binaries), but `bin/context-mode-launch.sh`
(`#!/usr/bin/env bash`) and the `SessionStart` `cat` entry are just as platform-dependent: neither
`bash` nor `cat` is on `PATH` by default on native Windows outside WSL or Git Bash, so both fail to
start there. Purely additive documentation — no behavior changes as a result.

**The `SubagentStart` nudge hook (`hooks/subagent-nudge.md`, `cat`-ed) is a separate, explicitly
user-requested addition — not part of the PreToolUse/PostToolUse analysis below.** It is a static
file with two unrelated points: (1) subagents should not print narrative status text between tool
calls, only their final report, and (2) subagents should prefer `context-mode`'s `ctx_*` tools —
phrased unconditionally, on the assumption (USER DECISION) that the context-mode MCP server is
always connected, not gated behind an "if connected" check. Point 2 exists because subagents get
their own system prompt and do **not** automatically inherit the main session's
`SessionStart`-injected routing document, so without this hook a subagent has zero context-mode
awareness. `SubagentStart` is `status: "full"` in the event
matrix (unlike `SessionStart`, `mcp_tool` works fine here — see `hook_subagent_context` above), so
per the decision tree this could instead be `mcp_tool`; it is a plain `command` `cat` hook because
(a) bolting a static, cbm-unrelated tool onto the `codebase-memory` proxy would be the same category
mismatch the PreToolUse/PostToolUse analysis below rejects, with no other MCP server here whose
concern it fits, and (b) per USER DECISION, purely static content is better served by `cat`-ing a
file than by a script whose only job is to emit a hardcoded string — this was originally shipped as
a `subagent-nudge.mjs` script and changed to this file+`cat` shape for exactly that reason. See the
`cat`-hook bullet under `## Novel-in-repo mechanics` for the `SessionStart`-vs-`SubagentStart`
plain-stdout caveat.

**Zero PreToolUse/PostToolUse nudge hooks — the analyzed outcome, not an omission.** All four of upstream's static
`<context_guidance><tip>` blocks were worked through and none was added. `createBashGuidance`,
`createGrepGuidance` and `createReadGuidance` each restate what `hooks/SessionStart.md` already says
once per session ("### Bash (>20 lines output)", "### Grep — may flood context", "### Read (for
analysis)"), so a static per-call repeat spends tokens on information already in context — in a
token-efficiency plugin. The Read one would additionally contradict `hook_coverage_context`'s
load-bearing fail-quiet contract on the same event/matcher (pinned by `cbm-hooks.bats`'s "silent on
coverage_unavailable and on a clean report" test), and the Grep one would stack a second
`additionalContext` source next to `hook_symbol_context`, whose design is to speak only on a real
graph signal. `createExternalMcpGuidance` (matcher `WebFetch`) is the only non-duplicating candidate,
but its substance is already in "### WebFetch — BLOCKED", and per the decision tree a non-blocking
`PreToolUse` hook should be `mcp_tool` — which would mean bolting a static, non-graph tool onto the
cbm proxy (category mismatch, wrong toggle) or standing up a third server. More machinery than a tip
justifies. `context-mode.bats` pins the decision (`PreToolUse` length 2, `PostToolUse` length 1,
every `mcp_tool` handler still on `plugin:linux-token-efficiency:codebase-memory`, no
`context_guidance` literal anywhere in `hooks.json`) so no future editor can add one without
revisiting this analysis.

**History — this knowingly revisits two 2026-07 removals.** context-mode was already tried twice in
this repo and dropped both times: the in-repo `cave-context` plugin, which vendored and proxied the
upstream package, was removed on 2026-07-03 (commit `faa78d2`, together with `init` and
`cctools-edit`), and routing to the external context-mode plugin as an optional command accelerator
was dropped from `coding-toolbox`, the then-existing `branch-management` and `claude-code-knowledge`
by 2026-07-06 after measuring no benefit over `rtk` for the git/gh/glab commands those plugins run
(their file-scoped "no context-mode reference" tests still assert that absence and stay green —
`test/coding-toolbox/fresh-pr.bats:364-372`, `test/claude-code-knowledge/test.bats:1141-1176`). This
addition is a deliberate, user-decided revisit with a different shape — a `bunx`/`npx`-wrapped
external MCP server plus one static session-start routing document, no vendored tree, no proxy, no
session-continuity machinery — and it is not contingent on that earlier benchmark, which measured raw
command-output size for a different tool's command set and never measured context-mode's
sandboxed-execution or session-continuity value. Do not file this as an accident and "restore" the
removal.
