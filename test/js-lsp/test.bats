#!/usr/bin/env bats

PLUGIN="${BATS_TEST_DIRNAME}/../../plugins/js-lsp"

@test "plugin.json is valid and has a version" {
  run jq -e '.name == "js-lsp" and (.version | type == "string")' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
}

@test "plugin.json declares exactly the two userConfig toggles" {
  run jq -r '.userConfig | keys | sort | join(",")' "$PLUGIN/.claude-plugin/plugin.json"
  [ "$output" = "enforce_read_gate,enforce_search" ]
}

@test ".lsp.json maps only JavaScript extensions (no .ts/.tsx)" {
  run jq -r '.vtsls.extensionToLanguage | keys | sort | join(",")' "$PLUGIN/.lsp.json"
  [ "$output" = ".cjs,.js,.jsx,.mjs" ]
}

@test ".lsp.json never maps a TypeScript extension" {
  run jq -e '[.vtsls.extensionToLanguage | keys[] | select(test("\\.[cm]?tsx?$"))] | length == 0' "$PLUGIN/.lsp.json"
  [ "$status" -eq 0 ]
}

@test "vtsls-launch.sh is executable and passes bash -n" {
  [ -x "$PLUGIN/bin/vtsls-launch.sh" ]
  run bash -n "$PLUGIN/bin/vtsls-launch.sh"
  [ "$status" -eq 0 ]
}
