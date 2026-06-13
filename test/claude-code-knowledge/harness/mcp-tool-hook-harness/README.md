# mcp_tool hook harness

Empirically check, per Claude Code hook **event**, what the `type:"mcp_tool"`
hook handler can actually do — and in particular validate the *inferred* limits
in the companion knowledge file `claude-code-mcp_tool-hook-matrix.md`
(`confidence: inferred|unverified` rows: Task events, WorktreeCreate, and the
global non-blocking-failure invariant).

The harness registers **one** `mcp_tool` hook on **one** event, points it at a
local mock MCP server that returns a chosen decision shape as its tool text, runs
`claude -p` with a triggering prompt, then greps the session transcript and the
`--output-format json` result for a unique marker to see whether the decision
took effect.

## What it does NOT do
It does not prove a negative for every event. Some events (Elicitation,
WorktreeCreate, SubagentStop, PreCompact, TeammateIdle, ...) cannot be triggered
from a single non-interactive prompt; for those the harness emits ready settings
and you trigger the event manually (see *Manual events*).

## Layout
```
mock-mcp-server/server.mjs   zero-dependency stdio MCP server (emit_* tools)
config/scenarios.json        event -> mode -> prompt -> expected-effect spec
scripts/run-matrix.mjs       auto runner (generate settings, run, grep, report)
scripts/generate-settings.mjs  emit settings for one (incl. manual) scenario
scripts/selftest-mock.mjs    protocol self-test (no Claude needed)
scripts/run-all.sh           orchestrator
results/                     report.json + report.md + generated configs
```

## Prerequisites
- Node 18+
- Claude Code CLI on `PATH` (or `export CLAUDE_BIN=/path/to/claude`)
- A throwaway directory / project; the harness writes probe files under
  `harness-scratch/` and reads transcripts from `~/.claude/projects`.

## Run
```bash
./scripts/run-all.sh --dry-run        # generate settings + print commands only
./scripts/run-all.sh                  # auto scenarios
./scripts/run-all.sh --include-semi   # + todo/task scenarios (TaskCreated/Completed)
node scripts/run-matrix.mjs --only pretooluse_deny,stop_block_continue
```
Outputs: `results/report.json` (machine) and `results/report.md` (table).

### Env overrides
| var | default | purpose |
|---|---|---|
| `CLAUDE_BIN` | `claude` | binary to invoke |
| `CLAUDE_PERM_MODE` | `acceptEdits` | non-interactive permission mode so Write runs without prompts |
| `CLAUDE_MAX_TURNS` | `4` | bounds the Stop-block loop scenario |
| `CLAUDE_EXTRA_FLAGS` | _(empty)_ | appended to every `claude -p` call |

## Verdict semantics
- `PASS` — the emitted decision took effect (marker / file-state confirms it).
- `FAIL` — decision did not take effect (e.g. additionalContext dropped, deny ignored).
- `INCONCLUSIVE` — effect could not be confirmed from transcript/result; inspect raw evidence in `report.json` (`ctx_hits`, `reason_hits`, `num_turns`, `result_subtype`, `stderr_tail`).
- `NOT_RUN` — dry-run, or `claude` not found.

Marker tokens: context tests grep `HARNESS_CTX_<marker>`; decision/stop tests grep `harness:<marker>`.

## How scenarios map to the knowledge file
| scenario | knowledge-file row it tests | expectation |
|---|---|---|
| `pretooluse_deny` / `pretooluse_context` | PreToolUse = full | PASS |
| `posttooluse_block` / `posttooluse_context` | PostToolUse = full; analogue of issue #24788 for the handler | PASS |
| `userpromptsubmit_context` | UserPromptSubmit = limited (timeout only) | PASS |
| `sessionstart_context` | SessionStart = limited (server race) | often FAIL on cold start (server not connected) — that *is* the limitation |
| `stop_block_continue` | Stop = full | PASS (turn continues) |
| `taskcreated_continue_false` / `taskcompleted_continue_false` | TaskCreated/Completed = limited, INFERRED | PASS for coarse `continue:false`; there is no mcp_tool path to the granular exit-2 rollback |
| `pretooluse_error_nonblocking` | global non-blocking-failure invariant | PASS (Write proceeds despite isError) |

## Manual events
Generate settings and trigger by hand:
```bash
node scripts/generate-settings.mjs taskcreated_continue_false
# -> prints mcp.json + settings path + the token to grep
claude --mcp-config results/manual/mcp.json --settings results/manual/settings.<id>.json
```
To test events not in `scenarios.json` (Elicitation, WorktreeCreate, SubagentStop,
PreCompact, ConfigChange, ...), add a scenario object with the right `event`,
`matcher`, `tool` (decision shape), and a `trigger`/`detect`, then:
- **Elicitation / ElicitationResult**: call a real MCP tool that requests user input.
- **WorktreeCreate**: launch with `--worktree` (the `unverified` row — confirm whether `emit_block`/path return aborts creation, and whether `emit_error` does NOT).
- **PreCompact / PostCompact**: trigger `/compact`.
- **SubagentStop**: prompt a task that spawns a subagent.

## CLI flag caveat
`run-matrix.mjs` uses the documented `claude -p` flags
(`--output-format json`, `--mcp-config`, `--settings`, `--permission-mode`,
`--max-turns`). Flag names shift across Claude Code versions; if a run fails to
start, check `claude -p --help`, then edit `buildArgs()` in `run-matrix.mjs` or
set `CLAUDE_EXTRA_FLAGS`.

## Safety
The mock server is local, stdio-only, and has no network or filesystem side
effects. It writes diagnostics to stderr only; stdout carries protocol messages
exclusively (required by the MCP stdio transport).
