#!/usr/bin/env bash
# quota-state.sh <check|record|format_time> <tool> [error_text]
#   check <tool>            -- exit 0: blocked (stdout: reset epoch); exit 1: clear
#   record <tool> <error>   -- write quota file if error matches rate-limit pattern
#                              exit 0: newly quota-limited; exit 1: no match
#   format_time <epoch>     -- print human-readable HH:MM from epoch
set -euo pipefail

QUOTA_DIR="${HOME}/.claude/branch-management/quota"
cmd="${1:-}"
tool="${2:-}"

case "$cmd" in
  check)
    file="${QUOTA_DIR}/${tool}.quota"
    if [[ ! -f "$file" ]]; then
      exit 1
    fi
    reset_at=$(cat "$file")
    if [[ -z "$reset_at" ]]; then
      rm -f "$file"
      exit 1
    fi
    now=$(date +%s)
    if [[ "$now" -lt "$reset_at" ]]; then
      echo "$reset_at"
      exit 0
    fi
    rm -f "$file"
    exit 1
    ;;
  record)
    error_text="${3:-}"
    if echo "$error_text" | grep -qiE 'rate.?limit|quota|reviews/hour|429|too many requests'; then
      mkdir -p "$QUOTA_DIR"
      window=3600
      reset_at=$(( $(date +%s) + window ))
      echo "$reset_at" > "${QUOTA_DIR}/${tool}.quota"
      echo "$reset_at"
      exit 0
    fi
    exit 1
    ;;
  format_time)
    epoch="$tool"
    date -d "@${epoch}" '+%H:%M' 2>/dev/null || date -r "${epoch}" '+%H:%M'
    ;;
  *)
    echo "Usage: quota-state.sh <check|record|format_time> <tool> [error_text]" >&2
    exit 64
    ;;
esac
