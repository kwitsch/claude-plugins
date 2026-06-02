#!/usr/bin/env bash
# PreToolUse hook (matcher: Read|Write|Edit|MultiEdit). When the cc-tools binary
# is installed, DENY the native file tool and instruct the model to perform the
# same operation through cc-tools via Bash, which preserves the file's original
# encoding (Latin-1/ISO-8859-1/Windows-1252 instead of corrupting to UTF-8).
#
# Fail-open by design: if the binary is absent, or no JSON parser is available,
# or the tool is unrecognised, exit 0 with no decision so the native tool runs
# normally. The model must never be stranded without a way to read/edit files.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

input=$(cat)
BIN="$(cctools_bin)"

# Only intercept when cc-tools is actually installed and runnable.
[ -x "$BIN" ] && "$BIN" --version >/dev/null 2>&1 || exit 0

# Pick a JSON tool: jq preferred, else a Node-compatible JS runtime (node, or
# bun — which context-mode installs and which runs the snippets below
# byte-for-byte). Without any, fail open so the native tools stay usable.
if command -v jq >/dev/null 2>&1; then
  JSON_TOOL=jq
elif command -v node >/dev/null 2>&1; then
  JSON_TOOL=js; JS=node
elif command -v bun >/dev/null 2>&1; then
  JSON_TOOL=js; JS=bun
else
  exit 0
fi

# Extract the tool name and file path.
if [ "$JSON_TOOL" = jq ]; then
  tool_name=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null) || exit 0
  file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
else
  IFS=$'\t' read -r tool_name file_path < <(printf '%s' "$input" | "$JS" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const t=o.tool_name||"";const f=(o.tool_input&&typeof o.tool_input.file_path==="string")?o.tool_input.file_path:"";process.stdout.write(t+"\t"+f+"\n")}catch(e){}})' 2>/dev/null) || exit 0
fi

# Nothing actionable (malformed input, empty tool name) -> fail open.
[ -n "${tool_name:-}" ] || exit 0

fp="${file_path:-<file_path>}"
common="cctools-edit: native file tools are intentionally blocked here to preserve file encodings — Latin-1/ISO-8859-1/Windows-1252 files get corrupted when re-saved as UTF-8. Perform this operation through cc-tools via Bash instead. Binary: $BIN"

case "$tool_name" in
  Read)
    reason="$common
Replace this Read of '$fp' with:
  $BIN read --file '$fp' --detect-encoding
It returns clean UTF-8 even for legacy-encoded files, so any old_string you build next matches the file's real bytes. Do NOT retry the native Read tool — it is blocked." ;;
  Write)
    reason="$common
Replace this Write of '$fp' with (a heredoc avoids shell-quoting problems on multi-line content):
  $BIN read --file '$fp' --detect-encoding    # only if the file already exists, to learn its encoding
  $BIN write --file '$fp' --stdin --encoding <ENC> <<'CCEOF'
  ...file content...
  CCEOF
Use ENC=UTF-8 for new files; reuse the detected encoding when overwriting. Do NOT retry the native Write tool — it is blocked." ;;
  Edit)
    reason="$common
Replace this Edit of '$fp' with:
  $BIN edit --file '$fp' --old '<old_string>' --new '<new_string>'    # add --replace-all to change every occurrence
If you get 'string not found', retry with --auto-normalize, then --aggressive-fuzzy --similarity 0.4. cc-tools preserves the original encoding automatically. Do NOT retry the native Edit tool — it is blocked." ;;
  MultiEdit)
    reason="$common
Replace this MultiEdit of '$fp' with an atomic edits file:
  cat > \"\${TMPDIR:-/tmp}/cc-edits.json\" <<'CCEOF'
  {\"file_path\": \"$fp\", \"edits\": [{\"old_string\": \"...\", \"new_string\": \"...\", \"replace_all\": false}]}
  CCEOF
  $BIN multiedit --edits-file \"\${TMPDIR:-/tmp}/cc-edits.json\"
Do NOT retry the native MultiEdit tool — it is blocked." ;;
  *)
    # Unrecognised tool (matcher is broad-but-not-exact) -> fail open.
    exit 0 ;;
esac

# Emit the deny decision.
if [ "$JSON_TOOL" = jq ]; then
  jq -n --arg reason "$reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
else
  REASON="$reason" "$JS" -e 'process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:process.env.REASON}}))'
fi
exit 0
