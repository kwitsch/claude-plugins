# Claude Code — Hook Handler Selection

<!-- AGENT-FACING REFERENCE. Not prose. Optimize for lookup + decision, not readability. -->
<!-- Source: code.claude.com/docs/en/hooks + code.claude.com/docs/en/hooks-guide. Verified 2026-08-13. Re-verify against docs if version differs. -->
<!-- Scope: choosing the `type` of a hook handler. Not about when hooks vs CLAUDE.md vs skills. -->

## Handler types

`command` | `http` | `mcp_tool` | `prompt` | `agent`

`command` splits practically into: `.sh`/shell, `.mjs`/node, compiled binary (Go/Rust).

## Decision rules — evaluate top→bottom, first match wins

1. **Hard allow/deny enforcement** (security, irreversible, policy gate)
   → use the permission system, NOT a hook. If a hook must signal: `command` with `exit 2` (or `permissionDecision: "deny"`).
   WHY: `http` + `mcp_tool` fail OPEN. non-2xx / connection failure / timeout / `isError:true` / server-not-connected = non-blocking error → action proceeds. Never gate security on a fail-open handler.
   `http` nuance: unlike `command`, an http hook CANNOT signal a blocking error via status code — to block/deny it MUST return a 2xx response carrying a JSON decision body (e.g. `permissionDecision:"deny"`). non-2xx is still just a fail-open error. Verdict unchanged: NOT reliable for hard gating.

2. **Event is `SessionStart` or `Setup`**
   → `command`. Only `command` + `mcp_tool` are supported on these events, and MCP servers are usually NOT yet connected when they fire → `mcp_tool` returns "not connected" on first run. Use `mcp_tool` here only if first-run miss is acceptable.

3. **Decision needs LLM judgment**
   - semantic check, no file access needed (e.g. "did Claude finish all tasks?", Stop/SubagentStop) → `prompt` (default 30s).
   - needs to explore code (Read/Grep/Glob) before deciding → `agent` (default 60s, experimental, slower). Adds model latency + token cost; do not use on hot paths.

4. **Fires frequently AND soft (no hard-deny) AND logic reusable/stateful** (DB conn, cache, loaded model, heavy deps)
   → `mcp_tool`. Server already running → NO per-call process spawn. Per-call cost = stdio JSON-RPC round-trip only. This is the perf sweet spot for hot soft hooks.

5. **Fires frequently AND logic is cheap + stateless** (system ops, string checks, git)
   → `command` as `.sh` or compiled binary. Shell spawn is cheap; no runtime cold start.

6. **Needs Node ecosystem AND fires rarely** (SessionStart bootstrap, occasional)
   → `command` as `.mjs`/node. NEVER put `.mjs` on a hot path (PostToolUse/PreToolUse per edit): Node cold start is paid every call.

7. **Logic lives off-host / shared language-agnostic service / soft only**
   → `http`.

## Type comparison

| type             | process per call     | per-call latency                    | hard-block reliable? | error mode                            | default timeout | holds state across calls |
| ---------------- | -------------------- | ----------------------------------- | -------------------- | ------------------------------------- | --------------- | ------------------------ |
| `command` .sh    | new shell            | ~1–5 ms                             | YES (exit 2)         | fail closed (own logic)               | 600 s           | no                       |
| `command` binary | new process          | ~1–10 ms                            | YES (exit 2)         | fail closed                           | 600 s           | no                       |
| `command` .mjs   | new node proc        | ~20–30 ms empty, 100 ms+ w/ imports | YES (exit 2)         | fail closed                           | 600 s           | no                       |
| `mcp_tool`       | none (reuses server) | stdio RPC, sub-ms–low ms            | NO — fail open       | non-blocking on not-connected/isError | 600 s           | YES (in server)          |
| `http`           | none (reuses server) | HTTP RTT (localhost ~ms)            | NO — fail open       | non-blocking on non-2xx/conn/timeout  | 600 s           | YES (in server)          |
| `prompt`         | model call           | model latency                       | event-dependent      | own decision                          | 30 s            | no                       |
| `agent`          | subagent             | model + tool latency                | event-dependent      | own decision                          | 60 s            | no                       |

