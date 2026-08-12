#!/usr/bin/env bats

# output-styles/terse.md — presence, frontmatter contract, brevity.

load 'test_helper'

setup() {
  common_setup
  STYLE="$PLUGIN/output-styles/terse.md"
}

@test "output style file exists at the declared path" {
  [ -f "$STYLE" ]
}

@test "output style frontmatter has the load-bearing keys, inside the actual frontmatter block" {
  # Only lines strictly between the first and second '---' fence count as frontmatter — a
  # substring match over the first N lines can't tell a real key from the same text in body
  # prose, and the closing fence must exist or every body line would count as frontmatter.
  run awk '/^---$/{n++; next} n==1{print} END{if (n < 2) exit 1}' "$STYLE"
  assert_success
  assert_output --partial 'name: terse'
  assert_output --partial 'description: '
  assert_output --partial 'keep-coding-instructions: true'
  assert_output --partial 'force-for-plugin: true'
}

@test "output style body starts with the terse-output heading" {
  run awk '/^---$/{n++; next} n >= 2 && NF {print; exit}' "$STYLE"
  assert_output '# Terse output'
}

@test "output style stays a short directive, not a kiwi-sized contract" {
  # Deliberate cap: this style must stay a concise directive. Raising it is a design
  # decision, not a test fix.
  run bash -c "wc -l < '$STYLE'"
  assert_success
  [ "$output" -le 40 ]
}

@test "output style states each required directive" {
  for token in 'bullet' 'preamble' 'postamble' 'narrat'; do
    run grep -Fi "$token" "$STYLE"
    assert_success
  done
}
