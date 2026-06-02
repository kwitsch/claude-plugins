#!/usr/bin/env bash
# PreToolUse "Bash guard" for cctools-edit — a SECONDARY safety net that catches
# Bash commands which would WRITE/EDIT or BARE-READ an EXISTING legacy-encoded
# file (NOT UTF-8/ASCII) and DENIES them, pushing the model to use cc-tools.
#
# DESIGN: bias HARD to precision. False negatives (missing a risky command) are
# acceptable; FALSE POSITIVES (blocking a legitimate command) are NOT. On ANY
# uncertainty we fail open (allow). Only a *clean literal* path token that an
# existing-and-legacy-encoded check confirms is ever reported.
#
# Portability: must run under bash 3.2 (macOS default). No associative arrays,
# no `declare -A`, no `mapfile`. Plain string indexing with ${s:i:1}.
#
# Modes:
#   (stdin)             read PreToolUse JSON {tool_name, tool_input:{command}};
#                       deny if risky, else exit 0. Requires the cc-tools binary
#                       to be present+runnable first (else fail open).
#   --check "<cmd>"     print risky files (one per line); nothing if none; exit 0.
#                       Pure parser+classifier (no binary needed). Used by tests.
#   --strip "<cmd>"     print the de-quoted/de-heredoc transform (debug aid).
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

# Sentinel char (\x01): blanks the *contents* of quotes / substitutions /
# heredocs / escapes / comments while word boundaries are preserved. Any token
# that ends up containing it was non-literal and is therefore skipped (never
# misread as a path or an operator).
SENT=$(printf '\001')

# The encoding classifier cctools_is_legacy_file() is provided by lib.sh
# (sourced above): it reports a path as "legacy" only when `file`/`iconv`
# confirm an existing, non-empty, non-UTF-8/ASCII regular file. cc-tools' own
# detector is deliberately NOT used — it mislabels plain ASCII as ISO-8859-1,
# which would cause false positives.

# ===========================================================================
# PARSER — de-quoting transform, implemented as PASSES over the string.
#
# Pass A (strip_heredocs): line-aware. Find each unquoted `<<` / `<<-` operator,
#   record its (de-quoted) delimiter, and blank every following body line up to
#   the closing delimiter line. Supports MULTIPLE heredocs in order (the body of
#   heredoc N+1 begins immediately on the line after heredoc N's closing
#   delimiter line, even when several `<<` share one command line). `<<-` strips
#   leading TABS when matching the closing line. This MUST run first and on the
#   raw text because it is line-structured.
#
# Pass B (strip_quotes_subs): single left-to-right scan. Blank the CONTENTS of
#   single/double/ANSI-C quotes, $()/`` command substitution, <()/>() process
#   substitution, backslash-escapes, and start-of-token comments — each to one
#   sentinel — while preserving word boundaries and structural operators.
#
# Splitting both responsibilities into clearly separate passes favours clarity
# and bash-3.2 portability (no associative arrays, no mapfile).
# ===========================================================================

# Heredoc queues are plain newline-joined strings (simple, and bash-3.2 has no
# associative arrays; the indexed arrays used elsewhere are 3.2-safe).
# HD_QUEUE        : pending delimiters, in order, newline-separated.
# HD_STRIP_QUEUE  : parallel queue of "1" (<<- strip tabs) / "0" flags.
# HD_CUR_DELIM    : delimiter that closes the body currently being consumed.
# HD_CUR_STRIP    : 1 if the current body is a `<<-` (strip leading tabs).
# HD_IN_BODY      : 1 while consuming a body, else 0.
#
# hd_pop: pop the head of the queue into the "current body" state and set
# HD_IN_BODY=1. If the queue is empty, set HD_IN_BODY=0. Centralising this lets
# us re-arm body mode BOTH at a top-level newline AND immediately after a body's
# closing delimiter line (the multiple-heredocs-on-one-line case).
hd_pop() {
  if [ -z "$HD_QUEUE" ]; then
    HD_IN_BODY=0
    HD_CUR_DELIM=""
    HD_CUR_STRIP=0
    return
  fi
  HD_CUR_DELIM="${HD_QUEUE%%$'\n'*}"
  HD_CUR_STRIP="${HD_STRIP_QUEUE%%$'\n'*}"
  if [ "$HD_QUEUE" = "$HD_CUR_DELIM" ]; then
    HD_QUEUE=""
    HD_STRIP_QUEUE=""
  else
    HD_QUEUE="${HD_QUEUE#*$'\n'}"
    HD_STRIP_QUEUE="${HD_STRIP_QUEUE#*$'\n'}"
  fi
  HD_IN_BODY=1
}

