---
name: dprint
description: Runs dprint for the project. The first argument selects the action - init checks for the plugin's minimum dprint version, installs or updates dprint at user level after confirmation via AskUserQuestion, offers to create a dprint config when none exists and to add dprint plugins for file types the config does not cover; check [scope] runs dprint check; fmt [scope] runs dprint fmt and rewrites files; without an argument it runs fmt on the whole current directory. Use init when the user wants dprint set up, installed, updated, checked or its plugins completed; check when they want formatting verified with dprint; fmt only when they ask to format files with dprint. When invoking this skill yourself, always pass init, check or fmt as the first argument.
argument-hint: "[init|check|fmt] [scope]"
allowed-tools: ["AskUserQuestion", "Bash(node:*)"]
---

# dprint

Runs one of three actions, selected by the first argument:

- `init`: makes sure a usable dprint is installed, a dprint config exists and the config's plugins
  cover the project's file types.
- `check [scope]`: runs `dprint check` (read-only).
- `fmt [scope]`: runs `dprint fmt`, which rewrites files in place.

Without any argument the skill runs `fmt` on the whole current working directory. `scope` limits
`check` / `fmt` to one file, directory or glob; without it dprint runs on the current directory.
dprint may treat an explicit scope as overriding the config's `includes` (the `excludes` still
apply), so `fmt` with a scope can rewrite files the config leaves out.
`check` and `fmt` need dprint and a project dprint config (in the current directory or an
ancestor up to the git root); when either is missing they run nothing and tell the user to run `/dprint init`
(`/dprint:dprint init`) first.

`init` makes sure a usable dprint, at least the minimum version pinned in `check-dprint.mjs`, is
available. Detection is read-only. Installing or updating happens only after an explicit
`Install` / `Update` answer, and the command then runs visibly through the Bash tool (its normal
permission prompt is a second gate; install/update commands are deliberately not pre-allowed).
With a usable dprint it then scans the project's file types against `dprint-plugins.json` and, per
uncovered type, offers matching plugins; a plugin is added only after an explicit answer, via
`dprint config add` through the normal Bash permission prompt. When the current directory has no
dprint config, `init` offers to create one via `dprint init -y`, only after an explicit `Create`
answer.

## Dispatch

Arguments: "$ARGUMENTS"

1. Split the arguments above (empty when none were given):
   - action: the first whitespace-separated word (case-sensitive).
   - scope: everything after that word, trimmed. If the whole scope is enclosed in one matching
     pair of `'` or `"`, remove that pair. Alter nothing else: spaces inside stay, and the scope is
     passed to dprint as one argument.
2. Branch:
   - No arguments at all: action `fmt` without scope; go to `## check / fmt`.
   - `check` or `fmt`: go to `## check / fmt` with that scope (empty scope = no scope).
   - `init` with an empty scope: go to `## init`, steps 1-8.
   - `init` with a non-empty scope, or any other first word: print this line and stop, running
     nothing:

     ```text
     usage: /dprint [init|check|fmt] [scope]  (no argument = fmt on the whole current directory)
     ```

## check / fmt

1. Read `${CLAUDE_SKILL_DIR}/run-dprint.reference.md` (output and exit-code contract).
2. From the current working directory, run exactly one Bash command. Without a scope:

   ```text
   node ${CLAUDE_SKILL_DIR}/run-dprint.mjs <check|fmt>
   ```

   With a scope, single-quote it so the shell passes it unchanged and expands no globs; write each
   `'` inside the scope as `'\''`:

   ```text
   node ${CLAUDE_SKILL_DIR}/run-dprint.mjs <check|fmt> '<scope>'
   ```

3. Branch on the exit code. No retry in any case:
   - `3` (not set up): tell the user that dprint must first be initialized with `/dprint init`
     (`/dprint:dprint init`) and name the reason from the `status=notsetup reason=` line
     (`missing` = no dprint found, `noconfig` = no dprint config in this directory or its
     ancestors up to the git root). Run nothing else and never start init on your own.
   - `0`: report success; for `fmt`, quote dprint's summary line if it printed one.
   - `20` (`check`): list the unformatted files from the output and mention `/dprint fmt` with the
     same scope.
   - `14`: report that no files matched the scope.
   - `2`: report the stderr diagnostic.
   - Any other code: report dprint's error output and the exit code.

## init

1. **All questions go through the `AskUserQuestion` tool, never as plain text.** Never run an
   install or update command without an explicit `Install` / `Update` answer. Never run
   `config add` without an explicit answer naming that plugin. Never run `<path> init -y` without
   an explicit `Create` answer.

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
      - `11` (noconfig): if the create question was not yet asked in this run, ask exactly one
        `AskUserQuestion`, single-select (`multiSelect: false`), no pre-selected option:
        - header: `dprint config`
        - question:
          `No dprint config (dprint.json, dprint.jsonc, .dprint.json, .dprint.jsonc, .config/dprint.json, .config/dprint.jsonc) in the current directory or an ancestor up to the git root. Create dprint.json here with plugins for the file types found?`
        - options: `Create`, described as "Runs `<path> init -y`"; `Skip`, described as "Create
          no config; the plugin scan, check and fmt need one."
        - `Create`: run it via the Bash tool, one command, visibly (its normal permission prompt
          applies):

          ```text
          <path> init -y
          ```

          Non-zero exit (or the permission prompt is denied): report the command's error output
          and go to step 8. Success: go to step 7.5.
        - `Skip`, any other answer, or the question was already asked in this run: report "no
          dprint config; plugin scan skipped" and go to step 8.
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
   - plugin scan: config file (and the `<path> init -y` command run when step 7.2 created it),
     plugins added (each `config add` command run), types skipped, types still uncovered. If the
     scan did not run, say why.
