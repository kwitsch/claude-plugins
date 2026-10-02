# CLAUDE.md — universal-lint/hooks

## Hook design (do not "fix" without reading this)

- **One async `command` hook:** PostToolUse `Write|Edit` → `${CLAUDE_PLUGIN_ROOT}/hooks/lint-file.mjs`, `timeout: 95`, `async: true`, no `statusMessage` (silent).
  - Invoked directly, no `node` prefix (repo convention for `.mjs` command hooks); one process per Write/Edit, no persistent process.
  - `timeout: 95` = 90 s lint budget + 5 s debounce wait (see "Timeout budget").
- **Single-hook exception to the `mcp_tool`-preferred default** (`.claude/rules/hooks-mcp-server.md`):
  - A persistent MCP stdio server buys nothing for exactly one hook.
  - `async: true` removes the one argument for a server (per-event spawn latency): the agentic loop doesn't wait either way.
  - Safe because linting never mutates the file: findings arriving a turn later cost no correctness. `universal-format` stays synchronous for the opposite reason.
  - Adding a second hook voids the exception.
- **No `bin/mjs-launch.sh`, no `.mcp.json`:** a direct `.mjs` command hook needs neither; the script always runs under `node`, never `bun`, matching the repo default for direct-invoked `.mjs` hooks.

### Debounce (per-file idle window)

- Each hook process writes a unique token to a per-file marker under `tmpdir()/universal-lint-debounce/<sha256(resolved path)>.mark` (atomic: temp file + `renameSync`), sleeps `DEBOUNCE_MS`, re-reads the marker, and lints only if its token is still the newest.
  - A later edit overwrites the token, so older sleepers bail: N edits in the window → N sleeping processes, one linter run.
- `UNIVERSAL_LINT_DEBOUNCE_MS` overrides the window — a test-only fast path (bats runs at `0`); NOT a `userConfig`, not part of the hook input contract.
- Markers live in `tmpdir()`, not `${CLAUDE_PLUGIN_DATA}` (unlike `tsBuildInfoPathFor`): ephemeral signalling files with no cross-update persistence need. No cleanup routine — tiny, the OS reclaims `tmpdir()`.
- Every debounce filesystem op fails open: the lint runs on error, never silently skipped.
- **Accepted residual:** a lint already past the gate can't be cancelled, so two edits spaced further apart than the window with a lint slower than the gap can still overlap. Only a persistent server could cancel in-flight lints (the rejected design). The overlap also keeps the `--tsBuildInfoFile` race possible, but rare.

## Timeout budget (re-derive when `hooks.json` `timeout` or any `*_TIMEOUT_MS` changes)

- Lint phases run **sequentially**: the language's chain tool, then (`.ts`/`.tsx`/`.mts`/`.cts` only) `tsc`. Per-phase budgets are the `*_SPAWN_TIMEOUT_MS` constants in `lint-file.mjs`; the hook-level `timeout` is only the backstop that kills the whole process.
- `tsc`'s budget is below the npx one (a stale async finding arrives too late to be useful) and above the single-file one (a whole-project check is slower).
- Nominal worst case, TS file: chain 30 s + `tsc` 45 s = 75 s → 15 s margin inside the 90 s lint budget.
- **rtk-then-direct doubling:** `runLintTool`'s on-`PATH` branch tries `rtk` first; if that attempt times out it spawns the tool again at the same timeout. A phase can therefore cost 2× nominal (chain 60 s, on-`PATH` `tsc` 90 s). Pre-existing, applies to every chain tool, reworking it is out of scope. `manifestPath` (cargo) tools skip `rtk` — no doubling.
- **Cold npx:** the rtk-wrapped attempt is bounded by `RTK_NPX_ATTEMPT_TIMEOUT_MS` (5 s), then bare npx gets `NPX_SPAWN_TIMEOUT_MS` (55 s) → 60 s worst case, the same as the direct branch's doubling. Giving both the full npx budget would total 110 s > 90 s — the reason for the separate bound; don't unify them.
- **Accepted:** when combined wall time exceeds the 90 s lint budget (cold npx 60 s + `tsc` 45 s = 105 s, rtk doubling, or both compounding) the hook is killed and that turn's async findings are silently lost. Fail-open, never a wrong result; the next edit's `tsc` hits a warm cache.

