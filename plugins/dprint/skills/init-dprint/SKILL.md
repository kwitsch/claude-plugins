---
name: init-dprint
description: Checks whether dprint is installed in at least the plugin's minimum version and, after confirmation via AskUserQuestion, installs it (when missing) or updates it (when too old) at user level. Use when the user wants dprint set up, installed, updated, or checked.
allowed-tools: ["AskUserQuestion", "Bash(node:*)"]
---

# init-dprint

Makes sure a usable dprint, at least the minimum version pinned in `check-dprint.mjs`, is
available. Detection is read-only. Installing or updating happens only after an explicit
`Install` / `Update` answer, and the command then runs visibly through the Bash tool (its normal
permission prompt is a second gate; install/update commands are deliberately not pre-allowed).

## Steps

1. **All questions go through the `AskUserQuestion` tool, never as plain text.** Never run an
   install or update command without an explicit `Install` / `Update` answer.

2. Read `${CLAUDE_SKILL_DIR}/check-dprint.reference.md` (output line and exit-code contract).

3. Run the check:

   ```bash
   node ${CLAUDE_SKILL_DIR}/check-dprint.mjs
   ```

   Parse `status`, `version`, `min` and `path` from its single stdout line and branch on the exit
   code, per the table in `check-dprint.reference.md`:
   - `0` (ok): report `dprint <version> at <path> (>= <min>)` and stop. Ask nothing.
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
   - `Skip`, or any answer other than `Install` / `Update`: report "skipped, nothing changed" and
     stop.

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
   node ${CLAUDE_SKILL_DIR}/check-dprint.mjs
   ```

   - Exit `0`: report the new version and path. If `path` is `<home>/.dprint/bin/dprint`, also
     check whether that directory is on `PATH` with `node -e "console.log(process.env.PATH)"`. If
     it is not, print this line for the user to add to their shell profile (never edit shell rc
     files yourself):

     ```bash
     export PATH="$HOME/.dprint/bin:$PATH"
     ```

   - Non-zero exit: report the state and stop. If it is still `outdated` after the upgrade,
     dprint is likely managed by a package manager (npm, Homebrew, ...) that refused the
     self-upgrade: tell the user to update it through that package manager. Never force a
     reinstall that would shadow the managed copy.

7. Final output, as a terse bullet list:
   - state before (`status`, `version`, `path`)
   - action taken (command run, or "skipped")
   - state after (`status`, `version`, `path`, plus the `export PATH` line when needed)
