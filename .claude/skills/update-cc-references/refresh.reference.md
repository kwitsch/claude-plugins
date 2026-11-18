# refresh — script reference

**Invoke:** `node ${CLAUDE_SKILL_DIR}/refresh.mjs <subcommand> <args>`. The cwd may be anywhere inside the repo; paths resolve against `git rev-parse --show-toplevel`. stdout is exactly one JSON object; diagnostics go to stderr.

## Parameters

| # | Name | Format | Required | Notes |
| --- | --- | --- | --- | --- |
| 1 | subcommand | `plan` \| `gate` \| `finish` \| `release` | yes | anything else exits 1 |
| 2 | target (`plan`) | `skills agents hooks commands mcp plugins memory settings all` | no | empty means `all`; other values exit 1 |
| 3 | scratch (`plan`) | directory | no | default `$CLAUDE_JOB_DIR/tmp/docs` when set, else a new `update-cc-references-*` directory under the system temp dir |
| 2 | scratch (`gate`, `finish`, `release`) | directory printed by `plan` | yes | must contain `plan.json`, else exit 1 |
| 3 | name (`gate`, `finish`) | target name, the reference file basename without `.md` | yes | must be a `plan.json` target, else exit 1 |
| 4 | `--keep h1,h3` (`finish`) | comma list of `hN` ids | no | ids not in the latest `gate` snapshot are ignored; without a matching snapshot nothing is kept |

## Environment

| Var | Purpose | Required |
| --- | --- | --- |
| `CLAUDE_JOB_DIR` | default scratch root for `plan` (background job) | no |

## Exit codes

| Code | Meaning | Notes |
| --- | --- | --- |
| 0 | ok | |
| 1 | usage / invalid input | bad subcommand or target, unknown name, missing `plan.json`, malformed plugin version |
| 2 | fetch failure | stdout `{"ok":false,"error":"doc fetch failed","failed":[urls]}`; fix with an `altUrls` entry in `sources.json` |
| 3 | git failure | `git diff`, `git checkout` or `git apply -R` failed; for `apply`, the target file is restored to its pre-revert content |

## Outputs

| Subcommand | stdout | Writes |
| --- | --- | --- |
| `plan` | `{ok, scratch, date, targets:[name], workflowScript}` | `<scratch>/docs/*.md`, `<scratch>/plan.json`, `<scratch>/workflow.js` |
| `gate` | `{name, additive, changing:[hN], diffPath, autoReverted:[{versions, header}]}` | reverts unsourced-version hunks in the target file; `<scratch>/diffs/<name>.diff` (each `@@` line ends with ` hN`, `diffPath` is `null` when there are no line-changing hunks); `<scratch>/diffs/<name>.state.json` (sha256 and ids snapshot) |
| `finish` | `{name, status:"updated"\|"unchanged", kept:[hN], reverted:[hN], autoReverted:[{versions, header}], stale:boolean}` | reverts every line-changing hunk not kept; stamps the `verified` date when changes remain, otherwise restores the file from `HEAD` (`status:"unchanged"`) |
| `release` | `{changed:false}` or `{changed:true, files, previousVersion, version, bumped, date, pinUpdated}` | `plugins/cc-knowledge/.claude-plugin/plugin.json` (version bumped once per branch against `origin/main`, description suffix replaced in place); `test/cc-knowledge/test.bats` (rolling version-pin literals, only when bumped) |

`stale: true` in `finish` means the file changed after its `gate` run or no snapshot exists; all its line-changing hunks are reverted.

`workflow.js` returns `{results, commands}`. `results[i]` is `{name, changelog, verdicts, keep, lowConfidenceKept}`, or `null` when a stage threw. `commands[i]` is the `finish` command line for target `i`, with `--keep` only for CONFIRMED ids.