# ---- Pass A: heredoc bodies ------------------------------------------------
# Sets STRIPPED_HD to the heredoc-stripped text.
strip_heredocs() {
  local s="$1"
  local n=${#s}
  local i=0
  local out=""
  local c

  HD_QUEUE=""
  HD_STRIP_QUEUE=""
  HD_IN_BODY=0
  HD_CUR_DELIM=""
  HD_CUR_STRIP=0

  while [ "$i" -lt "$n" ]; do
    c=${s:i:1}

    # --- consuming a heredoc body: blank lines until the closing delimiter ---
    if [ "$HD_IN_BODY" -eq 1 ]; then
      local line=""
      while [ "$i" -lt "$n" ]; do
        c=${s:i:1}
        [ "$c" = $'\n' ] && break
        line="$line$c"
        i=$((i + 1))
      done
      local cmp="$line"
      if [ "$HD_CUR_STRIP" -eq 1 ]; then
        while [ "${cmp#	}" != "$cmp" ]; do cmp="${cmp#	}"; done
      fi
      if [ "$cmp" = "$HD_CUR_DELIM" ]; then
        # Closing line: keep verbatim (a delimiter alone is no path/operator),
        # then immediately arm the NEXT queued heredoc if any — its body starts
        # on the following line (this is what fixes multiple `<<` on one line).
        out="$out$line"
        hd_pop
      else
        out="$out$SENT"   # body line -> single sentinel (boundary preserved)
      fi
      # Re-attach the newline we stopped on (if not at EOF).
      if [ "$i" -lt "$n" ]; then
        out="$out"$'\n'
        i=$((i + 1))
      fi
      continue
    fi

    # --- not in a body: copy text but watch for quotes (so a `<<` inside a
    #     quote is not treated as a heredoc) and for `<<` / `<<-` operators. ---
    case "$c" in
      "'")
        # copy a single-quoted run verbatim (no `<<` detection inside).
        out="$out'"; i=$((i + 1))
        while [ "$i" -lt "$n" ]; do
          c=${s:i:1}; out="$out$c"; i=$((i + 1))
          [ "$c" = "'" ] && break
        done
        ;;
      '"')
        out="$out\""; i=$((i + 1))
        while [ "$i" -lt "$n" ]; do
          c=${s:i:1}
          if [ "$c" = '\' ]; then
            out="$out\\${s:$((i + 1)):1}"; i=$((i + 2)); continue
          fi
          out="$out$c"; i=$((i + 1))
          [ "$c" = '"' ] && break
        done
        ;;
      '`')
        out="$out\`"; i=$((i + 1))
        while [ "$i" -lt "$n" ]; do
          c=${s:i:1}
          if [ "$c" = '\' ]; then
            out="$out\\${s:$((i + 1)):1}"; i=$((i + 2)); continue
          fi
          out="$out$c"; i=$((i + 1))
          [ "$c" = '`' ] && break
        done
        ;;
      '\')
        # escaped char: copy both bytes verbatim so a `\<` is not seen as `<<`.
        out="$out\\${s:$((i + 1)):1}"; i=$((i + 2))
        ;;
      '<')
        if [ "${s:$((i + 1)):1}" = '<' ] && [ "${s:$((i + 2)):1}" != '<' ]; then
          # heredoc `<<` or `<<-` (NOT `<<<` here-string). Copy the operator,
          # read the delimiter, queue it.
          local strip_tabs=0
          out="$out<<"; i=$((i + 2))
          if [ "${s:i:1}" = '-' ]; then
            strip_tabs=1; out="$out-"; i=$((i + 1))
          fi
          while [ "$i" -lt "$n" ]; do
            c=${s:i:1}
            case "$c" in
              ' ' | '	') out="$out$c"; i=$((i + 1)) ;;
              *) break ;;
            esac
          done
          # read the delimiter token (may be quoted / backslashed); compute the
          # de-quoted literal for matching, copy the raw token to output.
          local delim="" got=0
          while [ "$i" -lt "$n" ]; do
            c=${s:i:1}
            case "$c" in
              "'")
                got=1; out="$out'"; i=$((i + 1))
                while [ "$i" -lt "$n" ]; do
                  c=${s:i:1}; out="$out$c"; i=$((i + 1))
                  [ "$c" = "'" ] && break
                  delim="$delim$c"
                done
                ;;
              '"')
                got=1; out="$out\""; i=$((i + 1))
                while [ "$i" -lt "$n" ]; do
                  c=${s:i:1}; out="$out$c"; i=$((i + 1))
                  [ "$c" = '"' ] && break
                  delim="$delim$c"
                done
                ;;
              '\')
                got=1
                out="$out\\${s:$((i + 1)):1}"
                delim="$delim${s:$((i + 1)):1}"
                i=$((i + 2))
                ;;
              ' ' | '	' | $'\n' | ';' | '&' | '|' | '<' | '>' | '(' | ')')
                break ;;
              *)
                got=1; out="$out$c"; delim="$delim$c"; i=$((i + 1)) ;;
            esac
          done
          if [ "$got" -eq 1 ]; then
            if [ -z "$HD_QUEUE" ]; then
              HD_QUEUE="$delim"; HD_STRIP_QUEUE="$strip_tabs"
            else
              HD_QUEUE="$HD_QUEUE"$'\n'"$delim"
              HD_STRIP_QUEUE="$HD_STRIP_QUEUE"$'\n'"$strip_tabs"
            fi
          fi
        else
          out="$out$c"; i=$((i + 1))
        fi
        ;;
      $'\n')
        out="$out"$'\n'; i=$((i + 1))
        # A top-level newline begins the body of the next queued heredoc (when
        # one is pending and we're not already mid-body).
        if [ -n "$HD_QUEUE" ]; then
          hd_pop
        fi
        ;;
      *)
        out="$out$c"; i=$((i + 1))
        ;;
    esac
  done

  STRIPPED_HD="$out"
}

