#!/usr/bin/env bats

load 'test_helper'

setup() {
  common_setup
  CONFIG_SCRIPT="$SKILL_DIR/scripts/dprint-config.mjs"
  PROJ="$BATS_TEST_TMPDIR/proj"
  mkdir -p "$PROJ"
  cd "$PROJ"
}

# run_config <args...> -- run the real script on the isolated PATH/HOME; $output is stdout only.
run_config() {
  run --separate-stderr env PATH="$MOCKBIN" HOME="$HOME" "$MOCKBIN/node" "$CONFIG_SCRIPT" "$@"
}

@test "detect: empty dir -> exit 0, nothing found" {
  run_config detect
  assert_success
  assert_output '{"existing":null,"sources":[]}'
}

@test "detect: each dprint config path is reported as existing" {
  local p
  for p in dprint.json dprint.jsonc .dprint.json .dprint.jsonc .config/dprint.json .config/dprint.jsonc; do
    cd "$BATS_TEST_TMPDIR"
    rm -rf "$PROJ"
    mkdir -p "$PROJ/.config"
    cd "$PROJ"
    printf '{}\n' > "$p"
    run_config detect
    assert_success
    assert_output "{\"existing\":\"$p\",\"sources\":[]}"
  done
}

@test "detect: .config/.dprint.json is not a dprint config location" {
  mkdir -p .config
  printf '{}\n' > .config/.dprint.json
  run_config detect
  assert_success
  assert_output '{"existing":null,"sources":[]}'
}

@test "detect: editorconfig [*] maps all four keys, lowercased, last value wins, comments skipped" {
  cat > .editorconfig << 'EOF'
root = true
# comment
; comment
[*]
INDENT_STYLE = Space
indent_size = 2
max_line_length = 100
end_of_line = CRLF
end_of_line = lf
EOF
  run_config detect
  assert_success
  assert_output '{"existing":null,"sources":[{"file":".editorconfig","settings":{"lineWidth":100,"indentWidth":2,"useTabs":false,"newLineKind":"lf"}}]}'
}

@test "detect: editorconfig ignores other sections, indent_size=tab falls back to tab_width, off and cr skipped" {
  cat > .editorconfig << 'EOF'
[*]
indent_style = tab
indent_size = tab
tab_width = 4
max_line_length = off
end_of_line = cr

[*.md]
indent_style = space
indent_size = 8
max_line_length = 80
end_of_line = crlf
EOF
  run_config detect
  assert_success
  assert_output '{"existing":null,"sources":[{"file":".editorconfig","settings":{"indentWidth":4,"useTabs":true}}]}'
}

@test "detect: widths above dprint's u32 range are skipped in editorconfig and Prettier" {
  printf '[*]\nmax_line_length = 99999999999999999999\nindent_size = 4294967296\n' > .editorconfig
  printf '{"printWidth": 1e20, "tabWidth": 4294967296}\n' > .prettierrc
  run_config detect
  assert_success
  assert_output '{"existing":null,"sources":[{"file":".editorconfig","settings":{}},{"file":".prettierrc","settings":{}}]}'
}

@test "detect: gitattributes '* eol=crlf' maps; non-* patterns ignored" {
  printf '* text=auto eol=crlf\n*.sh eol=lf\n' > .gitattributes
  run_config detect
  assert_success
  assert_output '{"existing":null,"sources":[{"file":".gitattributes","settings":{"newLineKind":"crlf"}}]}'
}

@test "detect: gitattributes with nothing mapping -> {}" {
  printf '# * eol=lf\n*.bat eol=crlf\n' > .gitattributes
  run_config detect
  assert_success
  assert_output '{"existing":null,"sources":[{"file":".gitattributes","settings":{}}]}'
}

@test "detect: JSON .prettierrc maps the four keys and ignores the rest" {
  printf '{"printWidth": 100, "tabWidth": 4, "useTabs": false, "endOfLine": "crlf", "semi": false}\n' > .prettierrc
  run_config detect
  assert_success
  assert_output '{"existing":null,"sources":[{"file":".prettierrc","settings":{"lineWidth":100,"indentWidth":4,"useTabs":false,"newLineKind":"crlf"}}]}'
}

@test "detect: flat-YAML .prettierrc maps top-level scalars, nested overrides ignored" {
  cat > .prettierrc << 'EOF'
# prettier
printWidth: 90
tabWidth: 3
useTabs: true
endOfLine: "lf"
overrides:
  - files: "*.md"
    options:
      printWidth: 70
EOF
  run_config detect
  assert_success
  assert_output '{"existing":null,"sources":[{"file":".prettierrc","settings":{"lineWidth":90,"indentWidth":3,"useTabs":true,"newLineKind":"lf"}}]}'
}

