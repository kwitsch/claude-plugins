#!/usr/bin/env bats
# test/init/test.bats — structural validation for the init plugin

setup() {
  PLUGIN_DIR="$BATS_TEST_DIRNAME/../../plugins/init"
}

@test "plugin.json is valid JSON" {
  run jq empty "$PLUGIN_DIR/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
}

@test "plugin.json has required fields" {
  run jq -e '.name == "init" and .version and .description and .author' \
    "$PLUGIN_DIR/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
}

@test "plugin.json declares claude-code-knowledge dependency" {
  run jq -e '[.dependencies[]? | select(.name == "claude-code-knowledge")] | length > 0' \
    "$PLUGIN_DIR/.claude-plugin/plugin.json"
  [ "$status" -eq 0 ]
}

@test "all four skill directories exist" {
  for skill in repo-init claude-repo-init codebase-repo-init lsp-repo-init; do
    [ -d "$PLUGIN_DIR/skills/$skill" ]
  done
}

@test "all four SKILL.md files exist" {
  for skill in repo-init claude-repo-init codebase-repo-init lsp-repo-init; do
    [ -f "$PLUGIN_DIR/skills/$skill/SKILL.md" ]
  done
}

@test "lsp-map.json exists and is valid JSON" {
  run jq empty "$PLUGIN_DIR/skills/lsp-repo-init/references/lsp-map.json"
  [ "$status" -eq 0 ]
}

@test "lsp-map.json contains canonical vtsls entry" {
  run jq -e '[.[] | objects | select(.server == "vtsls")] | length > 0' \
    "$PLUGIN_DIR/skills/lsp-repo-init/references/lsp-map.json"
  [ "$status" -eq 0 ]
}

@test "lsp-map.json contains canonical bashls entry" {
  run jq -e '[.[] | objects | select(.server == "bashls")] | length > 0' \
    "$PLUGIN_DIR/skills/lsp-repo-init/references/lsp-map.json"
  [ "$status" -eq 0 ]
}

@test "lsp-map.json contains canonical jsonls entry" {
  run jq -e '[.[] | objects | select(.server == "jsonls")] | length > 0' \
    "$PLUGIN_DIR/skills/lsp-repo-init/references/lsp-map.json"
  [ "$status" -eq 0 ]
}

@test "lsp-map.json alias entries are strings" {
  # e.g. ".cjs": "vtsls" — value must be a string, not an object
  run jq -e '.[".cjs"] | type == "string"' \
    "$PLUGIN_DIR/skills/lsp-repo-init/references/lsp-map.json"
  [ "$status" -eq 0 ]
}

@test "claude-repo-init SKILL.md frontmatter name matches" {
  run grep -m1 "^name:" "$PLUGIN_DIR/skills/claude-repo-init/SKILL.md"
  [[ "$output" == *"claude-repo-init"* ]]
}

@test "codebase-repo-init SKILL.md frontmatter name matches" {
  run grep -m1 "^name:" "$PLUGIN_DIR/skills/codebase-repo-init/SKILL.md"
  [[ "$output" == *"codebase-repo-init"* ]]
}

@test "lsp-repo-init SKILL.md frontmatter name matches" {
  run grep -m1 "^name:" "$PLUGIN_DIR/skills/lsp-repo-init/SKILL.md"
  [[ "$output" == *"lsp-repo-init"* ]]
}

@test "repo-init SKILL.md frontmatter name matches" {
  run grep -m1 "^name:" "$PLUGIN_DIR/skills/repo-init/SKILL.md"
  [[ "$output" == *"repo-init"* ]]
}
