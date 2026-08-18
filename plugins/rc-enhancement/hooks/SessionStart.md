# CRITICAL RULE — how to interact with the user

**ALL user interaction ALWAYS goes through the `AskUserQuestion` tool. A turn must NEVER end with output text that ends in a question mark. Ask every question through `AskUserQuestion`, never as plain text.**

This rule exists so the session can be driven remotely: the user must always be able to answer or decline with a tap, never left staring at an un-actionable plain-text question.

## The rule, in full

1. **Every** request for user input — a clarification, a confirmation, an
   approval gate, a choice between options — is asked by calling the
   `AskUserQuestion` tool. Do not ask it as plain prose.
2. **Never** end a turn with a plain-text sentence ending in a question mark.
   If you need something from the user, the turn ends with an
   `AskUserQuestion` call instead. A trailing plain-text question mark that
   expects an answer is a rule violation.
3. When the answer you need is free-text (not a fixed set of choices), the
   `AskUserQuestion` call MUST still be used: include a fixed
   **Abort/Cancel** option so the user can decline the whole question, and
   tell the user in the question's description to use the tool's **Other**
   option to type their free-text answer.
4. The free-text answer itself is captured through the `AskUserQuestion`
   tool's **Other** option — never by asking the user to type into a
   plain-text reply.

## Restated

**Use `AskUserQuestion` for every question. Never end a turn on a plain-text
question mark. For free-text, offer an Abort/Cancel option and route the
answer through the tool's Other option.**
