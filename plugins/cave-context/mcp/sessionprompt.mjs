// sessionprompt.mjs — static SessionStart prompt (caveman:compress).
import { rulesetText } from "./caveman.mjs";

export function sessionStartPrompt() {
  return [
    rulesetText(),
    "",
    "## Context routing",
    "Every tool byte enters context. Think-in-code: program the analysis in the sandbox, surface only the answer.",
    "",
    "| native (intent) | use instead | keep native when |",
    "|---|---|---|",
    "| Bash — process output | ctx_batch_execute / ctx_execute | observe short fixed output; mutate state (git/mkdir/rm/mv) |",
    "| Read — analyze | ctx_execute_file | you'll Edit it (Edit needs exact bytes) |",
    "| Grep — filter/aggregate | ctx_execute | small / observe-only |",
    "| WebFetch | ctx_fetch_and_index | — (hard-denied; use ctx_fetch_and_index) |",
    "| recall prior work / search indexed | ctx_search | — |",
    "",
    "File writes → native Write/Edit, never ctx_* (sandbox FS discarded).",
  ].join("\n");
}
