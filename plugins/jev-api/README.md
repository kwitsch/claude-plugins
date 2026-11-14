# jev-api

Gives Claude three tools that ask TypeSafe's **Jev System One** API one question each about a piece of text: `noul` (yes/no probability), `choice` (pick among named options) and `score` (rate along ordered levels). A fourth tool, `batch`, asks several of these questions about one text in a single request. The tools take text only and use the same endpoint and auth conventions as the Typesafe JS SDK.

## Environment

| Variable                 | Required | Meaning                                                                                                                          |
| ------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `TYPESAFE_API_KEY`       | no       | Bearer token for the TypeSafe API; sent as `Authorization: Bearer ...` only to an https endpoint.                                |
| `TYPESAFE_BASE_URL`      | no       | API root without query or fragment, default `https://api.typesafe.ai`; `/v1/systemone` is appended and trailing slashes dropped. |
| `JEV_URL`                | no       | The full System One route; wins over `TYPESAFE_BASE_URL`. A jev-api variable, not an SDK one.                                    |
| `TYPESAFE_DEFAULT_MODEL` | no       | Model sent with each request, default `jev-latest`.                                                                              |

The four tools are always registered. While none of `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL` or `JEV_URL` is non-blank, Claude Haiku (`claude-haiku-5-5`, through the session's own login) answers instead of Jev: it is asked for JSON in the System One response format, and a reply that does not fit the question (wrong type, option, level or probability range) is an error starting with `<tool>: fallback`, never a made-up answer. A configured Jev that fails is an error, with no Haiku fallback. The variables are read from Claude Code's own environment on every call, so set them before Claude Code starts (in the shell or in the settings' `env`): a variable exported in another shell later does not reach it. With only `TYPESAFE_API_KEY` set, the default endpoint `https://api.typesafe.ai/v1/systemone` is used.

## Options

| Option     | Default | Meaning                                                                                                     |
| ---------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `timeout`  | `20`    | HTTP timeout of one System One request in seconds, for tool calls that give no valid `timeout` of their own |
| `overflow` | `haiku` | What a call does when its state and questions are too large for System One: `error`, `truncate` or `haiku`  |

The timeout of a call is its `timeout` input when that is a number above 0; otherwise the `timeout` option when that is a number above 0; otherwise 20 seconds. Claude Code ends one request after 30 seconds on its own, so a longer timeout counts as 30.

The overflow mode of a call is its `overflow` input (`error`, `truncate` or `haiku`; anything else is an input error); otherwise the `overflow` option when it is one of the three; otherwise `haiku`.

## Large states

System One takes at most 32767 prompt tokens (the state plus the questions), and its latency grows with the prompt: about 3 s at 4k tokens, 15 s at 16k, 35 s at 28k. Characters per token vary from 1 (emoji, `€`) over 3.3 to 4.8 (code, prose) to 8 (repetitive text), so the plugin works with an estimate and the server's own counts:

- Before sending, a call is refused (or handled by its overflow mode) when even an optimistic estimate (twice the learned characters per token, at least 6 and at most 8) exceeds what the server and the timeout allow: about 4k tokens at 4 s, 15.6k at 20 s, 21k at 30 s. The time budget never drops below 1000 tokens: a prompt that small is always sent, even with a very short timeout (the call then just times out); a larger one is still refused or handled by its overflow mode.
- When the server refuses a prompt (HTTP 400, `exceed_context_size_error`), its exact token count is used: the plugin learns the real characters per token and, per overflow mode, reacts.
- The characters per token are learned from every answer (`usage.input_tokens`) and refusal, smoothed, and kept between sessions in the plugin's own store (`$.store`, shared by every session on the machine); a failing store only loses the statistic.

Overflow modes, for a prompt that does not fit:

| Mode       | What happens                                                                                                                                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `error`    | The call fails with the numbers and a state size to aim for, for example `state too large for System One: the request has 40025 tokens, the limit is 32767; shorten the state to about 52700 characters` (at the 30 s timeout: the size to aim for also fits what the timeout allows). Nothing is sent when the estimate already shows it. |
| `truncate` | The middle of the state is cut (60 % head, 40 % tail, a `[... N characters omitted ...]` marker between) to fit, and the request is sent; after a server refusal it is retried once with the exact cut. The answer does not say that the state was cut.                                                                                    |
| `haiku`    | Claude Haiku answers (the fallback described above, calibrated differently from Jev); a state over 150000 characters is cut the same way first.                                                                                                                                                                                            |

Without a configured Jev there is no preflight and no store access: Haiku answers as before, with a state over 150000 characters cut the same way first.

## Tools

Each tool is registered at session start and called by its full name, `mcp__jev-api__<type>`. `instructions` and `state` are text; `criteria` is an object or an array depending on the type; `batch` takes its questions as a required array of objects; the optional `timeout` is a number of seconds; the optional `overflow` is `error`, `truncate` or `haiku` (see Large states).

The plugin answers these calls itself, before Claude Code's permission check: there is no permission prompt, `ask` rules and PreToolUse hooks do not apply, and the text goes to the configured endpoint as soon as Claude calls a tool. A `permissions.deny` rule for `mcp__jev-api` (or `mcp__jev-api__<type>`) removes the tools (`--disallowedTools mcp__jev-api__batch` removes only `batch`).

### `mcp__jev-api__noul`

| Input          | Values                                       | Meaning                                              |
| -------------- | -------------------------------------------- | ---------------------------------------------------- |
| `instructions` | string, required                             | The yes/no question                                  |
| `state`        | string, required                             | The text the question is about                       |
| `timeout`      | number, optional                             | HTTP timeout of the request in seconds (see Options) |
| `criteria`     | object with optional strings `true`, `false` | What counts as true and as false                     |

Result: `{"type":"noul", ...}` with the answer's probability (0..1).

### `mcp__jev-api__choice`

| Input          | Values                                   | Meaning                                              |
| -------------- | ---------------------------------------- | ---------------------------------------------------- |
| `instructions` | string, required                         | What to choose                                       |
| `state`        | string, required                         | The text the question is about                       |
| `timeout`      | number, optional                         | HTTP timeout of the request in seconds (see Options) |
| `criteria`     | object, 1 to 255 string values, required | Option name -> description                           |

Result: `{"type":"choice","choice":<option>,"confidence":<0..1>,"probabilities":{<option>:<0..1>}}`.

### `mcp__jev-api__score`

| Input          | Values                             | Meaning                                              |
| -------------- | ---------------------------------- | ---------------------------------------------------- |
| `instructions` | string, required                   | What to rate                                         |
| `state`        | string, required                   | The text the question is about                       |
| `timeout`      | number, optional                   | HTTP timeout of the request in seconds (see Options) |
| `criteria`     | array of 2 to 10 strings, required | The levels, lowest first; scores start at 0          |

Result: `{"type":"score","score":<expected level>,"confidence":<0..1>,"legend":{"0":<level>,...},"probabilities":{"0":<0..1>,...}}`. The score is the probability-weighted level: 0 is the first level, and a value between two levels is fractional. `legend` and `probabilities` are keyed by level index.

### `mcp__jev-api__batch`

| Input       | Values                                   | Meaning                                                                                                                              |
| ----------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `state`     | string, required                         | The text all questions are about                                                                                                     |
| `timeout`   | number, optional                         | HTTP timeout of the request in seconds (see Options)                                                                                 |
| `questions` | array of at least one question, required | Each is `{ "type": "noul" \| "choice" \| "score", "instructions", "criteria" }` with that tool's `instructions` and `criteria` rules |

All questions go out in one System One request. Result: a JSON array of the answers in question order, each exactly as the matching single tool returns it. The call is all or nothing: an invalid question (the error names it, `questions[<index>]: ...`), an HTTP error or a missing answer fails the whole call.

## Where the text goes

The `state`, instructions and options of every call go to the configured endpoint (or to Haiku without one). A project's `.claude/settings.json` `env` overrides yours: a repository that sets `JEV_URL` or `TYPESAFE_BASE_URL` receives your `TYPESAFE_API_KEY` (over https only) and that text. The reason an endpoint gives for an HTTP error, and every fetch error text, reach the model with a configured `JEV_URL` / `TYPESAFE_BASE_URL`, its host and a key of 6 or more characters replaced (the default endpoint is not hidden); the endpoint's reason is also cut after 1000 characters.

## Errors

Errors come back as a tool error (Claude reads it as an error result) whose text starts with the tool's name and a colon (for example `noul:` or `batch:`).

- No configuration (none of the three variables set): Haiku answers, calibrated toward Jev (its `noul` probability is stretched away from 0.5, a `score` is the mean level index of its probabilities, and its prompt asks for honest, uninflated estimates); the numbers remain estimates of a language model, not Jev's; `<tool>: fallback: <reason>` when it does not answer or its reply is invalid.
- Invalid input, or a `JEV_URL` / `TYPESAFE_BASE_URL` that is not an `http(s)` URL (for `TYPESAFE_BASE_URL` also one with a query or fragment): no request is sent.
- A state too large for System One or for the timeout, with `overflow` `error` (or after a second refusal in `truncate`): `state too large ...` with the numbers (see Large states).
- HTTP 4xx/5xx: `HTTP <status>` plus the API's reason (its `detail`, or its `error.message`) when there is one.
- No answer of the asked type in the response, a network error or an unparsable body: the reason. Where Claude Code's error quotes the endpoint, the text shows `<JEV_URL>` or `<TYPESAFE_BASE_URL>/v1/systemone` instead of the configured URL.
- A request taking longer than its timeout (default 20 seconds): `timeout after <ms>ms`, or Claude Code's own limit on one request (`... aborted: no complete answer within 30000ms`) when that comes first.
- A call that is interrupted while it waits answers at once; the request itself still runs to its end (in `claude -p` and other headless runs the process, and the next prompt, may wait for it, up to Claude Code's own 30 seconds per request).
