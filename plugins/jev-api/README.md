# jev-api

Gives Claude three tools that ask TypeSafe's **Jev System One** API one question each about a piece of text: `noul` (yes/no probability), `choice` (pick among named options) and `score` (rate along ordered levels). The tools take text only and use the same endpoint and auth conventions as the Typesafe JS SDK.

## Environment

| Variable                 | Required | Meaning                                                                                                                          |
| ------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `TYPESAFE_API_KEY`       | no       | Bearer token for the TypeSafe API; sent as `Authorization: Bearer ...` only to an https endpoint.                                |
| `TYPESAFE_BASE_URL`      | no       | API root without query or fragment, default `https://api.typesafe.ai`; `/v1/systemone` is appended and trailing slashes dropped. |
| `JEV_URL`                | no       | The full System One route; wins over `TYPESAFE_BASE_URL`. A jevfort convention, not an SDK variable.                             |
| `TYPESAFE_DEFAULT_MODEL` | no       | Model sent with each request, default `jev-latest`.                                                                              |

The three tools are always registered. A call fails locally, without any request, until at least one of `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL` or `JEV_URL` is non-blank. The variables are read from Claude Code's own environment on every call, so set them before Claude Code starts (in the shell or in the settings' `env`): a variable exported in another shell later does not reach it. With only `TYPESAFE_API_KEY` set, the default endpoint `https://api.typesafe.ai/v1/systemone` is used.

## Tools

Each tool is registered at session start and called by its full name, `mcp__jev-api__<type>`. Every input is text.

The plugin answers these calls itself, before Claude Code's permission check: there is no permission prompt, `ask` rules and PreToolUse hooks do not apply, and the text goes to the configured endpoint as soon as Claude calls a tool. A `permissions.deny` rule for `mcp__jev-api` (or `mcp__jev-api__<type>`) removes the tools.

### `mcp__jev-api__noul`

| Input          | Values                                       | Meaning                          |
| -------------- | -------------------------------------------- | -------------------------------- |
| `instructions` | string, required                             | The yes/no question              |
| `state`        | string, required                             | The text the question is about   |
| `criteria`     | object with optional strings `true`, `false` | What counts as true and as false |

Result: `{"type":"noul", ...}` with the answer's probability (0..1).

### `mcp__jev-api__choice`

| Input          | Values                                   | Meaning                        |
| -------------- | ---------------------------------------- | ------------------------------ |
| `instructions` | string, required                         | What to choose                 |
| `state`        | string, required                         | The text the question is about |
| `criteria`     | object, 1 to 255 string values, required | Option name -> description     |

Result: `{"type":"choice","choice":<option>,"confidence":<0..1>,"probabilities":{<option>:<0..1>}}`.

### `mcp__jev-api__score`

| Input          | Values                             | Meaning                                     |
| -------------- | ---------------------------------- | ------------------------------------------- |
| `instructions` | string, required                   | What to rate                                |
| `state`        | string, required                   | The text the question is about              |
| `criteria`     | array of 2 to 10 strings, required | The levels, lowest first; scores start at 0 |

Result: `{"type":"score","score":<expected level>,"confidence":<0..1>,"legend":{"0":<level>,...},"probabilities":{"0":<0..1>,...}}`. The score is the probability-weighted level: 0 is the first level, and a value between two levels is fractional. `legend` and `probabilities` are keyed by level index.

## Errors

Errors come back as a tool error (Claude reads it as an error result) whose text starts with the question type: the type name and a colon (for example `noul:`).

- No configuration (none of the three variables set): no request is sent.
- Invalid input, or a `JEV_URL` / `TYPESAFE_BASE_URL` that is not an `http(s)` URL (for `TYPESAFE_BASE_URL` also one with a query or fragment): no request is sent.
- HTTP 4xx/5xx: `HTTP <status>` plus the API's reason (its `detail`, or its `error.message`) when there is one.
- No answer of the asked type in the response, a network error or an unparsable body: the reason. Where Claude Code's error quotes the endpoint, the text shows `<JEV_URL>` or `<TYPESAFE_BASE_URL>/v1/systemone` instead of the configured URL.
- A request taking longer than 30 seconds: `timeout after 30000ms`, or Claude Code's own limit on one request (`... aborted: no complete answer within 30000ms`) when that comes first.
- A call that is interrupted while it waits answers at once; the request itself still runs to its end.
