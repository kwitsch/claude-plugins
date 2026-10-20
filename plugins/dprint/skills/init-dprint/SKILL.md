---
name: init-dprint
description: Checks whether dprint is installed in at least the plugin's minimum version and, after confirmation via AskUserQuestion, installs it (when missing) or updates it (when too old) at user level, then offers to create a starter .dprint.jsonc from the project's existing style configs. Use when the user wants dprint set up, installed, updated, or checked, or a dprint config created.
allowed-tools: ["AskUserQuestion", "Bash(node:*)"]
---

# init-dprint

Makes sure a usable dprint, at least the minimum version pinned in `scripts/check-dprint.mjs`, is
available, then offers a starter `.dprint.jsonc`. Detection is read-only. Installing or updating
happens only after an explicit `Install` / `Update` answer, and the command then runs visibly
through the Bash tool (its normal permission prompt is a second gate; install/update commands are
deliberately not pre-allowed). The config file is written only after an explicit `Create` answer,
by `scripts/dprint-config.mjs`, which never overwrites or duplicates an existing dprint config.

## Steps

1. **All questions go through the `AskUserQuestion` tool, never as plain text.** Never run an
   install or update command without an explicit `Install` / `Update` answer. Never write a config
   without an explicit `Create` answer.

2. Read `${CLAUDE_SKILL_DIR}/scripts/check-dprint.reference.md` (output line and exit-code contract).

3. Run the check:

   ```bash
   node ${CLAUDE_SKILL_DIR}/scripts/check-dprint.mjs
   ```

   Parse `status`, `version`, `min` and `path` from its single stdout line and branch on the exit
   code, per the table in `check-dprint.reference.md`:
   - `0` (ok): report `dprint <version> at <path> (>= <min>)` and go to step 7. Ask nothing about
     dprint.
   - `2` (error): report the stderr diagnostic and stop. Never guess, never install.
   - `10` (missing) or `11` (outdated): go to step 4.

4. Ask exactly one `AskUserQuestion`, single-select (`multiSelect: false`), no pre-selected option:
   - **missing** (exit 10):
     - header: `dprint [currently: not installed]`
     - question: `Install dprint (minimum <min>) to ~/.dprint/bin via the official installer?`
     - options: `Install`, described as "Runs curl -fsSL https://dprint.dev/install.sh | sh";
       `Skip`, described as "Install nothing."
   - **outdated** (exit 11):
     - header: `dprint [currently: <version>, needs >= <min>]`
     - question: `Update dprint at <path>?`
     - options: `Update`, described as the exact update command chosen in step 5 (for example
       "Runs <path> upgrade"); `Skip`, described as "Change nothing."
   - `Skip`, or any answer other than `Install` / `Update`: report "dprint: skipped, nothing
     changed" and go to step 7.

5. Apply only after `Install` / `Update`, via the Bash tool, one command, visibly:
   - **Install:**

     ```bash
     curl -fsSL https://dprint.dev/install.sh | sh
     ```

   - **Update** (every outdated version has the `upgrade` subcommand, since the minimum is far
     above 0.30.0):

     ```text
     <path> upgrade
     ```

   - Non-zero exit (or the permission prompt is denied): report the command's error output and
     stop. No retry, no fallback to another install method.

6. Re-run the check:

   ```bash
   node ${CLAUDE_SKILL_DIR}/scripts/check-dprint.mjs
   ```

   - Exit `0`: report the new version and path. If `path` is `<home>/.dprint/bin/dprint`, also
     check whether that directory is on `PATH` with `node -e "console.log(process.env.PATH)"`. If
     it is not, print this line for the user to add to their shell profile (never edit shell rc
     files yourself):

     ```bash
     export PATH="$HOME/.dprint/bin:$PATH"
     ```

     Then go to step 7.

   - Non-zero exit: report the state and stop. If it is still `outdated` after the upgrade,
     dprint is likely managed by a package manager (npm, Homebrew, ...) that refused the
     self-upgrade: tell the user to update it through that package manager. Never force a
     reinstall that would shadow the managed copy.

7. Read `${CLAUDE_SKILL_DIR}/scripts/dprint-config.reference.md` (output shapes and exit codes of
   both modes; this one read covers steps 8 and 10).

8. Detect:

   ```bash
   node ${CLAUDE_SKILL_DIR}/scripts/dprint-config.mjs detect
   ```

   Parse `existing` and `sources` from its single stdout JSON line, per
   `dprint-config.reference.md`:
   - Exit `2`: report the error as the config result and go to step 11.
   - `existing` non-null: report "config: <existing> already present", write nothing, go to
     step 11.
   - Otherwise ask exactly one `AskUserQuestion`, single-select (`multiSelect: false`), no
     pre-selected option:
     - header: `dprint config [currently: none]`
     - question: `Create .dprint.jsonc in the working directory?`
     - options: `Create`, described as "Writes .dprint.jsonc; never overwrites"; `Skip`,
       described as "Write nothing."
   - Any answer other than `Create`: write nothing, go to step 11.

9. Wizard. A readable source is a `sources` entry whose `settings` is a non-empty object (`null` =
   unreadable format, `{}` = nothing maps; both are only reported in step 11, never asked about).
   - No readable source: go to step 10 with no settings.
   - Adopt round: one `AskUserQuestion` call with one single-select question
     (`multiSelect: false`, no pre-selected option) per readable source (at most 3):
     - header: `<file> [currently: <k=v, ...>]` (its settings, for example
       `.editorconfig [currently: lineWidth=200, indentWidth=2]`)
     - question: `Adopt the settings of <file> into .dprint.jsonc?`
     - options: `Adopt`, described as "Copies <k=v list> into .dprint.jsonc"; `Skip`, described
       as "Ignore this file."
     - Any answer other than `Adopt` counts as `Skip`.
   - Merge the adopted sources key by key: a key set by only one adopted source, or set to the
     same value by every adopted source that sets it, is taken directly.
   - Conflict round: if adopted sources disagree on any key, one more `AskUserQuestion` call with
     one single-select question (`multiSelect: false`, no pre-selected option) per conflicting
     key (at most 4):
     - header: `<key> [currently: conflict]`
     - question: `Which <key> should .dprint.jsonc use?`
     - options: one `<file>: <value>` option per adopted source that sets the key, described as
       "From <file>"; plus `Skip`, described as "Leave dprint default."
     - The chosen option's value is taken; any other answer omits the key.

10. Write, passing each resulting key as one `key=value` argument (no arguments is valid and
    writes the minimal file):

    ```bash
    node ${CLAUDE_SKILL_DIR}/scripts/dprint-config.mjs write <key=value ...>
    ```

    - Exit `0`: config created with the written keys.
    - Exit `3`: report "config: <existing> already present, nothing written".
    - Exit `2`: report the `error` message; nothing written.

11. Final output, as a terse bullet list:
    - dprint state before (`status`, `version`, `path`)
    - dprint action taken (command run, or "skipped")
    - dprint state after (`status`, `version`, `path`, plus the `export PATH` line when needed)
    - `config`: present (`<path>`), created (`.dprint.jsonc` with the keys written), skipped, or
      error (message); plus any sources found but not adopted, or unreadable (`settings: null`)
    - only when the file was created: "No formatter plugins yet. Add some with
      `dprint add <plugin>` (for example `dprint add typescript json markdown`)", and a note
      that the values were copied once and do not follow later changes to the source files