## No toggle (do not "fix" without reading this)

- The plugin declares no `userConfig` (deliberate; see `.claude/rules/plugin-userconfig.md`'s exception list).
- Read-only linting IS the whole plugin — disabling it is equivalent to uninstalling it. An old `auto_lint: false` setting is silently ignored.

## Runtime behavior (`lint_file`)

- Every guard failure, clean result, skip (crash/misconfig) or missing tool returns `{}` silently (fail open); only issues produce a truncated `additionalContext`. The guard chain lives in `resolveLintTarget`/`lintFileHandler`.
- First chain tool on `PATH` wins; there is no per-file style-conflict skip (a linter needn't reproduce exact output the way a formatter does).
- Go entries target the edited file's **directory** (`go vet`/`golangci-lint` are package-scoped); checkstyle gets `-c <resolved config>`.
- stdout+stderr are captured and **never ignored**, unlike the formatter sibling: the findings text IS the payload. `maxBuffer` is raised well above the 1 MB default for the same reason — a noisy linter's output would otherwise truncate as ENOBUFS.
- Success is **classification, not a content diff** (the file is never modified): `classifyExit` applies each tool's documented exit-code contract.
- **Exception: `checkstyle`** is classified by output (`classifyCheckstyleOutput`): its exit code counts only `error`-severity violations, and the bundled default ruleset (and many real projects) run at `warning` — exit-code classification would silently miss real findings.
- `stylelint` (CSS/SCSS) does not share the 0-clean/1-issues contract: `0` clean, `2` real lint problem, anything else (`1` fatal, `64` bad usage, `78` bad config) skip (stylelint.io CLI docs).
- `yamllint` runs without `--strict`, so warnings-only findings don't surface — consistent with `eslint` (warnings don't affect its exit code either).

### npx fallback

- `eslint`, `markdownlint-cli2`, `markdownlint` and `stylelint` fall back to `npx --yes <package> ...` when absent from `PATH` (npm package name = bin name, so the single-positional idiom is safe; `npx` is assumed present since the hook already runs under node).
- `yamllint` has no npm package (PyPI only); `ruff`, `golangci-lint`, `go`, `ktlint`, `checkstyle` and the Rust/PHP tools have no safe npm equivalent either (npm-provenance research: `universal-format`'s `CLAUDE.md`).

### rtk compaction

- Tool on `PATH` **and** `rtk` on `PATH` → run through `rtk` for token-compacted findings. `rtk` passes the wrapped tool's exit code through unchanged (verified for `ruff`, `eslint`), so the classifiers need no awareness of it.
- Which tools `rtk` has a filter for is discovered per hook process via `rtk rewrite <tool> <static args> "__RTK_PROBE__"` (cached per tool), not hardcoded — filters come and go across `rtk` releases (`checkstyle`, `ktlint` currently have none and run directly).
  - The probe keys off non-empty stdout, not the exit code (`rtk rewrite --help` claims 0/1; observed 3/1 on 0.43.0).
- Both rtk attempts share `tryRtk`: a spawn error or signal is a failure (fall back to the un-accelerated call, so a broken `rtk` can't disable linting).
  - A clean non-zero exit is an `rtk`-internal failure only when stdout is empty/whitespace — real findings always make stdout non-empty, while `rtk` failing to reach its backend/`npx` would otherwise show up as a fake lint finding.
- **npx-fallback branch** (tool absent from `PATH`, npm-distributed): try `rtk`'s own verb first (`rtk lint <argv>` for `eslint`), **never** `rtk npx --yes <pkg>`.
  - `--yes`/`-y` defeats `rtk`'s npx package-name detection, so the wrapped call yields byte-identical unfiltered output; `rtk lint` compacts and resolves `eslint` itself even when it's absent from `PATH`.
  - `rtk markdownlint` is an unfiltered passthrough needing the literal binary: with it missing the attempt fails (empty stdout, non-zero), `tryRtk` reports failure, and the code falls through to bare `npx --yes`. `markdownlint-cli2` has no `rtk` verb and always falls through.
- `manifestPath` (cargo) tools never go through `rtk` (see "Rust").

## Path exclusions (`isExcludedPath`)

- Skips `node_modules/`, `vendor/`, `.git/`, plus two Claude-Code-owned subtrees that can land inside a broad `cwd` (e.g. `$HOME`, or a repo root nesting worktrees): `.claude/worktrees/` (harness-created git worktrees, never this session's own content) and `.claude/agent-memory/` (gitignored agent runtime artifacts).
- Any basename containing `.local.` (e.g. `settings.local.json`) is skipped in any directory, matching `.claude/.gitignore`'s `*.local.*` personal-override convention.
- **Deliberately narrow — not a blanket `.claude/` exclusion.** Tracked content under `.claude/` (`rules/`, `agents/`, `skills/`, `settings.json`) must keep getting linted; a `.claude/rules/*.md` edit still triggers markdownlint.

## TypeScript type-checking (`tsc`)

- `.ts`/`.tsx`/`.mts`/`.cts` get a **second, independent** whole-project `tsc --noEmit` beyond the `eslint` chain; plain `.js`/`.jsx`/`.mjs`/`.cjs` never trigger it. Both findings surface in one `additionalContext`, each truncated independently at `MAX_CONTEXT_CHARS`.
- `tsc` has no single-file mode with project context (it ignores `tsconfig.json` when files are passed), so it runs `-p <nearest tsconfig.json>`, found by walking up to `cwd` (`resolveTsconfig`).
- **Solution-style tsconfigs are skipped** (`looksLikeSolutionStyleTsconfig`: `"references"` present, `"include"` absent, `"files"` absent or `[]`): they compile nothing and exit `0` even with a real error in the referenced project, which would misreport "clean". `"files": []` is the TS handbook's own way to author one, so an empty array must not disqualify it.
  - Detection is a pattern regex over comment-stripped text (`stripJsonComments`), not a JSON parse: tsconfig allows comments and trailing commas, and a comment like `// see project references` would otherwise false-match.
  - Deliberately unanchored, so it matches compact and pretty-printed JSON alike. Accepted residual: a string value containing the literal `"references":`.
- Repeat checks run `--incremental --tsBuildInfoFile <cache>` under `${CLAUDE_PLUGIN_DATA}` (fallback: OS temp dir, never `cwd` — "never writes into the repo" holds either way), named by a hash of the tsconfig realpath (`tsBuildInfoPathFor`).
- **Exit contract: trust live exit codes, not the documented `ExitStatus` enum.** `classifyExit`'s `"tsc"` case is 0 clean / 1-or-2 issues / else skip, verified empirically, and it has already flipped once across a `tsc` major version (the version-by-version evidence lives in that case's comment). Re-verify whenever the installed `tsc` major changes materially and findings stop surfacing.
  - Under the native compiler, exit `1` is also used for project/config-loading failures (broken `extends`, invalid option value, missing tsconfig), so `runTypeCheck` adds a content pass for exit `1`: `tscOutputHasSourceDiagnostic` (after stripping ANSI colors) requires a diagnostic anchored to a real `.ts`/`.tsx`/`.mts`/`.cts` location.
  - A config failure alongside a real source diagnostic still surfaces the finding (one true location suffices). Exit `2` always meant a real diagnostic and skips the extra check.
- **Discovery:** `tsc` on `PATH` first (through `runLintTool`'s rtk attempt, probe args `--noEmit --incremental`), else `<cwd>/node_modules/.bin/tsc` run directly (`rtk` matches well-known command names, not absolute paths).
- **No `npx` fallback:** the `typescript` package ships two bins (`tsc`, `tsserver`), neither named like the package, so the single-positional `npx --yes <npmSpec>` idiom isn't guaranteed to resolve `tsc`.
- Overlapping hook processes in one project share the same `--tsBuildInfoFile` and could interleave writes — accepted: it's a performance cache, not a correctness input; corruption means a silent full rebuild or a non-`0`/`2` exit (skip) — a missed finding, never a wrong one.

## YAML/Markdown line-length guard (do not "fix" without reading this)

- `yamllint` (`line-length`, `error` level at 80 — NOT `warning`, despite no `--strict`) and both markdownlint tools (`MD013`, `error` at 80) ship a max-line-length rule in their bundled defaults. Left alone, every YAML/Markdown file without project linter config would get noise the project never asked for.
- `buildArgv` therefore injects a flag that disables **only that one rule**, and **only** when no project-level config for that tool exists — a project's own `.yamllint`/markdownlint config (enabled, disabled, custom max) always wins.
- **yamllint:** `hasProjectYamllintConfig(cwd)` ports yamllint's own `find_project_config_filepath` (`yamllint/cli.py`): starts at the spawn `cwd` (the project root, regardless of the linted file — yamllint has no per-file config resolution) and walks upward until the walked dir IS the user's home (checked too) or the filesystem root.
  - With nothing found it passes `-d "{extends: default, rules: {line-length: disable}}"` — single-line flow-style YAML so the value survives `rtk`'s rewrite as one argv element. `-d` overrides project **and** user-global config search entirely, hence the guard.
- **markdownlint-cli2 / markdownlint:** `hasProjectMarkdownlintConfig(fileDir)` walks from the edited file's directory to the filesystem root looking for the filenames markdownlint-cli2's `--help` lists under "Configuration via:" (verified: cli2 does **not** read a `markdownlint-cli2` key from `package.json`).
  - With nothing found, `--config` points both tools at the bundled constant `hooks/markdownlint-no-line-length.json` (`{"MD013": false}`) — a real file in git, not written at runtime, so no mkdir/write-failure handling.
- **Both walkers are deliberately unbounded past `cwd`** (unlike `resolveCheckstyleConfig`/`resolveTsconfig`): yamllint's own search climbs to `$HOME`/root regardless, and cli2's per-file resolution walks past its base directory into its ancestors (`enumerateParents`). Bounding at `cwd` would misdetect "absent" for a config above the project root (workspace/monorepo) — the opposite of this guard's purpose.
- Neither tool reads `.editorconfig`, so there is no second "configured another way" check (unlike the `printWidth` guard in `universal-format`'s `CLAUDE.md`).

## `.scss` limitation (accepted)

- `stylelint` runs with `args: []`, so no `customSyntax` and its default CSS-only parser (v14 dropped by-extension syntax inferral). SCSS needs e.g. `postcss-scss` (usually via `stylelint-config-standard-scss`), which this plugin can't bundle without a dependency the target may lack.
- Without an SCSS-aware `customSyntax`, ordinary SCSS (`//` comments, `$variables`, `&`-nesting, `#{...}`) can surface as bogus `CssSyntaxError` "issues". `.css` is unaffected.

## PHP: phpstan/psalm and the vendor/bin gap

- `phpstan` (chain[0]) and `psalm` (chain[1]) are file-scoped static analyzers — real-bug-catching, not style (like `tsc` vs `eslint`) — and PATH-only (Composer-distributed, no `npmSpec`).
- **phpstan:** only exit `0` is documented; any non-zero is `issues` (the same ambiguity accepted for `go vet`). Its default level 0 (no `phpstan.neon`/`.dist`) only catches unknown classes/functions and wrong argument counts, so a flawed file can go unreported — real, not a bug.
- **psalm:** documented 0 clean / 1 problem running Psalm / 2 real issues. A project without `psalm.xml` makes Psalm print "Could not locate a config XML file..." and exit `1` (Psalm's `CliUtils.php`) → the `skip` bucket, so a missing config never surfaces as a false finding.
- **Accepted gap:** no `vendor/bin/<tool>` discovery (the PHP analogue of `tsc`'s `node_modules/.bin` special case). Most PHP projects install these as local Composer dev-dependencies, so the chain silently no-ops there until a global/`PATH` install exists. Not solved; `tsc`'s special case is deliberately not generalized to other tools.

## Rust: cargo clippy/check, manifest targeting, and the clippy-component gap

- `.rs` routes to `cargo-clippy` (chain[0], richer) → `cargo check` (chain[1], compile-only fallback). Both are `manifestPath` tools and PATH-only (rustup-distributed; no valid npx equivalent, so no `npmSpec`).
- **Probe `cargo-clippy`, not `cargo clippy`:** `onPath("cargo-clippy")` is true iff the clippy rustup component is installed. A bare `cargo` on `PATH` without the component makes `cargo clippy` exit non-zero ("no such command: clippy"), which the coarse contract would misreport as a finding. Probing the shim makes selection fall through cleanly to `cargo check`.
- **`spawnAs` differs from the probed `name`:** the standalone `cargo-clippy` driver rejects `--manifest-path` (clap usage error, misreported as a finding on **every** edit), so the clippy entry carries `spawnAs: { name: "cargo", args: ["clippy"] }` — `onPath`/`selectLintTool` still probe `cargo-clippy`, `runLintTool` spawns `cargo clippy <args>`. No other chain entry uses `spawnAs`.
- **`-- -D warnings`:** clippy lints default to `warn` and plain `cargo clippy` exits 0 with warnings (the same pitfall as `eslint`/`yamllint`); `-D warnings` after `--` promotes them so the exit code is a trustworthy signal. Additive, non-mutating, doesn't match the banned-flag regex.
- **`manifestPath` + `resolveCargoManifest`, not `targetsDir`:** cargo takes no positional file/dir target (it works on the crate/workspace from `Cargo.toml`), but `buildArgv` normally appends one, which cargo rejects.
  - `manifestPath` emits `--manifest-path <nearest Cargo.toml>` (found walking up to `cwd`, existence-only) inserted **before** any `--` so it stays a cargo option, not a rustc arg; it targets the right crate in a multi-crate workspace.
  - A `.rs` file outside any Cargo project is a silent no-op, gated in `runChainLint` before spawning.
  - Inserting before `--` also breaks `runLintTool`'s "`tool.args` is a leading prefix of `argv`" slice, so cargo tools skip the `rtk` path.
- **Coarse contract:** `classifyExit`'s shared `cargo-clippy`/`cargo` case is `0` clean, any non-zero `issues` (101 on a compile error), as for `go`/`phpstan` — a tool malfunction isn't separable from a finding by exit code (accepted). `status === null` (timeout/signal) skips before the switch.
- `CARGO_SPAWN_TIMEOUT_MS` is a separate, larger budget (they compile the crate). A cold first build may exceed it and skip silently (fail-open); warm/incremental runs are fast.

## JSON: not covered (do not "fix" without reading this)

- `.json` is intentionally absent from `EXT_MAP` — not a bug.
- No standalone, actively-maintained JSON linter has a clean exit-code contract: `jsonlint` (npm) is dead since 2018; its successor `@prantlf/jsonlint` and `biome lint` return the same exit code (1) for "invalid JSON" and "crashed/misconfigured".
- A checkstyle-style output classifier for a tool whose own maintainers haven't separated this is unforced complexity.
- `universal-format` already rejects malformed JSON via its `prettier`/`biome` chain — format-only coverage is the honest answer.
