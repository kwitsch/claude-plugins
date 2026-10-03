# CLAUDE.md — linux-token-efficiency/hooks

Scope: `hooks/` and `hooks/hooks.json`. Toggles (`auto_rewrite`, `steer_enabled`, `rtk_enabled`) and the fail-open exception: root `CLAUDE.md` `## userConfig`. The cbm proxy behind the `mcp_tool` hooks: `mcp/CLAUDE.md`.

## Hook wiring (`hooks.json`)

- This plugin backs nine hooks total; `hooks.json` and its `description` are the inventory — update both on any add/remove (a bats assertion ties the count to the description).
- The four cbm entries are not all `mcp_tool`:
  - `SessionStart` is a `command` hook (`mcp/server.mjs --session-start-hook`) — see below.
  - `SubagentStart`, `PreToolUse` `Grep|Glob` and `PostToolUse` `Read` are `type: "mcp_tool"` on server `plugin:linux-token-efficiency:codebase-memory`.
- `mcp_tool` entries:
  - Use the namespaced server name; the bare `.mcp.json` key resolves to "not connected" on every fire.
  - Carry an explicit `input` block each; an omitted `input` delivers `{}` instead of the hook JSON.
  - Call their own purpose-built tool (`hook_subagent_context`, `hook_symbol_context`, `hook_coverage_context`), so `hookEventName` is hardcoded per tool and can never be wrong.
  - `timeout: 20` = two 4 s child round-trips (`HOOK_CALL_TIMEOUT_MS`) + a cold-start handshake (`HOOK_CALL_TIMEOUT_MS * 2`) + margin. A lower value under-counts the first call of a session (cold child, cold project cache).
- The static `SessionStart.md` `cat` entry and the `rtk-install.mjs` entry are plain `command` hooks, unrelated to the cbm graph.

### SessionStart is a command hook

- Do not move `SessionStart` back to `mcp_tool`: the event rejects it outright (`mcp_tool hooks are not available for the 'SessionStart' hook event (no MCP client context)` on every fire), and `.claude/rules/hooks-mcp-server.md`'s decision tree prescribes a `command` hook when the event fires before the server connects.
- `mcp/server.mjs --session-start-hook` is a CLI branch: it reads the hook JSON from stdin, calls `projectStatusHandler(args, "SessionStart")` directly (no JSON-RPC loop, no persistent server), prints the result and exits 0.
- `async: true`: read-only context injection (the single-hook async exception in `.claude/rules/hooks-mcp-server.md`, precedent `universal-lint`), so the graph-status `additionalContext` arrives on the next turn instead of blocking startup for up to `timeout: 20` on a cold cache.
- No `asyncRewake`: the branch has no exit-2 path, so wake-on-exit-2 would be inert and would contradict the fail-open "every failure returns `{}`, never a decision" invariant.
- The second `SessionStart` entry (`cat` of `SessionStart.md`) does not double-inject: it delivers a different, static document no other handler produces.

## `rtk-rewrite.mjs` — a router with two exits

- `PreToolUse`/`Bash` **command** hook; not `async` (a hook returning `updatedInput` must run synchronously).
- ONE hook on the matcher, deliberately: two hooks on the same matcher would race a `deny` against an `updatedInput`.
- **Steer branch** (context-mode, gated by `steer_enabled`):
  - Denies a conservatively classified read-only gather command: a single bare `curl` GET, a ≥3-segment chain whose every pipe-stage head is in the read-only text-tool set, or a ≥3-stage all-read-only pipeline.
  - Never `wget`: its default is a file download, a side effect the steer cannot replicate.
  - The deny carries a **copy-ready replacement call** on `ctx_fetch_and_index` / `ctx_batch_execute` / `ctx_execute` (full namespaced tool name) plus an explicit "do not retry via Bash" — the anti-denial-loop measure.
  - The classifier (`splitTopLevel`/`commandHead`/`classifyBashCommand`) returns "stay" on ANYTHING beyond a flat quoted chain: substitution, redirects (`2>&1` too), subshells, background `&`, comments, newlines, unknown heads. The failure direction is always "command runs in Bash", never a wrong deny.
  - Never steer `run_in_background` calls: `ctx_*` tools cannot background, so a deny would strand the model.
- **Rewrite branch** (rtk, gated by `auto_rewrite`):
  - Everything else spawns the managed binary **by absolute path** (`~/.local/bin/rtk hook claude`) and emits rtk's rewritten command **verbatim** — no `PATH` prefix, no absolute-path substitution.
  - The bare `rtk` in that command resolves when `~/.local/bin` is on the Bash `PATH` (conventional, not guaranteed); otherwise the preflight below no-ops the hook.
- This split IS the rtk/cbm/context-mode balance:
  - git/gh and other side-effect or single commands stay in Bash under rtk compression.
  - The read-only gather class rtk has no rewrite for goes to the context-mode sandbox, where output is indexed instead of entering context.
  - Grep/Glob/Read stay cbm's domain untouched.