# ---- Pass B: quotes / substitutions / escapes / comments -------------------
# Sets STRIPPED to the fully de-quoted "code-only" text. Heredoc operators (the
# `<<`/`<<-` plus their delimiter token) have already been emitted by Pass A;
# here we collapse the delimiter token (and any remaining quotes) to sentinels.
strip_quotes_subs() {
  local s="$1"
  local n=${#s}
  local i=0
  local c nx
  local out=""

  while [ "$i" -lt "$n" ]; do
    c=${s:i:1}

    case "$c" in
      "'")
        # single quotes: literal, no escapes.
        out="$out$SENT"; i=$((i + 1))
        while [ "$i" -lt "$n" ]; do
          c=${s:i:1}; i=$((i + 1))
          [ "$c" = "'" ] && break
        done
        ;;
      '"')
        # double quotes: honour \" and \\.
        out="$out$SENT"; i=$((i + 1))
        while [ "$i" -lt "$n" ]; do
          c=${s:i:1}
          if [ "$c" = '\' ]; then i=$((i + 2)); continue; fi
          i=$((i + 1))
          [ "$c" = '"' ] && break
        done
        ;;
      '$')
        nx=${s:$((i + 1)):1}
        if [ "$nx" = "'" ]; then
          # $'...': \' does NOT close; \\ escapes.
          out="$out$SENT"; i=$((i + 2))
          while [ "$i" -lt "$n" ]; do
            c=${s:i:1}
            if [ "$c" = '\' ]; then i=$((i + 2)); continue; fi
            i=$((i + 1))
            [ "$c" = "'" ] && break
          done
        elif [ "$nx" = '"' ]; then
          # $"...": locale string; treat like a double quote (contents blanked).
          out="$out$SENT"; i=$((i + 2))
          while [ "$i" -lt "$n" ]; do
            c=${s:i:1}
            if [ "$c" = '\' ]; then i=$((i + 2)); continue; fi
            i=$((i + 1))
            [ "$c" = '"' ] && break
          done
        elif [ "$nx" = '(' ]; then
          # $(...): balanced parens.
          out="$out$SENT"; i=$((i + 2))
          local depth=1
          while [ "$i" -lt "$n" ] && [ "$depth" -gt 0 ]; do
            c=${s:i:1}
            case "$c" in
              '(') depth=$((depth + 1)) ;;
              ')') depth=$((depth - 1)) ;;
            esac
            i=$((i + 1))
          done
        else
          # bare $ (variable: $a, ${a}, $1) -> sentinel (token is non-literal).
          out="$out$SENT"; i=$((i + 1))
        fi
        ;;
      '`')
        # backtick command substitution; \` escapes.
        out="$out$SENT"; i=$((i + 1))
        while [ "$i" -lt "$n" ]; do
          c=${s:i:1}
          if [ "$c" = '\' ]; then i=$((i + 2)); continue; fi
          i=$((i + 1))
          [ "$c" = '`' ] && break
        done
        ;;
      '<' | '>')
        nx=${s:$((i + 1)):1}
        if [ "$nx" = '(' ]; then
          # process substitution <(...) / >(...): the '<'/'>' is NOT a redirect.
          out="$out$SENT"; i=$((i + 2))
          local depth2=1
          while [ "$i" -lt "$n" ] && [ "$depth2" -gt 0 ]; do
            c=${s:i:1}
            case "$c" in
              '(') depth2=$((depth2 + 1)) ;;
              ')') depth2=$((depth2 - 1)) ;;
            esac
            i=$((i + 1))
          done
        else
          out="$out$c"; i=$((i + 1))
        fi
        ;;
      '\')
        # escaped char outside quotes -> literal (sentinel), so `\>` is not an op.
        out="$out$SENT"; i=$((i + 2))
        ;;
      '#')
        # comment only at start-of-token (preceded by start/space/control/'(').
        local prev=""
        [ ${#out} -gt 0 ] && prev=${out:$((${#out} - 1)):1}
        case "$prev" in
          "" | ' ' | '	' | $'\n' | ';' | '&' | '|' | '(')
            out="$out$SENT"
            while [ "$i" -lt "$n" ] && [ "${s:i:1}" != $'\n' ]; do i=$((i + 1)); done
            ;;
          *)
            out="$out#"; i=$((i + 1)) ;;
        esac
        ;;
      *)
        out="$out$c"; i=$((i + 1))
        ;;
    esac
  done

  STRIPPED="$out"
}

