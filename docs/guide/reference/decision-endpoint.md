# Decision Endpoint

The contract of the route in your backend that adds your key to each decision model request the Goal Loop makes.

## The route

The Goal Loop asks a decision model for each step. The request goes to the Decision Endpoint, a route in your own backend: it holds the model key, decides who may use it, and forwards the request to the model provider. Ayme ships the handler, `createDecisionEndpoint` from `@ayme-dev/ayme/server`, and the browser helper, `decisionEndpoint` from `@ayme-dev/ayme`; you mount the route and gate it. [Goals with Jev](../guides/goals-with-jev.md) shows the setup.

## Request

`POST` with a JSON body `{ state, questions }`, in the shape of the System One API. The browser does not choose the model: the endpoint adds it.

## Responses

The handler checks a request in this order and answers the first failure with `{ "error": "<one plain sentence>" }`:

| Status | When                                                             |
| ------ | ---------------------------------------------------------------- |
| `405`  | The method is not `POST`.                                        |
| any    | `authorize` threw a `Response`; that response is returned as is. |
| `413`  | The body is over 1 MB.                                           |
| `400`  | The body is not JSON, or `state` or `questions` is missing.      |
| `502`  | The model provider cannot be reached.                            |

On success it returns the provider's status and body unchanged. When the provider answers with an error, it keeps that status and returns `{ "error": "<message>" }` with the provider's message, the same shape as its own rejections.

## What is forwarded

The handler builds the provider request from scratch: a `POST` with your key as a bearer token, `Content-Type: application/json`, the request's `state` and `questions`, and the Jev version the Goal Loop is tuned for:

| `provider`   | URL                                      | Model               |
| ------------ | ---------------------------------------- | ------------------- |
| `typesafe`   | `https://api.typesafe.ai/v1/systemone`   | `jev-1.13.0`        |
| `openrouter` | `https://openrouter.ai/api/v1/systemone` | `typesafe/jev-1.13` | It forwards none of the incoming request's headers, so the browser's cookies and credentials never reach the provider. |

The response keeps the provider's headers, except the connection-level ones (`connection`, `keep-alive`, `transfer-encoding`, `te`, `trailer`, `upgrade`, the proxy headers and those `connection` names), `content-encoding`, `content-length` and `set-cookie`.

## createDecisionEndpoint

```ts
import { createDecisionEndpoint } from "@ayme-dev/ayme/server";

const handleDecision = createDecisionEndpoint({
  provider: "typesafe",
  apiKey: process.env.TYPESAFE_API_KEY!,
  authorize(request) {
    // Required in production: authenticate the user and check they may use
    // the Goal Loop. Return to allow; throw a Response, such as a 401, to reject.
  },
});
```

| Option      | Type                                          | Meaning                                                                                            |
| ----------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `provider`  | `"typesafe" \| "openrouter"`                  | Where to send the request: TypeSafe directly, or OpenRouter. There is no default.                  |
| `apiKey`    | `string`                                      | Your TypeSafe or OpenRouter key, for that provider. Keep it in a server-only environment variable. |
| `authorize` | `(request: Request) => void \| Promise<void>` | Runs before the body is read. Throw a `Response` to reject the request.                            |

All three options are required. An unknown `provider` throws a `RuntimeStateError`. It returns a `(request: Request) => Promise<Response>` handler for any server that speaks the Fetch API. It throws a `RuntimeStateError` when called where `document` exists, so the key cannot end up in a browser bundle.

## decisionEndpoint

```ts
import { decisionEndpoint } from "@ayme-dev/ayme";

const decide = decisionEndpoint("/api/decisions", {
  credentials: "same-origin",
});
```

`decisionEndpoint(url, options?)` returns the decision function for `goalLoop`. It posts each `DecisionRequest` as JSON to `url`, sends `headers` (a value, or a function it calls for each request), passes `credentials` to `fetch`, and throws a `DecisionEndpointError` when the call fails. Its `code` says why, so callers need not match the message:

| `code`        | When                                                                                                                   | Message                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `not-mounted` | A `404` without an `{ "error" }` body: nothing serves the route, such as a dev server started without a model key.     | `No Decision Endpoint is mounted at <url>: it answered 404`  |
| `rejected`    | Any other non-2xx: the handler, `authorize` or the provider refused the request, or the provider could not be reached. | `The Decision Endpoint <url> answered <status> <error text>` |
| `malformed`   | A 2xx whose body is not a decision response.                                                                           | `The Decision Endpoint returned an invalid response.`        |

`status` holds the HTTP status for `not-mounted` and `rejected`. The error text is the body's `error`, the raw body when it is not JSON, or the status text when the body is empty. A provider's own 404 reaches the browser with an `{ "error" }` body, so it is `rejected`, not `not-mounted`.

`retryable` says whether asking again can help. It is `true` only for a `rejected` call with a 5xx, 408 (timeout) or 429 (rate limit) status; a missing endpoint, any other refusal and a malformed answer come back the same.

In the Goal Loop, any of them ends the run with the Handover reason `decide_failed`. Its `next` advises a retry only when the error is `retryable`, and for errors other than `DecisionEndpointError`, such as a network failure.
