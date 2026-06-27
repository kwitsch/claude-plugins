#!/usr/bin/env bats

PLUGIN="${BATS_TEST_DIRNAME}/../../plugins/lsp-base"

@test "plugin.json is valid and has a version" {
  run jq -e '.name == "lsp-base" and (.version | type == "string")' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
}

@test "exactly two command hooks: SessionStart cat + UserPromptSubmit cat (exec form), no mcp_tool" {
  run jq -e '[.hooks[][]?.hooks[]?] as $all
    | ([$all[] | select(.type=="command")]) as $cmd
    | ([$all[] | select(.type=="mcp_tool")]) as $mcp
    | ($cmd | length == 2) and ($mcp | length == 0)
      and ([$cmd[] | select(.command=="cat")] | length == 2)' "$PLUGIN/hooks/hooks.json"
  [ "$status" -eq 0 ]
}

@test "SessionStart cats SessionStart.md (exec form)" {
  run jq -e '.hooks.SessionStart[0].hooks[0] | .type=="command" and .command=="cat" and (.args[0] | endswith("hooks/SessionStart.md"))' "$PLUGIN/hooks/hooks.json"
  [ "$status" -eq 0 ]
}

@test "UserPromptSubmit cats PromptReminder.md (exec form)" {
  run jq -e '.hooks.UserPromptSubmit[0].hooks[0] | .type=="command" and .command=="cat" and (.args[0] | endswith("hooks/PromptReminder.md"))' "$PLUGIN/hooks/hooks.json"
  [ "$status" -eq 0 ]
}

@test "SessionStart.md exists, non-empty, server-agnostic, mentions workspaceSymbol" {
  f="$PLUGIN/hooks/SessionStart.md"
  [ -s "$f" ]
  grep -q "workspaceSymbol" "$f"
  run grep -qE "js-lsp|ts-lsp|shell-lsp" "$f"
  [ "$status" -ne 0 ]
}

@test "PromptReminder.md exists, non-empty, server-agnostic" {
  f="$PLUGIN/hooks/PromptReminder.md"
  [ -s "$f" ]
  run grep -qE "js-lsp|ts-lsp|shell-lsp" "$f"
  [ "$status" -ne 0 ]
}

@test "token tripwire: workspaceSymbol/goToDefinition/findReferences appear in BOTH core and reminder" {
  core="$PLUGIN/hooks/SessionStart.md"
  rem="$PLUGIN/hooks/PromptReminder.md"
  for tok in workspaceSymbol goToDefinition findReferences; do
    grep -q "$tok" "$core"
    grep -q "$tok" "$rem"
  done
}


