# CLAUDE.md — test/coding-toolbox

## Tests

- **Run:** `BATS_LIB_PATH="$PWD/node_modules" pnpm exec bats test/coding-toolbox/`
- CI runs the same directory-level invocation (`.github/workflows/test.yml` targets `test/${{ matrix.plugin }}/`, not a filename), so adding a `.bats` file needs no CI change.

### Layout

- One `.bats` file per thematic group — one hook or skill each; a skill's bundled scripts and agents are covered by that skill's own file, not split further.
  - Why: the suite was split from one monolithic file once it outgrew ~2200 lines; `.claude/rules/test-conventions.md` ("Splitting a large suite") points here for this rationale.
- Content owned by no single skill/hook (plugin.json/marketplace/root-README/`test.yml`-matrix invariants, generic README structure) lives in `manifest.bats`.
- Put a new assertion in the file of the skill/hook it concerns, not at the end of the suite — thematic coherence over append order.

### Helpers

- `test_helper.bash` holds only helpers shared by 2+ groups: `common_setup` (isolated `$MOCKBIN`/`$HOME`, `$PLUGIN`/`$HOOKS`/`$SCRIPTS`), `rg_or_grep`, `make_stub`.
- Keep a helper used by only one group local to that group's file — do not hoist it "for consistency".
- Start every `.bats` file with `load 'test_helper'` and its own `setup() { common_setup; }` (bats has no cross-file `setup()`).
- `common_setup` builds an isolated `PATH` that symlinks only the listed real tools (`git`, `sed`, `awk`, `jq`, …).
  - Add a deterministic, non-networked tool to that loop when a script under test needs it, rather than a suite-local workaround.

## Exit codes

- Contract-test each script's own documented exit codes (its colocated `.reference.md`, or header comment for `bin/ci-watch.sh`); there is no plugin-wide scheme.
