# CLAUDE.md — linux-token-efficiency

Installs the upstream rtk Linux binary into ~/.local/bin at SessionStart and auto-rewrites Bash commands through it.

## Where things live

- `hooks/CLAUDE.md` — `hooks.json` wiring, the `rtk-rewrite.mjs` router, `webfetch-steer.mjs`, `## rtk install`, the verbatim `SessionStart.md` contract, the `SubagentStart` nudge.
- `mcp/CLAUDE.md` — `mcp/server.mjs`, the codebase-memory proxy MCP server (runtime download + checksum-verify of codebase-memory-mcp into `${CLAUDE_PLUGIN_DATA}/cbm`), its `cbm-context.mjs` helper and `binary-fetch.mjs`.
- `test/linux-token-efficiency/CLAUDE.md` — fixtures and test tripwires.
- This file — executable bit, `bin/`, `userConfig`, output style, context-mode.

## Executable bit and core.fileMode

- This repo sets `core.fileMode=false`, so `chmod +x` alone is NOT committed: after adding or replacing any `hooks/*.mjs`, `mcp/server.mjs` or `bin/*` file, force the mode with `git update-index --chmod=+x <file>`.
- Steps and the index check: `.claude/rules/hooks-executable.md`, `.claude/rules/bin-executable.md`.
- `hooks/SessionStart.md` and `hooks/subagent-nudge.json` stay `100644` — they are `cat`-ed, not executed.

## bin/

- `bin/rtk` — a small committed shell wrapper, no binary: `exec "${HOME}/.local/bin/rtk" "$@"` behind an existence check.
  - The real binary is installed at runtime into `~/.local/bin/rtk` by `hooks/rtk-install.mjs` (`hooks/CLAUDE.md` `## rtk install`); never commit it.
  - Why a bridge: Claude Code always puts an enabled plugin's own `bin/` on the Bash PATH, but `~/.local/bin` is not guaranteed to be; the wrapper keeps a bare `rtk` working by hand.
  - `hooks/rtk-rewrite.mjs`'s "never double-wire" guard treats a PATH resolution to this wrapper like the managed binary itself (`PLUGIN_BIN_RTK`).
- `bin/context-mode-launch.sh` — bun-preferred `bunx`/`npx --yes` launcher for the external `context-mode` npm package; see `## context-mode`.

## userConfig

