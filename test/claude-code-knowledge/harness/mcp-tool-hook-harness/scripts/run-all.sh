#!/usr/bin/env bash
# run-all.sh — orchestrate the mcp_tool hook harness.
#
#   ./scripts/run-all.sh                 # auto scenarios only
#   ./scripts/run-all.sh --include-semi  # also todo/task scenarios
#   ./scripts/run-all.sh --dry-run       # generate settings + commands, do not run claude
#
# Env overrides: CLAUDE_BIN, CLAUDE_PERM_MODE, CLAUDE_MAX_TURNS, CLAUDE_EXTRA_FLAGS
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required (Node 18+)." >&2
  exit 1
fi

NODE_MAJOR="$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "ERROR: Node 18+ required (found $(node -v))." >&2
  exit 1
fi

CLAUDE_BIN="${CLAUDE_BIN:-claude}"
if [ "${1:-}" != "--dry-run" ] && ! command -v "$CLAUDE_BIN" >/dev/null 2>&1; then
  echo "WARN: '$CLAUDE_BIN' not on PATH. Runner will mark scenarios NOT_RUN." >&2
  echo "      Install Claude Code or export CLAUDE_BIN=/path/to/claude, or use --dry-run." >&2
fi

echo ">> mock server self-test"
node scripts/selftest-mock.mjs

echo ">> running matrix"
node scripts/run-matrix.mjs "$@"