@test "detect: package.json prettier key takes precedence over .prettierrc" {
  printf '{"name":"x","prettier":{"printWidth":120}}\n' > package.json
  printf '{"printWidth": 80}\n' > .prettierrc
  run_config detect
  assert_success
  assert_output '{"existing":null,"sources":[{"file":"package.json","settings":{"lineWidth":120}}]}'
}

@test "detect: package.json prettier string (shared config) -> null" {
  printf '{"prettier":"@company/prettier-config"}\n' > package.json
  run_config detect
  assert_success
  assert_output '{"existing":null,"sources":[{"file":"package.json","settings":null}]}'
}

@test "detect: package.json without prettier key falls through to .prettierrc.yaml" {
  printf '{"name":"x"}\n' > package.json
  printf 'printWidth: 110\n' > .prettierrc.yaml
  run_config detect
  assert_success
  assert_output '{"existing":null,"sources":[{"file":".prettierrc.yaml","settings":{"lineWidth":110}}]}'
}

@test "detect: .prettierrc.js -> null" {
  printf 'module.exports = { printWidth: 100 };\n' > .prettierrc.js
  run_config detect
  assert_success
  assert_output '{"existing":null,"sources":[{"file":".prettierrc.js","settings":null}]}'
}

@test "detect: malformed .prettierrc.json -> null" {
  printf '{printWidth: 100\n' > .prettierrc.json
  run_config detect
  assert_success
  assert_output '{"existing":null,"sources":[{"file":".prettierrc.json","settings":null}]}'
}

@test "detect: .prettierrc that looks like JSON but does not parse -> null, not {}" {
  local text
  for text in '{"printWidth": 120,}' '// c
{"printWidth": 120}' '{printWidth: 120}'; do
    printf '%s\n' "$text" > .prettierrc
    run_config detect
    assert_success
    assert_output '{"existing":null,"sources":[{"file":".prettierrc","settings":null}]}'
  done
}

@test "detect: sources are ordered editorconfig, gitattributes, prettier" {
  printf '{"printWidth": 80}\n' > .prettierrc
  printf '* eol=lf\n' > .gitattributes
  printf '[*]\nindent_size = 2\n' > .editorconfig
  run_config detect
  assert_success
  assert_output '{"existing":null,"sources":[{"file":".editorconfig","settings":{"indentWidth":2}},{"file":".gitattributes","settings":{"newLineKind":"lf"}},{"file":".prettierrc","settings":{"lineWidth":80}}]}'
}

@test "missing, unknown or over-long mode -> exit 2 with an error line" {
  run_config
  assert_failure 2
  assert_output --partial '{"error":"usage:'
  run_config bogus
  assert_failure 2
  assert_output --partial '{"error":"usage:'
  run_config detect extra
  assert_failure 2
  assert_output --partial '{"error":"usage:'
}

@test "write: exact file content, keys in canonical order regardless of arg order" {
  run_config write newLineKind=crlf useTabs=true lineWidth=120 indentWidth=4
  assert_success
  assert_output '{"written":".dprint.jsonc"}'
  cat > "$BATS_TEST_TMPDIR/expected.jsonc" << 'EOT'
{
  "$schema": "https://dprint.dev/schemas/v0.json",
  "lineWidth": 120,
  "indentWidth": 4,
  "useTabs": true,
  "newLineKind": "crlf",
  "plugins": []
}
EOT
  run diff -u "$BATS_TEST_TMPDIR/expected.jsonc" .dprint.jsonc
  assert_success
}

@test "write: no args -> minimal file" {
  run_config write
  assert_success
  cat > "$BATS_TEST_TMPDIR/expected.jsonc" << 'EOT'
{
  "$schema": "https://dprint.dev/schemas/v0.json",
  "plugins": []
}
EOT
  run diff -u "$BATS_TEST_TMPDIR/expected.jsonc" .dprint.jsonc
  assert_success
}

@test "write: target already exists -> exit 3, file unchanged" {
  printf 'keep\n' > .dprint.jsonc
  run_config write lineWidth=80
  assert_failure 3
  assert_output '{"existing":".dprint.jsonc"}'
  [ "$(cat .dprint.jsonc)" = "keep" ]
}

@test "write: dprint.json exists -> exit 3, no .dprint.jsonc" {
  printf '{}\n' > dprint.json
  run_config write lineWidth=80
  assert_failure 3
  assert_output '{"existing":"dprint.json"}'
  [ "$(cat dprint.json)" = "{}" ]
  [ ! -e .dprint.jsonc ]
}