# Run both passes; result in STRIPPED.
cctools_strip() {
  strip_heredocs "$1"
  strip_quotes_subs "$STRIPPED_HD"
}

# ===========================================================================
# CANDIDATE TARGET CLASSIFICATION
# ===========================================================================

# Is $1 a CLEAN LITERAL path token worth classifying? Reject anything that hints
# at quoting/substitution/globbing/special targets so we never act on a token we
# can't fully trust. (Precision over recall.)
cctools_is_literal_target() {
  local t="$1"
  [ -n "$t" ] || return 1
  case "$t" in *"$SENT"*) return 1 ;; esac      # had quoted/substituted content
  case "$t" in '&'* | '-'*) return 1 ;; esac    # fd-dup leftover / option-looking
  case "$t" in /dev/*) return 1 ;; esac         # device target, never a "file"
  case "$t" in                                  # globs / vars / brace / tilde
    *'$'* | *'`'* | *'*'* | *'?'* | *'['* | *']'* | *'{'* | *'}'* | *'~'*)
      return 1 ;;
  esac
  return 0
}

# Classify+report: if $1 is a clean literal path AND an existing legacy file,
# print it; else stay silent.
cctools_report_if_legacy() {
  local t="$1"
  cctools_is_literal_target "$t" || return 0
  if cctools_is_legacy_file "$t"; then
    printf '%s\n' "$t"
  fi
}

# Append newline-separated value(s) in $1 to the global HITS, de-duplicated,
# preserving first-seen order.
cctools_collect() {
  local v="$1"
  [ -n "$v" ] || return 0
  local line
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$HITS" in
      "$line" | "$line"$'\n'* | *$'\n'"$line"$'\n'* | *$'\n'"$line")
        ;;  # already present
      *)
        if [ -z "$HITS" ]; then HITS="$line"; else HITS="$HITS"$'\n'"$line"; fi ;;
    esac
  done <<EOF
$v
EOF
}

# ===========================================================================
# DETECTORS — run on each simple-command segment of the transformed string.
# ===========================================================================
cctools_detect_segment() {
  local seg="$1"

  # Tokenise on whitespace (quoted blanks are already sentinel'd, so default
  # IFS splitting yields the simple-command words). Disable globbing first.
  # shellcheck disable=SC2086
  set -f
  set -- $seg
  set +f
  [ "$#" -ge 1 ] || return 0

  local args=("$@")
  local total=$#

  # --- Pass 1: redirections (apply to ANY command) ------------------------
  # Inside [[ ... ]] / (( ... )), `<` and `>` are comparison operators, not
  # redirections; track that depth and skip redirect detection while inside.
  local k=0
  local cond_depth=0
  while [ "$k" -lt "$total" ]; do
    local w="${args[$k]}"
    local op="" rest=""

    case "$w" in
      '[[' | '((') cond_depth=$((cond_depth + 1)); k=$((k + 1)); continue ;;
      ']]' | '))') [ "$cond_depth" -gt 0 ] && cond_depth=$((cond_depth - 1)); k=$((k + 1)); continue ;;
    esac
    if [ "$cond_depth" -gt 0 ]; then k=$((k + 1)); continue; fi

    # fd-duplication / closing forms (>&N, N>&M, <&N, >&-) -> NOT a file; skip.
    case "$w" in
      *'>&'* | *'<&'*) k=$((k + 1)); continue ;;
    esac

    # A redirect operator may be GLUED to a preceding word with no space, e.g.
    # `hi>legacy.txt` or `echo>f`. Strip everything up to the first redirect
    # operator (`%%[<>]*` = longest non-operator head) so the operator+target is
    # still recognised.
    local body="$w"
    case "$body" in
      *'>'* | *'<'*) body="${body#"${body%%[<>]*}"}" ;;
    esac

    # peel an optional single leading fd digit glued to the operator (1>, 2>>).
    case "$body" in
      [0-9]'>'* | [0-9]'<'*) body="${body#?}" ;;
    esac

    case "$body" in
      '&>>'*) op='&>>'; rest="${body#'&>>'}" ;;
      '&>'*)  op='&>';  rest="${body#'&>'}" ;;
      '>>'*)  op='>>';  rest="${body#'>>'}" ;;
      '>|'*)  op='>|';  rest="${body#'>|'}" ;;
      '>'*)   op='>';   rest="${body#'>'}" ;;
      '<<'*)  op='';    rest='' ;;   # heredoc op (delimiter already sentinel'd)
      '<'*)   op='<';   rest="${body#'<'}" ;;
      *)      op='';    rest='' ;;
    esac

    if [ -n "$op" ]; then
      local target=""
      if [ -n "$rest" ]; then
        target="$rest"                  # glued: '>file'
      else
        local nk=$((k + 1))
        if [ "$nk" -lt "$total" ]; then
          target="${args[$nk]}"
          k=$nk                          # consume the separate target word
        fi
      fi
      [ -n "$target" ] && cctools_collect "$(cctools_report_if_legacy "$target")"
    fi
    k=$((k + 1))
  done

  # --- Pass 2: command-specific write ops (sed -i, tee) -------------------
  # Skip leading VAR=value assignment prefixes to find the real command name.
  local ci=0
  while [ "$ci" -lt "$total" ]; do
    case "${args[$ci]}" in
      *'='*) ci=$((ci + 1)) ;;
      *) break ;;
    esac
  done
  [ "$ci" -lt "$total" ] || return 0
  local cmd="${args[$ci]}"
  case "$cmd" in */*) cmd="${cmd##*/}" ;; esac   # strip leading path

  case "$cmd" in
    sed)
      # In-place flag? (-i, -i.bak, bundled -ni, --in-place[=...]).
      local has_inplace=0
      local q=$((ci + 1))
      while [ "$q" -lt "$total" ]; do
        local ow="${args[$q]}"
        case "$ow" in
          --in-place | --in-place=*) has_inplace=1 ;;
          --*) : ;;                                  # other long option
          -*i*) has_inplace=1 ;;                     # short cluster containing i
        esac
        q=$((q + 1))
      done
      [ "$has_inplace" -eq 1 ] || return 0
      # Non-option words are file args. The sed *script* (s/a/b/) fails the
      # existing-file gate, so passing it through is harmless. BSD `sed -i ''`
      # empty suffix arrives sentinel'd -> skipped by the gate.
      q=$((ci + 1))
      while [ "$q" -lt "$total" ]; do
        case "${args[$q]}" in
          -*) q=$((q + 1)); continue ;;
        esac
        cctools_collect "$(cctools_report_if_legacy "${args[$q]}")"
        q=$((q + 1))
      done
      ;;
    tee)
      # Every non-option word after `tee` is a target (with/without -a).
      local p2=$((ci + 1))
      while [ "$p2" -lt "$total" ]; do
        case "${args[$p2]}" in
          -*) p2=$((p2 + 1)); continue ;;
        esac
        cctools_collect "$(cctools_report_if_legacy "${args[$p2]}")"
        p2=$((p2 + 1))
      done
      ;;
  esac
}

