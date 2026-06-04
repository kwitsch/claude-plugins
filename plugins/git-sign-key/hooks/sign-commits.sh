#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash): when ~/.claude/sign.key exists, rewrite every
# `git commit` invocation in the command so signing reads that key FILE via SSH
# signing — bypassing the ssh-agent AND any custom gpg.ssh.program (e.g.
# 1Password's op-ssh-sign). When the key file is absent the command is left
# untouched.
#
# Best-effort by design: a parse/rewrite miss must never block a commit, so
# every uncertain path fails open (exit 0, no output). JSON is read/emitted with
# jq if present, else node (ships with npm); without either we fail open too.
set -u

input=$(cat)

KEY_FILE="${HOME:-}/.claude/sign.key"

# Pick a JSON tool: jq preferred, else node, else fail open (no rewrite).
if command -v jq >/dev/null 2>&1; then
  JSON_TOOL=jq
elif command -v node >/dev/null 2>&1; then
  JSON_TOOL=node
else
  exit 0
fi

# Read tool_input.command (only a string command is actionable).
if [ "$JSON_TOOL" = jq ]; then
  command_str=$(printf '%s' "$input" | jq -r '.tool_input.command | strings' 2>/dev/null) || exit 0
else
  command_str=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s),c=o.tool_input&&o.tool_input.command;process.stdout.write(typeof c==="string"?c:"")}catch(e){}})' 2>/dev/null) || exit 0
fi
[ -n "$command_str" ] || exit 0

# Requirement: rewrite ONLY when the signing key file is present.
[ -f "$KEY_FILE" ] || exit 0

# Signing config injected right after the `git` token of each commit invocation.
# gpg.ssh.program=ssh-keygen forces the built-in signer, so the on-disk private
# key is used even when the user has a custom signer (1Password op-ssh-sign and
# similar) configured in gpg.ssh.program. Without it git would hand our key path
# to that program, which cannot read an on-disk key, and — with gpgsign forced —
# the commit would fail. The path is single-quoted so spaces in $HOME survive
# word-splitting; the string is built by concatenation so & or \ in $HOME stay
# literal.
flags="-c gpg.format=ssh -c gpg.ssh.program=ssh-keygen -c user.signingkey='$KEY_FILE' -c commit.gpgsign=true"

# Distinctive marker of our own injection (the signing-key flag). Used for
# idempotency: a command that already carries it is left untouched. Matching the
# signingkey value — not just gpg.ssh.program — avoids skipping a real commit
# where the user merely pinned ssh-keygen themselves.
MARKER="user.signingkey='$KEY_FILE'"

# A command-token separator that can precede a real `git` command word (outside
# quotes). Backtick opens a command substitution, also a command position.
_is_cmd_start() { case "$1" in ';'|'&'|'|'|'('|'{'|'`'|$'\n') return 0;; *) return 1;; esac; }

# Walk from just after a `git` token (index $2 in string $1) over global options
# (-C <path>/-c k=v consume a value token; --long[=v] don't) to the subcommand.
# Returns 0 when it is a `commit` invocation, else 1. Sets ALREADY=1 when our own
# signing config is already present so the rewrite is idempotent.
ALREADY=0
_is_commit_invocation() {
  local s=$1 j=$2; local n=${#s} c k tok
  ALREADY=0
  while [ "$j" -lt "$n" ]; do
    while [ "$j" -lt "$n" ]; do c=${s:$j:1}; case "$c" in ' '|$'\t') j=$((j+1));; *) break;; esac; done
    [ "$j" -ge "$n" ] && return 1
    c=${s:$j:1}
    [ "$c" = $'\n' ] && return 1
    if [ "${s:$j:6}" = "commit" ]; then
      [ "$((j+6))" -ge "$n" ] && return 0
      case "${s:$((j+6)):1}" in ' '|$'\t'|$'\n'|';'|'&'|'|'|')'|'}'|'`'|'<'|'>') return 0;; esac
      return 1
    fi
    case "$c" in
      -)
        k=$j
        while [ "$k" -lt "$n" ]; do c=${s:$k:1}; case "$c" in ' '|$'\t'|$'\n') break;; *) k=$((k+1));; esac; done
        tok=${s:$j:$((k-j))}
        # bare '-' / '--' are not global options that introduce a subcommand
        { [ "$tok" = "-" ] || [ "$tok" = "--" ]; } && return 1
        case "$tok" in *"$MARKER"*) ALREADY=1;; esac
        j=$k
        if [ "$tok" = "-c" ] || [ "$tok" = "-C" ]; then
          while [ "$j" -lt "$n" ]; do c=${s:$j:1}; case "$c" in ' '|$'\t') j=$((j+1));; *) break;; esac; done
          k=$j
          while [ "$k" -lt "$n" ]; do c=${s:$k:1}; case "$c" in ' '|$'\t'|$'\n') break;; *) k=$((k+1));; esac; done
          case "${s:$j:$((k-j))}" in *"$MARKER"*) ALREADY=1;; esac
          j=$k
        fi
        ;;
      *)
        return 1
        ;;
    esac
  done
  return 1
}

