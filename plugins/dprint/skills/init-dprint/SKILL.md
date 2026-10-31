---
name: init-dprint
description: Checks whether dprint is installed in at least the plugin's minimum version and, after confirmation via AskUserQuestion, installs it (when missing) or updates it (when too old) at user level. Then scans the project's file types and, for each type the dprint config does not cover, asks whether to add a matching dprint plugin. Use when the user wants dprint set up, installed, updated, checked, or its plugins completed for a project.
allowed-tools: ["AskUserQuestion", "Bash(node:*)"]
---

# init-dprint

Makes sure a usable dprint, at least the minimum version pinned in `check-dprint.mjs`, is
available. Detection is read-only. Installing or updating happens only after an explicit
`Install` / `Update` answer, and the command then runs visibly through the Bash tool (its normal
permission prompt is a second gate; install/update commands are deliberately not pre-allowed).
With a usable dprint it then scans the project's file types against `dprint-plugins.json` and, per
uncovered type, offers matching plugins; a plugin is added only after an explicit answer, via
`dprint config add` through the normal Bash permission prompt.

## Steps

1. **All questions go through the `AskUserQuestion` tool, never as plain text.** Never run an
   install or update command without an explicit `Install` / `Update` answer. Never run
   `config add` without an explicit answer naming that plugin.

2. Read `${CLAUDE_SKILL_DIR}/check-dprint.reference.md` (output line and exit-code contract).

3. Run the check:

   ```bash
   node ${CLAUDE_SKILL_DIR}/check-dprint.mjs
   ```

   Parse `status`, `version`, `min` and `path` from its single stdout line and branch on the exit
   code, per the table in `check-dprint.reference.md`:
   - `0` (ok): report `dprint <version> at <path> (>= <min>)` and go to step 7. Ask nothing about
     installing.
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
     stop (no plugin scan without a usable dprint).

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

     Then go to step 7.

   - Non-zero exit: report the state and stop. If it is still `outdated` after the upgrade,
     dprint is likely managed by a package manager (npm, Homebrew, ...) that refused the
     self-upgrade: tell the user to update it through that package manager. Never force a
     reinstall that would shadow the managed copy.

7. **Plugin coverage.** Only reached with exit `0` from step 3 or step 6. `<path>` is the dprint
   path from that check.
   1. Read `${CLAUDE_SKILL_DIR}/scan-plugins.reference.md` (output lines and exit-code contract).
   2. From the project root, run the scan and report every stderr line:

      ```bash
      node ${CLAUDE_SKILL_DIR}/scan-plugins.mjs
      ```

      Parse `status`, `config` and `missing` from the first stdout line and `type`, `files` and
      `candidates` from each following line, then branch on the exit code:
      - `0` (ok): report "`<config>` covers every detected file type" and go to step 8.
      - `11` (noconfig): report "no dprint config (dprint.json, dprint.jsonc, .dprint.json,
        .dprint.jsonc, .config/dprint.json, .config/dprint.jsonc) in the project root or an ancestor up to the git root; plugin scan
        skipped, create one with `dprint init`"
        and go to step 8.
      - `2` (error): report the stderr diagnostic and go to step 8.
      - `10` (missing): continue with step 7.3.

   3. Take the first `type=` line whose type has not been asked about in this run. If there is
      none, go to step 8. Ask exactly one `AskUserQuestion`, single-select
      (`multiSelect: false`), no pre-selected option:
      - header: the type (for example `.ts`, `Dockerfile`), cut to 12 characters
      - question with one candidate:
        `No plugin in <config> formats <type> files (<files> found). Add the dprint plugin <candidate>?`
      - question with several candidates:
        `No plugin in <config> formats <type> files (<files> found). Which dprint plugin should format them?`
        With more than 3 candidates, append
        `Other candidates (type the exact name via Other): <4th>, <5th>, ...`
      - options: the first 3 candidates in output order, each labelled with the candidate name and
        described as "Runs `<path> config add <candidate>`"; then `Skip`, described as "Add nothing
        for `<type>`."
      - The chosen plugin is the selected candidate label, or an "Other" answer that exactly
        equals one of this line's candidates: go to step 7.4.
      - `Skip`, or any other answer: record `<type>` as skipped and go to step 7.5.
   4. Add the chosen plugin via the Bash tool, one command, visibly:

      ```text
      <path> config add <candidate>
      ```

      Non-zero exit (or the permission prompt is denied): report the command's error output, ask
      nothing further and go to step 8. No retry.

   5. Re-run `node ${CLAUDE_SKILL_DIR}/scan-plugins.mjs` (an added plugin may cover further types)
      and branch as in step 7.2, except that exit `10` goes back to step 7.3.

8. Final output, as a terse bullet list:
   - state before (`status`, `version`, `path`)
   - action taken (command run, or "skipped")
   - state after (`status`, `version`, `path`, plus the `export PATH` line when needed)
   - plugin scan: config file, plugins added (each `config add` command run), types skipped,
     types still uncovered. If the scan did not run, say why.