@test "write: bad key, bad value or duplicate key -> exit 2, no file" {
  local args
  for args in "foo=1" "lineWidth" "=5" "lineWidth=0" "lineWidth=abc" "indentWidth=2.5" "lineWidth=99999999999999999999" "indentWidth=4294967296" "useTabs=yes" "newLineKind=cr" "lineWidth=80 lineWidth=90"; do
    # shellcheck disable=SC2086
    run_config write $args
    assert_failure 2
    assert_output --partial '{"error":"'
    [ ! -e .dprint.jsonc ]
  done
}

@test "write: newLineKind auto and system are accepted" {
  local kind
  for kind in auto system; do
    rm -f .dprint.jsonc
    run_config write newLineKind=$kind
    assert_success
    run grep -F "\"newLineKind\": \"$kind\"" .dprint.jsonc
    assert_success
  done
}

@test "PRETTIER_FILES matches PRETTIER_CONFIG_FILENAMES in src/universal-format-mcp/prettier.ts" {
  run "$MOCKBIN/node" -e '
    const fs = require("node:fs");
    const list = (file, name) => {
      const m = new RegExp(name + " = \\[([^\\]]*)\\]").exec(fs.readFileSync(file, "utf8"));
      if (!m) throw new Error(name + " not found in " + file);
      return m[1].match(/"[^"]+"/g).join(",");
    };
    const a = list(process.argv[1], "PRETTIER_FILES");
    const b = list(process.argv[2], "PRETTIER_CONFIG_FILENAMES");
    if (a !== b) {
      console.error(a + "\n" + b);
      process.exit(1);
    }
  ' "$CONFIG_SCRIPT" "$REPO_ROOT/src/universal-format-mcp/prettier.ts"
  assert_success
}

@test "detect: a dprint config in a parent directory is reported as existing" {
  printf '{}\n' > ../dprint.json
  run_config detect
  assert_success
  assert_output '{"existing":"../dprint.json","sources":[]}'
}

@test "write: a dprint config in a parent directory -> exit 3, nothing written" {
  printf '{}\n' > ../.dprint.jsonc
  run_config write
  assert_failure 3
  assert_output '{"existing":"../.dprint.jsonc"}'
  [ ! -e .dprint.jsonc ]
}

@test "detect: style sources are taken from the nearest ancestor, up to the .git boundary" {
  mkdir -p ../.git
  printf '[*]\nindent_size = 4\n' > ../.editorconfig
  run_config detect
  assert_success
  assert_output '{"existing":null,"sources":[{"file":"../.editorconfig","settings":{"indentWidth":4}}]}'
}

@test "detect: style sources above the repository root are not read" {
  local outer="$BATS_TEST_TMPDIR/outer"
  mkdir -p "$outer/repo/.git" "$outer/repo/sub"
  printf '[*]\nindent_size = 4\n' > "$outer/.editorconfig"
  cd "$outer/repo/sub"
  run_config detect
  assert_success
  assert_output '{"existing":null,"sources":[]}'
}

@test "detect: an unparseable package.json does not hide .prettierrc.json" {
  printf '{"name": "x",}\n' > package.json
  printf '{"printWidth": 100}\n' > .prettierrc.json
  run_config detect
  assert_success
  assert_output '{"existing":null,"sources":[{"file":".prettierrc.json","settings":{"lineWidth":100}}]}'
}

@test "detect: package.yaml prettier block wins over .prettierrc, nested keys ignored" {
  cat > package.yaml << 'EOF'
name: x
prettier:
  printWidth: 90
  useTabs: true
  overrides:
    - files: "*.md"
      options:
        tabWidth: 8
other: 1
EOF
  printf '{"printWidth": 70}\n' > .prettierrc
  run_config detect
  assert_success
  assert_output '{"existing":null,"sources":[{"file":"package.yaml","settings":{"lineWidth":90,"useTabs":true}}]}'
}

@test "detect: package.yaml without a prettier key falls through to .prettierrc" {
  printf 'name: x\n' > package.yaml
  printf '{"printWidth": 70}\n' > .prettierrc
  run_config detect
  assert_success
  assert_output '{"existing":null,"sources":[{"file":".prettierrc","settings":{"lineWidth":70}}]}'
}

@test "detect: package.yaml prettier shared-config string is unreadable" {
  printf 'prettier: "@acme/prettier-config"\n' > package.yaml
  run_config detect
  assert_success
  assert_output '{"existing":null,"sources":[{"file":"package.yaml","settings":null}]}'
}