`UserPromptSubmit` lowers command/http/mcp_tool default to 30 s. `MessageDisplay` lowers to 10 s. `SessionEnd` lowers to 1.5 s (budget auto-raises to the highest per-hook `timeout` configured, cap 60 s; plugin-hook timeouts don't raise it; override via env `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS`, milliseconds).

## Handler fields (config, all types unless noted)

| field             | type             | effect                                                                                                                                                                                                                                                                                           |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `async`           | `command`        | `true` → runs in background, does NOT block. A backgrounded hook can't hard-block (exit 2 is not awaited inline).                                                                                                                                                                                |
| `asyncRewake`     | `command`        | `true` → runs in background AND wakes Claude on `exit 2` (implies `async`). The hook's stderr (or stdout if stderr empty) is shown to Claude as a system reminder — the path by which a long-running background failure reaches Claude.                                                          |
| `once`            | handler          | `true` → runs once per session then is removed. ONLY honored for hooks declared in skill frontmatter; ignored in settings files and agent frontmatter.                                                                                                                                           |
| `statusMessage`   | handler          | custom spinner/status message shown while the hook runs.                                                                                                                                                                                                                                         |
| `continueOnBlock` | `prompt`/`agent` | `true` → on `ok:false`, feed `reason` back to Claude and continue the turn instead of stopping (implemented as `continue:true` on the resulting `decision:"block"`). Default `false`. No effect on `PostToolBatch`/`UserPromptSubmit`/`UserPromptExpansion`, which always end the turn on block. |
| `shell`           | `command`        | `"bash"` or `"powershell"`. Default `"bash"`, or `"powershell"` on Windows when Git Bash isn't installed. Ignored when `args` is set (exec form spawns directly, no shell).                                                                                                                      |

## mcp_tool handler shape

```json
{ "type": "mcp_tool", "server": "<connected-server>", "tool": "<tool>", "input": { "file_path": "${tool_input.file_path}" } }
```

- `server` + `tool` required; `input` optional. `${path}` substitution pulls from hook JSON input (e.g. `${tool_input.file_path}`, `${cwd}`).
- Server MUST already be connected. Hook NEVER triggers OAuth/connect flow.
- Tool text output treated as command-hook stdout: valid JSON output → parsed as decision; else shown as plain text.
- Available on every event once servers connected (except SessionStart/Setup timing, rule 2).

## command form (.sh / .mjs / binary)

- Reference path placeholders (`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_DATA}`) → set `args[]` → exec form: no shell, no quoting, one arg per element.
- Need pipes / `&&` / globs / var expansion → omit `args` → shell form (`sh -c`).
- Windows: `.cmd`/`.bat` shims (npm/npx/eslint in node_modules/.bin) are NOT executables → use shell form, OR exec form via `node` + script path (`"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/node_modules/eslint/bin/eslint.js"]`). `node`+path works every platform.

## Hard constraints

- Exit codes: only `exit 2` blocks (most events). `exit 1` = non-blocking error → action PROCEEDS. Exception: `WorktreeCreate` aborts on any non-zero.
- JSON output is read on EVERY exit code, not just `exit 0` — for events using the standard decision model, valid JSON decides the outcome regardless of exit code, EXCEPT exit 2's block itself, which JSON can never override (even `permissionDecision:"allow"`). `version >= 2.1.214:` exit 2 + JSON that fails schema validation still blocks (before: non-blocking, action proceeded).
- `if` filter is best-effort; fails OPEN on unparseable Bash. Do not use `if` for security gating — use permission rules.
- Command hooks run with NO controlling terminal (macOS/Linux). Cannot write `/dev/tty`. Surface to user via `systemMessage`; notify via `terminalSequence` (allowlisted OSC only). `version >= 2.1.141:` `terminalSequence` is supported.
- stdout reaches Claude only on `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`; elsewhere use `hookSpecificOutput.additionalContext`. Output strings capped 10k chars.
- State: `command` holds NO state between fires. Stateful/expensive init must live in a persistent server → `mcp_tool` or `http`.
- Context/token cost: model-facing MCP tools load tool defs into model context (ongoing token cost). A tool used ONLY as an `mcp_tool` hook trigger is config-driven and need not be exposed to the model — keep hook-only tools off the model surface to avoid context cost.
- `PreToolUse` decision lives in `hookSpecificOutput.permissionDecision` (allow/deny/ask/defer), NOT top-level `decision` (deprecated for this event). Multi-hook precedence: deny > defer > ask > allow.

## Quick map

- hot path, stateful, soft → `mcp_tool`
- hot path, cheap, stateless → `.sh` / Go binary
- reliable hard deny → permission rules; else `command` exit 2
- session bootstrap / env setup → `command` (.sh or .mjs)
- semantic gate → `prompt`; exploratory gate → `agent`
- off-host shared service, soft → `http`
- needs Node libs but rare → `.mjs`; needs Node libs on hot path → move logic into MCP server, call via `mcp_tool`