# BARE-cat detector: the WHOLE command must be exactly `cat` + path/option args
# with NO control operator / newline / redirection anywhere. (cat in a pipeline
# or chain is processing, not viewing, and is allowed.) Operates on the
# transformed string so it can verify the no-operator condition.
cctools_detect_bare_cat() {
  local t="$1"
  case "$t" in
    *'|'* | *';'* | *'&'* | *$'\n'* | *'>'* | *'<'*) return 0 ;;
  esac

  # shellcheck disable=SC2086
  set -f
  set -- $t
  set +f
  [ "$#" -ge 1 ] || return 0

  while [ "$#" -ge 1 ]; do
    case "$1" in
      *'='*) shift ;;     # leading VAR=value assignment
      *) break ;;
    esac
  done
  [ "$#" -ge 1 ] || return 0

  local cmd="$1"
  case "$cmd" in */*) cmd="${cmd##*/}" ;; esac
  [ "$cmd" = cat ] || return 0
  shift

  local a
  for a in "$@"; do
    case "$a" in
      '-' | -*) continue ;;   # stdin marker or option
    esac
    cctools_collect "$(cctools_report_if_legacy "$a")"
  done
}

# ===========================================================================
# ORCHESTRATION: transform, split into segments, run detectors. -> HITS.
# ===========================================================================
cctools_scan_command() {
  local cmd="$1"
  HITS=""

  # Performance guard: the transform scans char-by-char (~O(n^2) in bash), and
  # this hook runs on EVERY Bash call. On a very long command (e.g. a big
  # heredoc) skip rather than stall — a missed detection is acceptable for a
  # secondary net; a multi-second hook is not. 2048 covers any real file-op
  # command line while bounding worst-case latency (~0.25s here, more on 3.2).
  [ "${#cmd}" -le 2048 ] || return 0

  # Fast path: every detector needs a redirect (> <) or one of cat/sed/tee. If
  # none can appear, skip the char-by-char parser entirely (most Bash commands).
  case "$cmd" in
    *'>'* | *'<'* | *cat* | *sed* | *tee*) ;;
    *) return 0 ;;
  esac

  cctools_strip "$cmd"
  local t="$STRIPPED"

  # Whole-command bare-cat detector.
  cctools_detect_bare_cat "$t"

  # Split into simple-command segments on unquoted control operators
  # | || && ; & and newline. We keep `>|` glued FIRST so its '|' is not
  # misread as a pipe boundary (`echo hi >| f` is one redirect, not a pipe).
  # We walk char-by-char (longest-operator-first) and emit newline boundaries.
  local out="" m=${#t} j=0 ch nxt cdepth=0
  while [ "$j" -lt "$m" ]; do
    ch=${t:j:1}
    nxt=${t:$((j + 1)):1}
    # Track [[ ]] / (( )) so control operators INSIDE a conditional/arithmetic
    # (e.g. `[[ a || b ]]`) don't split the segment — their < > are comparisons,
    # neutralised in the redirect pass by its own depth check.
    case "$ch$nxt" in
      '[[' | '((') cdepth=$((cdepth + 1)); out="$out$ch$nxt"; j=$((j + 2)); continue ;;
      ']]' | '))') [ "$cdepth" -gt 0 ] && cdepth=$((cdepth - 1)); out="$out$ch$nxt"; j=$((j + 2)); continue ;;
    esac
    if [ "$cdepth" -eq 0 ]; then
      # `>|` (optionally with a leading fd already consumed): keep both chars,
      # the '|' here is the noclobber-override, NOT a pipe.
      if [ "$ch" = '>' ] && [ "$nxt" = '|' ]; then
        out="$out>|"; j=$((j + 2)); continue
      fi
      case "$ch$nxt" in
        '||' | '&&') out="$out"$'\n'; j=$((j + 2)); continue ;;
      esac
      case "$ch" in
        '|' | ';' | '&' | $'\n') out="$out"$'\n'; j=$((j + 1)); continue ;;
      esac
    fi
    out="$out$ch"; j=$((j + 1))
  done

  local seg
  while IFS= read -r seg; do
    [ -n "$seg" ] || continue
    cctools_detect_segment "$seg"
  done <<EOF
