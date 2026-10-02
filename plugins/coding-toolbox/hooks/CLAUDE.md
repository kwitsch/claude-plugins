# CLAUDE.md — coding-toolbox/hooks

Do not "fix" either hook below without reading its section. MCP server launcher and `worktree_refresh` design: `plugins/coding-toolbox/mcp/CLAUDE.md`.

## Stop gate (`interaction_gate`)

`Stop` → `mcp_tool` hook, `tool: "interaction_gate"` (no matcher — `Stop` ignores it). Blocks a turn that ends with a plain-text question instead of going through `AskUserQuestion`.

- Reads the `last_assistant_message` Stop input field (Claude's final response text) directly — no transcript parsing.
- Heuristic: strip fenced code blocks, take the last non-empty line; if it ends in `?`, return `{"decision":"block","reason":"…"}` telling Claude to redo it via `AskUserQuestion`; otherwise `{}` (allow the stop).
- Keep the heuristic blunt: a rhetorical trailing `?` is an accepted false positive, traded for simplicity and for matching the Interaction axis's own "no exceptions" wording.
- Stateless — do not add a counter or loop guard. The platform's `stop_hook_active` input and 8-consecutive-block cap already bound the worst case.

## Encoding guard (`encoding-guard.mjs`)

`PreToolUse` → command hook, matcher `Read|Edit|Write|Bash`. Blocks content operations on non-UTF-8 files. Detection logic lives in `hooks/encoding-guard.mjs`.

- Must stay a **command hook**: it is a hard deny gate, and the event matrix forbids `mcp_tool` for hard gates (a down server silently fails open).
- Zero-dep executable Node script invoked directly: shebang + git mode `100755`.
- Contract: false negatives OK, false positives never — the Bash analysis is precision-biased. Binary, empty and missing files pass.
- Self-contained: no `cc-tools` dependency, and `cc-tools` invocations pass.
- Deny is PreToolUse JSON (`permissionDecision: "deny"`) naming the encoding plus an `iconv` hint.
- Fail open: every internal error exits 0 silently.