- Four toggles, one per gated feature, all boolean `default: true`: `auto_rewrite`, `cbm_enabled`, `rtk_enabled` (the network-install gate), `steer_enabled`.
- `steer_enabled` gates ONLY the two deny-steers (`rtk-rewrite.mjs`'s steer branch and `webfetch-steer.mjs`), never the rtk rewrite.
  - It is the escape hatch for a down or misbehaving context-mode server: a deny pointing at an unavailable `ctx_*` tool would strand the model, and a command hook cannot check MCP connectivity.
- The plugin does NOT qualify for `.claude/rules/plugin-userconfig.md`'s no-toggle exception: with auto-rewrite off the `rtk` bridge is still usable by hand, so disabling the hook differs from uninstalling.
- `context-mode` deliberately has no toggle (see `## context-mode`).

### Read the env var, not a placeholder

- Hooks read `CLAUDE_PLUGIN_OPTION_<KEY>`, **not** a `${user_config.<key>}` placeholder in `hooks.json` (the `npm-automations` precedent).
  - The placeholder hard-errors when the plugin was never configured via `/plugin manage`, even though a `default` is declared.
  - Claude Code ≥ 2.1.207 rejects `${user_config.*}` in shell-run hook `command` fields outright.
- Accepted, documented gap (same as `npm-automations`): if the env var is never populated for a command-hook subprocess, an explicit `false` goes unhonored and the feature stays enabled.

### Fail-open

- `auto_rewrite` and `steer_enabled` create no files and no external state, so only the literal string `false` (after `trim()`) disables them. A deny-steer's worst case is a wrongly withheld tool call that carries a working replacement.
- `cbm_enabled` and `rtk_enabled` gate state-creating network downloads yet are deliberately fail-open — the explicit exception to `.claude/rules/plugin-userconfig.md`'s state-creating clause, as `plugins/npm-automations/hooks/CLAUDE.md` `## Toggles` documents. **Do not "harmonize" either back to fail-closed.**
  - Mitigations are structural: sha256 verification against the release's own `checksums.txt` before anything is placed, one bounded attempt, silent degradation, writes confined to one location, full reversibility. Worst case is one download — no data loss, no credential use, no repo mutation.
  - Specifics: `mcp/CLAUDE.md` `### cbm_enabled blast radius` (cbm), `hooks/CLAUDE.md` `## rtk install` (rtk).

## Output style

`output-styles/terse.md` is a fixed, always-on component next to the rtk rewrite hook and the cbm server. No toggle, deliberately: it creates no state, and `force-for-plugin` is static frontmatter no `userConfig` value can drive.

- `force-for-plugin: true` auto-applies the style whenever the plugin is enabled and **overrides the user's own `outputStyle` setting** by design.
- `keep-coding-instructions: true` keeps Claude Code's built-in software-engineering instructions, so only communication form changes, never coding behavior.
- Keep the body short — one heading plus 6 bullets, not a machine-readable contract. `output-style.bats`'s ≤ 40-line cap is the tripwire; raising it is a design decision, not a test fix.
- It is the plugin's **only OS-independent component**, which is why every "Linux only" claim in the manifests and docs (`plugin.json`, the root `marketplace.json` entry, the plugin README banner, the root README row) is scoped to the **bundled tooling**, never the whole plugin.
  - Do not "simplify" those strings to "this plugin does not work": the same edit must keep the literal `does not work` with a **singular** subject, because `manifest.bats` matches it in both manifests.
- Never add a `CLAUDE.md` to `output-styles/`: every file there is auto-discovered as an output style.

## context-mode

Registers the EXTERNAL npm package `context-mode` (upstream <https://github.com/mksglu/context-mode>, Elastic License 2.0) as the `context-mode` MCP stdio server, and injects upstream's own routing-rules document (`hooks/SessionStart.md`, verbatim; contract in `hooks/CLAUDE.md`) at every session start. Nothing else is vendored, proxied or committed.

### Launcher (`bin/context-mode-launch.sh`)

- A wrapper, not the canonical direct-`command` form: an external npm package has no local file to exec, and registering `npx` directly (upstream's `claude mcp add context-mode -- npx -y context-mode`) would lose the bun preference — the wrapper lets `bunx` win when available.
- Not a copy of `bin/mjs-launch.sh` (the identical copies in `coding-toolbox`, `universal-format`, `claude-code-knowledge`).
  - That wrapper execs a runtime against the `.mjs` path in `$1`, hence its missing-argument exit-64 guard.
  - Here the target is a fixed package spec baked in: no mandatory argv, no guard; `"$@"` is still forwarded as harmless future-proofing.
- Probe `bunx` and `npx`, the package RUNNERS. `command -v node` is the wrong check: node alone does not run `npx`.
- A `.mjs` launcher was rejected outright: a runtime must start it before it can pick one.
- PATH hardening: `export PATH="${PATH:+${PATH}:}${HOME:-}/.local/bin:${HOME:-}/.bun/bin"`.
  - APPEND the user dirs (inherited PATH wins) so a stale user-dir binary never shadows a canonical system tool — this matches the hardened sibling wrappers, not the prepending template (`.claude/skills/create-plugin/templates/mjs-launch.sh.tmpl`, described in `.claude/rules/hooks-mcp-server.md`).
  - `${PATH:+${PATH}:}` keeps the expansion empty when PATH is unset or empty (an empty PATH segment resolves to cwd); `${HOME:-}`, never a bare `~`.
- Every diagnostic goes to stderr: stdout is the MCP stdio channel.
- `CONTEXT_MODE_SPEC="context-mode@1.0.169"` lives in the wrapper only: an exact version pin, and the only version this plugin pins (rtk and cbm always track the latest release).
  - `npx --yes`, never `-y` (repo convention, `plugins/universal-lint/hooks/lint-file.mjs`).
  - Nothing automates the pin, so keeping it current is a manual edit and it can silently rot. A `context-mode-bundle.json` pin file was rejected as YAGNI for one consumer with no automated updater.

### Integrity

- cbm and rtk downloads are sha256-verified against the release's own `checksums.txt` into a plugin-owned cache — same-origin corruption/truncation detection, not an independent trust anchor.
- A registry fetch through `bunx` / `npx --yes` has **no** checksum verification at all and lands in the runtime's global package cache, outside `${CLAUDE_PLUGIN_DATA}`. The version pin buys reproducibility, not integrity.
- Do not restate cbm's mitigation language for this server — the two are not equivalent.

### `ctx_execute` / `ctx_batch_execute` bypass `Bash` hooks

- This server hands the model a code- and shell-execution path that no `Bash` `PreToolUse` hook observes: not this plugin's `rtk-rewrite.mjs`, not another plugin's hard deny gates (e.g. `coding-toolbox`'s `encoding-guard.mjs`). An MCP tool call never matches a `Bash` matcher, and no toggle can gate it.
- The steering hooks knowingly **widen** this bypass: work they push from Bash/WebFetch into `ctx_*` calls is work no `Bash`/`WebFetch` hook sees again. The steer classifier's read-only-only scope keeps the widened surface to gather commands — an accepted trade-off, not an oversight.

### No toggle, by explicit decision

- Unlike `auto_rewrite` and `cbm_enabled`, `context-mode` has no `userConfig` entry: the server is always registered and the `SessionStart` `cat` hook always fires. `steer_enabled` is NOT that toggle — it gates only the two deny-steers, never the server, the `cat` injection or the subagent nudge.
- A `context_mode_enabled` toggle was implemented (fail-open, mirroring `cbm_enabled`) and removed on explicit user instruction ("remove the toggle, context-mode should always be enabled") — not a plan/review oversight.
  - Enabling the plugin is the only consent step, and there is no way to run rtk/cbm without context-mode alongside them.
- The wrapper's unconditional exec and the `cat` hook's unconditional injection are therefore consistent by construction: no partial-disable state to keep in sync.

### Native Windows

- The top-level `description`'s Linux-only clause names only the rtk and codebase-memory features, but `bin/context-mode-launch.sh` (`#!/usr/bin/env bash`) and the `SessionStart` `cat` entry are just as platform-dependent: neither `bash` nor `cat` is on `PATH` by default on native Windows outside WSL or Git Bash. Documentation only; no behavior follows.

### Prior removals — do not "restore"

- context-mode was tried and dropped twice before: the in-repo `cave-context` plugin (it vendored and proxied the upstream package) was removed, and routing to the external context-mode plugin as an optional command accelerator was dropped from `coding-toolbox` and `claude-code-knowledge` after measuring no benefit over `rtk` for the git/gh/glab commands those plugins run.
  - Their file-scoped "no context-mode reference" tests (in `test/coding-toolbox` and `test/claude-code-knowledge`) still assert that absence.
- This registration is a deliberate, user-decided revisit with a different shape: a `bunx`/`npx`-wrapped external MCP server plus one static session-start routing document — no vendored tree, no proxy, no session-continuity machinery. It is not contingent on the earlier benchmark, which measured raw command-output size for a different tool's command set, never context-mode's sandboxed-execution or session-continuity value.
- Do not file this as an accident and "restore" the removal; do not restore `cave-context`.
