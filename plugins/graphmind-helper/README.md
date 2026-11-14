# graphmind-helper

Does for Claude Code, from the plugin, what [`graphmind setup`](https://github.com/aouicher/graphmind) and `graphmind init` do, and only while the `graphmind` binary exists. The `gm-*` skills are not part of it (but see the auto-setup note under "Already ran `graphmind setup`?").

## What it does

- **Binary check at session start.** The binary is the first `graphmind` on `PATH`, else `~/.graphmind/bin`, `~/.local/bin` or `/usr/local/bin`. Missing: a 15 s toast says so, and every other function of the plugin stays off.
- **The three hooks `setup` writes to `~/.claude/settings.json`**, as one Claude Code function-hooks module (no command hooks, no Node start per call). It reads graphmind through the MCP server's tools (`gm_status`, `gm_map`, `gm_memory_list`, `gm_search`):
  - the project briefing (status, map, priority and recent memory), added to the **first prompt** of a conversation as context (the server starts alongside the session, so a SessionStart hook would race it),
  - the prompt recall (memory and code search for the prompt's terms, a save reminder every 10th prompt),
  - the once-per-session nudge towards `/gm` instead of grep/find/Explore, added to the result of the first such search.
    Two things the MCP tools cannot do stay on the CLI, run without a shell: the priority memory list and `memory search --no-recall` (recall counting would promote automatically searched entries to priority).
- **Index status and init.** The MCP wrapper starts with the session: when the working directory is inside a git work tree (not `$HOME`) and `graphmind which` fails, it runs `graphmind init --skip-build` (registers the project and installs the git hooks), starts `graphmind build` in the background, and serves `graphmind mcp`. With graphmind 0.3.x that init also runs graphmind's one-time auto-setup (see below). The module treats a project as indexed when `gm_status` answers for it.

## Already ran `graphmind setup`?

- The module adds nothing when Claude Code's user settings (`~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR/settings.json` when that is set) name the setup's `graphmind-*.sh` scripts, so nothing is injected twice.
- The plugin's MCP server is skipped when Claude Code's global config (`~/.claude.json`, or `$CLAUDE_CONFIG_DIR/.claude.json` when that is set) already holds a `graphmind` server (init still runs); the module then uses that server's tools. To use the plugin's server instead, remove that entry (`claude mcp remove graphmind`).
- The plugin's own code never edits these files, but `graphmind init` (graphmind 0.3.x, run by the wrapper in a new repo) does, and `graphmind register` does the same, so no subcommand avoids it:
  - The first init runs graphmind's one-time auto-setup (stamp `~/.graphmind/auto-setup.stamp`). It writes setup's hooks to `~/.claude/settings.json`, the hook scripts, the `gm-*` skills and `~/.claude/CLAUDE.md`, always under `~/.claude`, even when `CLAUDE_CONFIG_DIR` is set. It also adds a `graphmind` MCP server for opencode to `~/.config/opencode/opencode.jsonc`. Without `CLAUDE_CONFIG_DIR`, from the next session the module stays silent (dedupe above) and setup's hooks take over. With `CLAUDE_CONFIG_DIR` set, Claude Code does not load those hooks and the module stays active.
  - Every init (once per new repo) adds a project-scoped `graphmind` server for that repo to Claude Code's global config (`~/.claude.json`, or `$CLAUDE_CONFIG_DIR/.claude.json` when that is set). From that repo's next session the plugin's server steps aside and the module uses that server's tools. `claude mcp remove graphmind`, run in the repo, brings back the plugin's server for that repo only.

## Requirements

The `graphmind` binary and a Claude Code version with function-hooks modules (mods).

Requires `node` on `PATH`: the MCP wrapper `bin/mcp.mjs` runs on it. Without it the server shows as failed in `/mcp`, nothing gets indexed and the module adds nothing.
