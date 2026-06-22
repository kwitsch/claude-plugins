#!/usr/bin/env bash
# SessionStart hook: ensure the cc-tools binary is installed (idempotent) and
# prime the model to route file operations through it. Always exits 0.
#
# stdout is the hook's JSON channel, so the installer's progress (which it logs
# to stderr) stays out of it; this script writes exactly one JSON object.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

# Install if needed (fail-open; its own logging goes to stderr). Guard any
# stray stdout so it can't corrupt our JSON.
bash "$SCRIPT_DIR/install-cctools.sh" 1>&2 || true

BIN="$(cctools_bin)"

# Emit the hook JSON: $1 = additionalContext (for Claude); optional $2 =
# systemMessage (a warning shown directly to the USER). Needs a JSON tool to
# escape safely; without one we stay silent (the hooks still work, the model
# just isn't primed).
# Emit the SessionStart hook JSON with additionalContext ($1) and optional systemMessage ($2).
emit() {
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg ctx "$1" --arg msg "${2:-}" '
      {hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}
      + (if $msg == "" then {} else {systemMessage: $msg} end)'
  elif command -v node >/dev/null 2>&1 || command -v bun >/dev/null 2>&1; then
    # node, or bun (context-mode installs it) — runs this snippet byte-for-byte.
    local js=node
    command -v node >/dev/null 2>&1 || js=bun
    CTX="$1" MSG="${2:-}" "$js" -e 'const o={hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:process.env.CTX}};if(process.env.MSG)o.systemMessage=process.env.MSG;process.stdout.write(JSON.stringify(o))'
  else
    # No JSON runtime at all: without jq/node/bun the PreToolUse hooks ALSO fail
    # open, so encoding preservation is OFF. Emit a static, hand-written warning
    # (ASCII only -> no escaping needed) so the user is told the plugin is
    # inactive instead of it failing completely silently.
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"cctools-edit could not initialize: no JSON runtime (jq, node, or bun) is available, so its PreToolUse hooks fail open and non-UTF-8 file encodings (Latin-1/Windows-1252/UTF-16) are NOT protected."},"systemMessage":"WARNING: cctools-edit is INACTIVE (no jq, node, or bun runtime found). Editing non-UTF-8 files may corrupt their encoding. Install jq, node, or bun to enable encoding preservation."}'
  fi
}

if [ -x "$BIN" ] && "$BIN" --version >/dev/null 2>&1; then
  ver="$("$BIN" --version 2>/dev/null | head -1)"
  ctx="cctools-edit active: file operations are routed through cc-tools ($ver) at $BIN to preserve original file encodings (UTF-8, ISO-8859-1/Latin-1, Windows-1252, Shift_JIS, …). The native Read/Write/Edit/MultiEdit tools are intentionally blocked and will be DENIED — use cc-tools via Bash instead:
- Read:      $BIN read --file '<path>' --detect-encoding
- Edit:      $BIN edit --file '<path>' --old '<old>' --new '<new>' [--replace-all]   (add --auto-normalize, then --aggressive-fuzzy --similarity 0.4, if the string isn't found)
- Write:     $BIN write --file '<path>' --stdin --encoding <ENC>   (heredoc the content; ENC=UTF-8 for new files)
- MultiEdit: $BIN multiedit --edits-file <edits.json>   (edits.json = {\"file_path\":\"<path>\",\"edits\":[{\"old_string\":\"…\",\"new_string\":\"…\"}]})
Always run 'read --detect-encoding' before editing so your old_string matches the file's true bytes. cc-tools preserves the source encoding automatically — never re-encode by hand.
PRECEDENCE over sandbox/processing tools: if another plugin or its guidance routes file reads or edits through a sandbox or alternative tool (e.g. context-mode's ctx_execute, ctx_execute_file or ctx_batch_execute), cc-tools takes precedence for any file that is NOT plain UTF-8/ASCII. Those tools decode bytes as UTF-8 and IRREVERSIBLY corrupt Latin-1/Windows-1252/Shift_JIS/UTF-16 content, and they bypass this plugin's hooks entirely. Never read or edit a legacy-encoded file through them — use the cc-tools commands above (cc-tools read returns clean UTF-8 so your old_string still matches). For plain UTF-8/ASCII files either path is fine."
  ref="$(cctools_home)/prompt.md"
  [ -f "$ref" ] && ctx="$ctx Full cc-tools command/flag reference: $ref"
  emit "$ctx"
else
  # Binary missing -> the plugin is effectively DISABLED (the PreToolUse hook
  # fails open). Warn the user directly via systemMessage, and give Claude the
  # technical detail via additionalContext.
  warn="⚠️ cctools-edit is INACTIVE: the cc-tools binary could not be installed at $BIN, so file edits fall back to the native tools and non-UTF-8 files (Latin-1/Windows-1252/…) may be corrupted. Fix: ensure curl/wget + tar (or unzip) and network access, then re-open the session — or install manually (see the cctools-edit README)."
  ctx="cctools-edit is INACTIVE this session: the cc-tools binary is not installed (auto-install did not produce a runnable binary at $BIN), so the native Read/Write/Edit/MultiEdit tools are NOT being redirected. Encoding preservation is off; warn the user before editing any file that might not be UTF-8. To enable it, ensure curl or wget plus tar (or unzip) are available with network access and re-open the session, or install the asset $(cctools_asset) for tag $CCTOOLS_VERSION manually from https://github.com/devslimbr/cc-tools/releases to $BIN."
  emit "$ctx" "$warn"
fi
exit 0