$out
EOF
}

# ===========================================================================
# MODE DISPATCH
# ===========================================================================
mode="${1:-}"

case "$mode" in
  --strip)
    cctools_strip "${2:-}"
    printf '%s\n' "$STRIPPED"
    exit 0
    ;;
  --check)
    cctools_scan_command "${2:-}"
    [ -n "$HITS" ] && printf '%s\n' "$HITS"
    exit 0
    ;;
esac

# ---- stdin mode (default): full PreToolUse guard ---------------------------

# Require the cc-tools binary to be present and runnable (stdin mode ONLY).
BIN="$(cctools_bin)"
[ -x "$BIN" ] && "$BIN" --version >/dev/null 2>&1 || exit 0

input=$(cat)

# Parse JSON with jq if present, else node, else fail open.
command_str=""
tool_name=""
if command -v jq >/dev/null 2>&1; then
  tool_name=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null) || exit 0
  command_str=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
elif command -v node >/dev/null 2>&1; then
  # Carry the command (which may contain newlines) through base64 so the
  # tab-delimited read stays intact.
  IFS=$'\t' read -r tool_name command_str < <(printf '%s' "$input" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      try{
        const o=JSON.parse(s);
        const t=o.tool_name||"";
        const c=(o.tool_input&&o.tool_input.command)||"";
        process.stdout.write(t+"\t"+Buffer.from(c,"utf8").toString("base64")+"\n");
      }catch(e){}
    })' 2>/dev/null) || exit 0
  if [ -n "${command_str:-}" ]; then
    command_str=$(printf '%s' "$command_str" | { base64 -d 2>/dev/null || base64 -D 2>/dev/null; })
  fi