# Insert $flags after the `git` token of every commit invocation that sits at an
# UNQUOTED command position. Tracks single/double-quote and backslash state, so a
# command separator inside a quoted argument (a commit message, an echo string)
# is never mistaken for a real command position — the scanner only rewrites a
# `git` reached in unquoted context. Result is placed in the global REWRITTEN
# (avoids the trailing-newline stripping of command substitution).
# Consume one quote-aware shell word starting at index $2 of string $1; sets the
# global TOKEND to the index just past it. Used to step over `NAME=value` env-var
# assignment prefixes (the value may be quoted) without losing command position.
TOKEND=0
_skip_token() {
  local s=$1 i=$2; local n=${#s} q=none esc=0 c
  while [ "$i" -lt "$n" ]; do
    c=${s:$i:1}
    if [ "$q" = single ]; then [ "$c" = "'" ] && q=none; i=$((i+1)); continue; fi
    if [ "$q" = double ]; then
      if [ "$esc" = 1 ]; then esc=0; elif [ "$c" = '\' ]; then esc=1; elif [ "$c" = '"' ]; then q=none; fi
      i=$((i+1)); continue
    fi
    if [ "$esc" = 1 ]; then esc=0; i=$((i+1)); continue; fi
    case "$c" in
      "'") q=single; i=$((i+1));;
      '"') q=double; i=$((i+1));;
      '\') esc=1; i=$((i+1));;
      ' '|$'\t'|';'|'&'|'|'|'('|'{'|'`'|$'\n'|'<'|'>') break;;
      *) i=$((i+1));;
    esac
  done
  TOKEND=$i
}

REWRITTEN=""
_rewrite() {
  local s=$1; local n=${#s} i=0 start=0 out="" q=none esc=0 cmd_pos=1 c
  while [ "$i" -lt "$n" ]; do
    c=${s:$i:1}
    if [ "$q" = single ]; then
      [ "$c" = "'" ] && q=none
      i=$((i+1)); continue
    fi
    if [ "$q" = double ]; then
      if [ "$esc" = 1 ]; then esc=0
      elif [ "$c" = '\' ]; then esc=1
      elif [ "$c" = '"' ]; then q=none
      fi
      i=$((i+1)); continue
    fi
    # unquoted
    if [ "$esc" = 1 ]; then esc=0; cmd_pos=0; i=$((i+1)); continue; fi
    case "$c" in
      "'") q=single; cmd_pos=0; i=$((i+1)); continue;;
      '"') q=double; cmd_pos=0; i=$((i+1)); continue;;
      '\') esc=1; cmd_pos=0; i=$((i+1)); continue;;
      ' '|$'\t') i=$((i+1)); continue;;   # blanks keep cmd_pos so `sep   git` matches
    esac
    if _is_cmd_start "$c"; then cmd_pos=1; i=$((i+1)); continue; fi
    if [ "$cmd_pos" = 1 ]; then
      # An env-var assignment prefix (NAME=value …) keeps the following word at a
      # command position, so `GIT_COMMITTER_DATE=… git commit` is still rewritten.
      if [[ "${s:$i}" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
        _skip_token "$s" "$i"; i=$TOKEND; continue
      fi
      if [ "${s:$i:3}" = "git" ]; then
        case "${s:$((i+3)):1}" in
          ' '|$'\t')
            if _is_commit_invocation "$s" "$((i+3))"; then
              if [ "$ALREADY" != 1 ]; then
                out="${out}${s:$start:$((i+3-start))} ${flags}"
                start=$((i+3))
              fi
              i=$((i+3)); cmd_pos=0; continue
            fi
            ;;
        esac
      fi
    fi
    cmd_pos=0; i=$((i+1))
  done
  REWRITTEN="${out}${s:$start}"
}

_rewrite "$command_str"
cleaned=$REWRITTEN

# Nothing changed -> stay silent (do not auto-approve unrelated commits).
[ "$cleaned" = "$command_str" ] && exit 0

# Safety net: if the rewrite produced broken shell, fail open. (This catches
# syntax breakage only; the quote-aware scanner above is what prevents injecting
# flags into quoted text in the first place.)
bash -n <<<"$cleaned" 2>/dev/null || exit 0

NOTE="git-sign-key: routed commit signing through $KEY_FILE (file-based SSH signing via ssh-keygen; ssh-agent and any custom gpg.ssh.program bypassed)."
if [ "$JSON_TOOL" = jq ]; then
  printf '%s' "$input" | jq --arg cmd "$cleaned" --arg note "$NOTE" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: (.tool_input + { command: $cmd }),
      additionalContext: $note
    }
  }'
else
  printf '%s' "$input" | CLEANED="$cleaned" NOTE="$NOTE" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);const ti=Object.assign({},o.tool_input,{command:process.env.CLEANED});process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",updatedInput:ti,additionalContext:process.env.NOTE}}))})'
fi
exit 0
