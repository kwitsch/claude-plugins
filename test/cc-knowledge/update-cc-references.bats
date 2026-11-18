#!/usr/bin/env bats
# Hermetic suite for .claude/skills/update-cc-references/refresh.mjs.
# The script runs with cwd = a temp repo on an isolated PATH (node, git, bash,
# cat and a curl stub that writes $CURL_BODY to its -o path, or exits 22 when
# CURL_FAIL=1). HOME/TMPDIR are redirected; no network.

bats_require_minimum_version 1.5.0

setup() {
  REAL_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT="$REAL_ROOT/.claude/skills/update-cc-references/refresh.mjs"
  SOURCES="$REAL_ROOT/.claude/skills/update-cc-references/sources.json"

  MOCKBIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$MOCKBIN"
  for t in node git bash cat; do
    src="$(command -v "$t")" && [ -n "$src" ] && ln -s "$src" "$MOCKBIN/$t"
  done
  cat > "$MOCKBIN/curl" <<'STUB'
#!/usr/bin/env bash
[ "${CURL_FAIL:-}" = 1 ] && exit 22
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then out="$2"; shift; fi
  shift
done
printf '%s\n' "$CURL_BODY" > "$out"
STUB
  chmod +x "$MOCKBIN/curl"

  export HOME="$BATS_TEST_TMPDIR/home"
  export TMPDIR="$BATS_TEST_TMPDIR/tmp"
  mkdir -p "$HOME" "$TMPDIR"
  SCRATCH="$BATS_TEST_TMPDIR/scratch"
  CURL_BODY='Memory docs. CLAUDE.md imports load at startup since 2.1.50.'
  CURL_FAIL=""

  REPO="$BATS_TEST_TMPDIR/repo"
  REF="$REPO/plugins/cc-knowledge/skills/cc-reference/references/claude-code-memory-reference.md"
  PJ="$REPO/plugins/cc-knowledge/.claude-plugin/plugin.json"
  PIN="$REPO/test/cc-knowledge/test.bats"
  mkdir -p "$(dirname "$REF")" "$(dirname "$PJ")" "$(dirname "$PIN")"
  cat > "$REF" <<'EOF'
# Memory reference

> Harness-optimized. Source: code.claude.com/docs/en/memory, verified 2026-01-01.

| Field | Meaning |
| --- | --- |
| alpha | first row |
| beta | second row, version >= 2.1.100 |
| gamma | third row |
EOF
  cat > "$PJ" <<'EOF'
{
  "name": "cc-knowledge",
  "version": "1.0.0",
  "description": "Fixture plugin. (CC docs read: 2026-01-01)"
}
EOF
  cat > "$PIN" <<'EOF'
@test "plugin.json version is 1.0.0 (patch, CC reference refresh)" {
  run jq -r '.version' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$output" = "1.0.0" ]
}
EOF
  git -C "$REPO" init -q
  git -C "$REPO" add -A
  git -C "$REPO" -c user.name=t -c user.email=t@t commit -qm init
  git -C "$REPO" update-ref refs/remotes/origin/main HEAD
}

# Run refresh.mjs inside the temp repo on the isolated PATH.
refresh() {
  ( cd "$REPO" && env -i PATH="$MOCKBIN" HOME="$HOME" TMPDIR="$TMPDIR" \
      CURL_BODY="$CURL_BODY" CURL_FAIL="$CURL_FAIL" node "$SCRIPT" "$@" )
}

plan_date() { jq -r .date "$SCRATCH/plan.json"; }

edit_ref() { sed -i.bak "$1" "$REF" && rm -f "$REF.bak"; }

same_as_head() { git -C "$REPO" diff --quiet HEAD -- "$REF"; }

@test "sources.json maps every target file to docs and lists only existing reference files" {
  jq empty "$SOURCES"
  for f in $(jq -r '.targets[][]' "$SOURCES"); do
    [ -f "$REAL_ROOT/plugins/cc-knowledge/skills/cc-reference/references/$f" ]
    [ "$(jq --arg f "$f" '.files[$f].docs | length' "$SOURCES")" -gt 0 ]
  done
}

@test "plan rejects an unknown target with exit 1" {
  run --separate-stderr refresh plan bogus "$SCRATCH"
  [ "$status" -eq 1 ]
  [ "$(printf '%s' "$output" | jq -r .ok)" = "false" ]
}

@test "plan memory fetches docs and writes plan.json plus a filled workflow.js" {
  run --separate-stderr refresh plan memory "$SCRATCH"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .ok)" = "true" ]
  [ "$(printf '%s' "$output" | jq -r .workflowScript)" = "$SCRATCH/workflow.js" ]
  [ "$(jq '.targets | length' "$SCRATCH/plan.json")" -eq 1 ]
  [ "$(jq -r '.targets[0].name' "$SCRATCH/plan.json")" = "claude-code-memory-reference" ]
  [ "$(jq -r '.targets[0].file' "$SCRATCH/plan.json")" = "$(cd "$REPO" && pwd -P)/plugins/cc-knowledge/skills/cc-reference/references/claude-code-memory-reference.md" ]
  [ -s "$(jq -r '.targets[0].docs[0].path' "$SCRATCH/plan.json")" ]
  [ "$(jq -r .date "$SCRATCH/plan.json")" = "$(date +%Y-%m-%d)" ]
  run grep -q '__PLAN__' "$SCRATCH/workflow.js"
  [ "$status" -ne 0 ]
  grep -q 'claude-code-memory-reference' "$SCRATCH/workflow.js"
  # The Workflow script body must parse as an async function body (top-level await/return).
  node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8").replace(/^export /m,"");new (Object.getPrototypeOf(async function(){}).constructor)("agent","pipeline","phase",s);' "$SCRATCH/workflow.js"
}

@test "plan stops with exit 2 on an HTML-contaminated or failed fetch" {
  CURL_BODY='<!DOCTYPE html>'
  run --separate-stderr refresh plan memory "$SCRATCH"
  [ "$status" -eq 2 ]
  [ "$(printf '%s' "$output" | jq -r '.failed[0]')" = "https://code.claude.com/docs/en/memory" ]
  [ ! -f "$SCRATCH/plan.json" ]
  CURL_BODY='fine' CURL_FAIL=1
  run --separate-stderr refresh plan memory "$SCRATCH"
  [ "$status" -eq 2 ]
}
