#!/usr/bin/env bash
# ci-watch.sh <github|gitlab> <pr-number|branch> — poll one CI round to
# completion and reflect ONLY the real CI result: checks whose NAME
# contains "coderabbit" (case-insensitive) are excluded, so a CodeRabbit
# app that never reacts (not installed, rate-limited) can neither block
# the watch nor flip the result.
#
# GitHub: polls `gh pr checks --json`. gh exits non-zero for
# failing (1) and still-pending (8) rounds while emitting valid data, so
# green/red is derived from the CONTENT on stdout, never from the exit
# code. GitLab: polls the latest pipeline of the given branch
# (`glab ci get -b`, JSON output preferred, text fallback for old glab);
# merged-results/MR pipelines are not targeted. A repo with no
# checks/pipeline counts as green after three consecutive such answers
# (any other answer resets the counter); a `skipped` pipeline counts
# green, a `manual` gate returns green with a note. Every poll call is
# wrapped in `timeout` so one hung CLI call cannot stall the loop;
# transient API errors are retried until the deadline.
#
# Env: CI_WATCH_TIMEOUT (s, default 1800) · CI_WATCH_INTERVAL (s, default 30) ·
#      TMPDIR (honored by the stderr-capture `mktemp` below; callers set it to
#      route that temp file into a session scratch dir instead of system /tmp —
#      a bad/unwritable TMPDIR is itself an environment error, see exit 64)
# Exit codes: 0 green (notes on stdout) · 1 red · 2 deadline reached
#             without a conclusive real-CI result · 64 usage/environment
#             error (bad arguments, CLI or `timeout` missing, CLI too old,
#             mktemp failed — e.g. a bad/unwritable TMPDIR)
set -euo pipefail

# Print usage to stderr and exit 64; called on bad arg count or unknown platform.
usage() { echo "usage: ci-watch.sh <github|gitlab> <pr-number|branch>" >&2; exit 64; }
[ $# -eq 2 ] || usage
platform="$1" ref="$2"
case "$platform" in
  github) cli=gh ;;
  gitlab) cli=glab ;;
  *) usage ;;
esac
command -v "$cli" >/dev/null 2>&1 || { echo "$cli not installed" >&2; exit 64; }
# Every poll wraps the CLI in coreutils `timeout` (see poll() below); a missing
# `timeout` would otherwise fail each poll silently and spin to the deadline.
command -v timeout >/dev/null 2>&1 || { echo "timeout not installed" >&2; exit 64; }

deadline="${CI_WATCH_TIMEOUT:-1800}"
interval="${CI_WATCH_INTERVAL:-30}"
errf=$(mktemp) || { echo "mktemp failed (bad/unwritable TMPDIR?)" >&2; exit 64; }
trap 'rm -f "$errf"' EXIT
missing=0   # strictly consecutive "no checks / no pipeline" answers

# One bounded CLI call: stdout = data, stderr lands in $errf; never throws.
poll() { timeout -k 10 60 "$@" 2>"$errf" || true; }

# Prefer ripgrep; fall back to grep if rg isn't installed. rg's -E means
# --encoding=ARG and -r means --replace=ARG (both take a value, neither is
# grep's meaning), and rg has no recursive flag (recursion is its
# default) — so a bundled/bare -E is stripped before delegating to rg
# (its regex syntax is already ERE-equivalent for every pattern used in
# this file); grep gets its original arguments completely untouched.
# Note: bare `rg -c` prints nothing on 0 matches where `grep -c` prints `0`
# (both exit 1) -- no call site here checks that text (only $status or a
# nonzero count), so this divergence is accepted rather than papered over
# with --include-zero, which errors on ripgrep < 12.0.0.
rg_or_grep() {
  if command -v rg >/dev/null 2>&1; then
    local args=() a stripped seen_dashdash=false
    for a in "$@"; do
      if [ "$seen_dashdash" = true ]; then
        args+=("$a")
        continue
      fi
      case "$a" in
        --) seen_dashdash=true; args+=("$a") ;;
        -[A-Za-z]*)
          stripped="${a//E/}"
          [ "$stripped" = "-" ] && continue
          args+=("$stripped")
          ;;
        *) args+=("$a") ;;
      esac
    done
    command rg "${args[@]}"
  else
    command grep "$@"
  fi
}

while :; do
  if [ "$platform" = github ]; then
    # rc 1 (a check failed) and rc 8 (pending) still print valid data —
    # poll() discards the rc, the content below decides.
    out=$(poll gh pr checks "$ref" --json name,bucket \
            --jq '.[] | .bucket + "\t" + .name')
    err=$(cat "$errf")
    if [ -n "$out" ]; then
      missing=0
      real=$(rg_or_grep -ivE $'\t.*coderabbit' <<<"$out" || true)  # match the NAME field
      if ! rg_or_grep -q '^pending' <<<"$real"; then               # all real checks done
        printf '%s\n' "$out"
        if rg_or_grep -Eq '^(fail|cancel)' <<<"$real"; then exit 1; fi
        if rg_or_grep -iE $'\t.*coderabbit' <<<"$out" | rg_or_grep -Evq '^pass'; then
          echo "note: ignored non-passing coderabbit check(s)"
        fi
        exit 0
      fi
    else
      case "${err,,}" in
        *"no checks reported"*)
          missing=$((missing+1))
          if [ "$missing" -ge 3 ]; then echo "note: no checks reported"; exit 0; fi ;;
        *"unknown flag"*)
          echo "gh too old: pr checks --json unsupported" >&2; exit 64 ;;
        *) missing=0 ;;                                      # transient: retry
      esac
    fi
  else
    out=$(poll glab ci get -b "$ref" --output json)
    err=$(cat "$errf")
    if [ -z "$out" ] && rg_or_grep -qi "unknown flag" <<<"$err"; then
      out=$(poll glab ci get -b "$ref")                      # old glab: text output
      err=$(cat "$errf")
    fi
    if [ -n "$out" ]; then
      missing=0
      # JSON: "status":"success" · text: `status:<TAB>success` — awk's
      # default FS splits on tabs and spaces alike.
      status=$(LC_ALL=C awk '
        match($0, /"status"[[:space:]]*:[[:space:]]*"[A-Za-z_]+"/) {
          s = substr($0, RSTART, RLENGTH); sub(/.*"status"[[:space:]]*:[[:space:]]*"/, "", s)
          sub(/"$/, "", s); print s; exit
        }
        tolower($1) ~ /^status:?$/ { print $NF; exit }
      ' <<<"$out")
      case "${status,,}" in
        success)         echo "pipeline status: $status"; exit 0 ;;
        skipped)         echo "pipeline status: $status"
                         echo "note: pipeline skipped"; exit 0 ;;
        manual)          echo "pipeline status: $status"
                         echo "note: pipeline blocked on a manual gate"; exit 0 ;;
        failed|canceled) echo "pipeline status: $status"; exit 1 ;;
      esac                          # created/pending/running/…: keep polling
    else
      case "${err,,}" in
        *"no pipeline"*|*"404"*)
          missing=$((missing+1))
          if [ "$missing" -ge 3 ]; then echo "note: no pipeline found"; exit 0; fi ;;
        *) missing=0 ;;                                      # transient: retry
      esac
    fi
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "timeout: no conclusive CI result before the deadline"; exit 2
  fi
  sleep "$interval"
done
