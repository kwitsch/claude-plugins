// sessionprompt.mjs — static SessionStart prompt (caveman:compress).
import { rulesetText } from "./caveman.mjs";

export function sessionStartPrompt() {
  return [
    rulesetText(),
    "",
    "## Context routing",
    "Big output? Route through cave-context ctx_* tools (ctx_batch_execute gather, ctx_search recall, ctx_execute/ctx_execute_file process). Raw bytes stay in sandbox, out of context. Write files with native Write/Edit, not ctx_*.",
    "",
    "## Coexistence",
    "cave-context replaces caveman AND context-mode. If either still installed: uninstall caveman and context-mode — running them alongside re-creates the hook competition cave-context fixes.",
  ].join("\n");
}
