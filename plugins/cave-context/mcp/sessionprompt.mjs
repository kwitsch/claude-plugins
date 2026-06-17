// sessionprompt.mjs — static SessionStart prompt (caveman:compress).
import { rulesetText } from "./caveman.mjs";

export function sessionStartPrompt() {
  return [
    rulesetText(),
    "",
    "Context routing: big output → cave-context ctx_* tools (ctx_batch_execute gather, ctx_search recall, ctx_execute/_file process); raw bytes stay sandboxed, out of context. Write files via native Write/Edit, not ctx_*.",
    "Coexistence: cave-context replaces caveman AND context-mode — uninstall both if installed (running alongside re-creates the hook competition this fixes).",
  ].join("\n");
}