else
  exit 0
fi

# Only the Bash tool is in scope; anything else fails open.
[ "${tool_name:-}" = "Bash" ] || exit 0
[ -n "${command_str:-}" ] || exit 0

cctools_scan_command "$command_str"
[ -n "$HITS" ] || exit 0

# Build a newline-free file list for the reason.
files_inline=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if [ -z "$files_inline" ]; then files_inline="$f"; else files_inline="$files_inline, $f"; fi
done <<EOF
$HITS
EOF

reason="cctools-edit Bash guard: this shell command would read/write the legacy-encoded file(s) [$files_inline] directly, which corrupts non-UTF-8 encodings (e.g. Latin-1/ISO-8859-1/Windows-1252, UTF-16). Use the cc-tools binary instead, e.g.:
  $BIN read --file '<file>' --detect-encoding         # to view
  $BIN edit --file '<file>' --old '<old>' --new '<new>'   # to edit
  $BIN write --file '<file>' --stdin --encoding <ENC> <<'CCEOF' ... CCEOF   # to overwrite
cc-tools preserves the original encoding automatically. Do NOT retry this shell command on the listed file(s)."

# Emit the deny decision (jq preferred, node fallback — same shape).
if command -v jq >/dev/null 2>&1; then
  jq -n --arg reason "$reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
else
  REASON="$reason" node -e 'process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:process.env.REASON}}))'
fi
exit 0
