# cck shared workflow (create / validate / adjust)

Applies to every `/cck-*` skill. The authoritative current rules ALWAYS come
from the `cc-knowledge` agent (which reads the live docs) — the per-component
reference is only a thin index and scaffold, never the source of truth.

Resolve `CACHE_DIR` first: prefer the path announced in the SessionStart context
("Live-docs cache at …"). If absent, compute it from the fallback shown in the
skill. Pass `CACHE_DIR` into every `cc-knowledge` dispatch.

## Mode: create

1. Dispatch `cc-knowledge` (Agent tool, subagent_type
   `claude-code-knowledge:cc-knowledge`): "List the CURRENT required and optional
   frontmatter keys and structure for a <component> from the official docs; cite
   the doc. CACHE_DIR=<dir>."
2. Scaffold the new file from the returned rules + the component reference
   skeleton. Ask the user only for genuinely missing specifics (name, purpose).
3. Run the validate mode on the result before finishing.

## Mode: validate <path>

1. Read the target file.
2. Dispatch `cc-knowledge` for the CURRENT rules of a <component> (as above).
3. Check the target against the returned rules: unknown/misspelled frontmatter
   keys, missing required keys, deprecated fields, known gotchas. Report
   `PASS` or `FAIL` with a concrete, doc-cited fix for each issue.
4. If the docs are unreachable, run structural-only checks (file present,
   frontmatter parses, required-by-skeleton keys present) and clearly warn that
   the check was offline and is not authoritative.

## Mode: adjust <path>

1. Run validate.
2. Apply each fix (edit the file), preserving author intent and content.
3. Re-run validate; report the before/after status.