### Preflight (the rewrite no-ops when any holds)

- `~/.local/bin/rtk` is absent (SessionStart install not landed yet) or does not resolve (following symlinks) to a regular file. A symlinked managed install (stow/asdf/mise) is accepted; a directory/fifo/other non-regular dirent is rejected.
- `rtk` does not resolve on `PATH` at all — never emit an unresolvable command.
- The resolved `rtk` is neither the managed `~/.local/bin/rtk` nor this plugin's own `bin/rtk` PATH-bridge (`PLUGIN_BIN_RTK`): a global `rtk init -g` install owns the rewrite then; never double-wire.

### Linked-worktree guard on the git rewrite

- A rewrite naming `git` among its operands (`git status` → `rtk git status`) is withheld — the original command runs in Bash — when `cwd` resolves inside a **linked** git worktree (`isLinkedWorktree`: the `--git-dir`/`--git-common-dir` comparison `coding-toolbox`'s `fresh-pr`/`finish-pr` use in shell form).
- Why: the harness's worktree-isolation guard refuses to run rtk with a git operand in a worktree-isolated session (it cannot verify cwd/root through the opaque wrapper), which broke every dispatched agent/skill that runs git from a linked worktree.
- `hasGitOperand` is a plain whitespace-token check (`git` as a standalone token, not a substring).
- `isLinkedWorktree` is fail-open: any spawn/parse failure, or `cwd` not being a git repo, returns `false` and the rewrite applies.
- Only `git` is guarded; `gh`/`glab` and other rewrites still apply in a linked worktree.

### Output contract

- `updatedInput` is `{ ...tool_input, command: final }`: it replaces the **entire** input object, so a fresh `{command, description}` would drop `timeout` / `run_in_background` and turn a backgrounded call into a blocking one.
- Never emit `permissionDecision` on the rewrite (`allow` makes the harness drop `updatedInput`).
- Every failure path is a bare `return` inside `main()`'s single `try/catch` — never `process.exit()`, matching `encoding-guard.mjs` and `lint-file.mjs`.

## `webfetch-steer.mjs`

- `PreToolUse`/`WebFetch` **command** hook denying **every** WebFetch with a copy-ready `ctx_fetch_and_index` + `ctx_search` replacement that embeds `tool_input.url` and its hostname as the source label.
- No classifier, unlike Bash: WebFetch has no comparable non-context-mode equivalent and no side-effect cases to protect.
- Same `steer_enabled` gate (imported from `rtk-rewrite.mjs`) and same fail-open shape: any failure means WebFetch runs normally.
- A command hook, knowingly against the decision tree's `mcp_tool` preference: the reason must embed `${tool_input.url}` dynamically, the cbm proxy is the wrong category for a context-mode steer, and a third MCP server for one gate is more machinery than it justifies.
- The escape hatch for a down/unconnected context-mode server is the `steer_enabled` toggle — a command hook cannot check MCP connectivity (accepted limitation, stated in the toggle's description).

## Steering decision

- Only dynamic deny-steering with a copy-ready replacement call is wired (the two hooks above). `context-mode.bats` pins this shape: `PreToolUse` matchers exactly `["Bash","Grep|Glob","WebFetch"]`, `PostToolUse` length 1, every `mcp_tool` handler on the namespaced cbm server, no `context_guidance` literal in `hooks.json`. Changing it means revisiting this section.
- NO static `<context_guidance><tip>` hooks, ever: upstream's `createBashGuidance`/`createGrepGuidance`/`createReadGuidance` restate what `SessionStart.md` already says, a per-call token cost in a token-efficiency plugin; `createExternalMcpGuidance` (`WebFetch`) is more machinery than a tip justifies.
- NO Grep/Glob or Read steering: a context-mode hook there would stack against `hook_symbol_context` and contradict `hook_coverage_context`'s load-bearing fail-quiet contract (pinned by `cbm-hooks.bats`).

## rtk install

- `rtk-install.mjs` is an async `SessionStart` `command` hook (`async: true`, no `asyncRewake`, `timeout: 20`, gated by `rtk_enabled`) that provisions rtk into `~/.local/bin/rtk`.
- Presence-only: it acts ONLY when `~/.local/bin/rtk` is absent.
  - Fetches the release's `checksums.txt` and the tarball asset in parallel from the `releases/latest/download/` alias.
  - Verifies the tarball's sha256 against its single `checksums.txt` entry (discipline: `mcp/CLAUDE.md` `## codebase-memory-mcp bundle`), extracts, and atomically `rename`s the binary into place (temp dir on the SAME filesystem). The extracted binary is trusted, not re-hashed.
- Idempotency: a regular file or a still-resolving symlink is left untouched — a user's own rtk (stow/asdf/mise symlink included) is never clobbered. A dangling symlink at the target is cleared first so a stale leftover cannot wedge the installer.
- One bounded attempt: `DOWNLOAD_TIMEOUT_MS = 12000`, kept well under `timeout: 20` so the `finally` cleanup runs before a hard kill and no `.rtk-install.*` scratch dir is orphaned.
- Fail-open: every failure logs one stderr line and exits 0; it never runs inside the synchronous PreToolUse hook.
- The `fetchExpectedSha`/`downloadToFile`/`findBinaries` helpers live in `mcp/binary-fetch.mjs` and `usablePath` in `mcp/cbm-context.mjs`, shared with `mcp/server.mjs`'s cbm provisioning rather than duplicated.
- Blast radius: it writes into `~/.local/bin` (external state beyond `${CLAUDE_PLUGIN_DATA}`), so `rtk_enabled` is the explicit fail-open exception documented in root `## userConfig`. Worst case is one download of the latest release and one file, reversible via `rm ~/.local/bin/rtk`. **Do not "harmonize" this back to fail-closed.**
- `bin/rtk`, the committed PATH bridge to this install: root `CLAUDE.md` `## bin/`.

## SessionStart.md — verbatim contract

- `hooks/SessionStart.md` is upstream's `configs/claude-code/CLAUDE.md` byte-for-byte, git mode `100644`. NEVER edit it — not by a formatter, a markdownlint fix or an applied CodeRabbit suggestion.
- Two mechanical guards plus the rule:
  - `.prettierignore` lists it (`universal-format` prettier-formats `.md` on every `Write`/`Edit` and honors `.prettierignore`).
  - `.coderabbit.yaml`'s `reviews.path_filters` excludes it. The inline `<!-- coderabbit-skip: … -->` alternative from `.claude/rules/coderabbit-md-review.md` is unusable here: the comment itself would break fidelity.
  - `universal-lint`'s markdownlint pass is check-only and never rewrites, so any finding it prints on this file is knowingly left unfixed.
- Re-syncing with upstream is a plain file copy plus a diff, nothing else.

### The document's "BLOCKED" claims (upstream divergence)

- Its `## BLOCKED — do NOT attempt` sections ("curl / wget — BLOCKED. Intercepted and replaced with error", "Inline HTTP — BLOCKED", "WebFetch — BLOCKED") describe upstream's own routing engine (`hooks/core/routing.mjs`, ~44 KB), which this plugin deliberately does not port.
- The steering hooks make part of that real in effect: `WebFetch` is denied unconditionally and a bare `curl` GET is denied by the Bash steer branch, both with a `ctx_fetch_and_index` replacement.
- Still NOT intercepted, knowingly: `wget` (file-download side effect) and inline HTTP inside code the model writes (the 44 KB engine; out of scope).
- The file stays verbatim either way; behavior converging toward the document is a side effect of the steering decision, not a doc-fidelity fix.

## SubagentStart nudge (`subagent-nudge.json`)

- A static file, `cat`-ed by a second `SubagentStart` entry, with two unrelated points: (1) subagents print no narrative between tool calls, only their final report; (2) subagents prefer `context-mode`'s `ctx_*` tools — phrased unconditionally on the user's decision that the context-mode server is always connected (no "if connected" check).
- Point 2 exists because a subagent has its own system prompt and does not inherit the `SessionStart`-injected routing document.
- It is a `command` `cat` hook, not `mcp_tool`, although `SubagentStart` supports `mcp_tool`:
  - Bolting a static, cbm-unrelated tool onto the `codebase-memory` proxy is a category mismatch, and no other MCP server here fits.
  - By user decision, purely static content is a `cat`-ed file, not a script emitting a hardcoded string — no interpreter startup, no code to review.
- **The file must be the JSON envelope** `{"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":"..."}}`. Plain stdout is delivered as context only for `UserPromptSubmit`/`UserPromptExpansion`/`SessionStart`/`PostModelSwitch` (`claude-code-hooks-reference`, exit-codes section); on `SubagentStart` it goes to the debug log only, so a raw-prose file silently never reaches the subagent. Do not revert to `.md` or a `.mjs` script. `cat` emits the file unmodified.

## Mechanics with no in-repo precedent

- **`spawnSync`'s `input` option** pipes the hook's stdin into the rtk child. Chosen over an async `spawn` write loop because the repo uses `spawnSync` exclusively and a `PreToolUse` `updatedInput` hook must be synchronous anyway.
- **A hook whose `command` is a bare PATH-resolved system binary:** both static entries are `{"type":"command","command":"cat","args":["${CLAUDE_PLUGIN_ROOT}/hooks/<file>"]}` — the first hooks here that run a system tool instead of a bundled script. `cat` is POSIX-universal on the Linux hosts this plugin targets; exec form keeps the path an untokenized argument. A `.mjs` reader exists only to _transform_ its input; a static file that must not be transformed gets a bare `cat`.
- **Runtime `checksums.txt` verification** on every download (`rtk-install.mjs` and `mcp/server.mjs`): see `mcp/CLAUDE.md` `## codebase-memory-mcp bundle`.
