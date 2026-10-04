# Decision Endpoint

The contract of the route in your backend that adds your key to each decision model request the Goal Loop makes.

## The route

The Goal Loop asks a decision model for each step. The request goes to the Decision Endpoint, a route in your own backend: it holds the model key, decides who may use it, and forwards the request to the model provider. Ayme ships the handler, `createDecisionEndpoint` from `@ayme-dev/ayme/server`, and the browser helper, `decisionEndpoint` from `@ayme-dev/ayme`; you mount the route and gate it. [Goals with Jev](../guides/goals-with-jev.md) shows the setup.

## Request

`POST` with a JSON body `{ model, state, questions }`. The three fields follow OpenRouter's System One API. The endpoint accepts only `typesafe/jev-*` models; Ayme sends Jev, TypeSafe's System One model.

## Responses

The handler checks a request in this order and answers the first failure with `{ "error": "<one plain sentence>" }`:

| Status | When                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------- |
| `405`  | The method is not `POST`.                                                                               |
| any    | `authorize` threw a `Response`; that response is returned as is.                                        |
| `413`  | The body is over 1 MB.                                                                                  |
| `400`  | The body is not JSON, `model`, `state` or `questions` is missing, or the model is not `typesafe/jev-*`. |
| `502`  | The model provider cannot be reached.                                                                   |

Otherwise it returns the provider's status and body unchanged, success or error.

## What is forwarded

The handler builds the provider request from scratch: `POST https://openrouter.ai/api/v1/systemone` with your key as a bearer token, `Content-Type: application/json`, and the request body. It forwards none of the incoming request's headers, so the browser's cookies and credentials never reach the provider.

The response keeps the provider's headers, except the connection-level ones (`connection`, `keep-alive`, `transfer-encoding`, `te`, `trailer`, `upgrade`, the proxy headers and those `connection` names), `content-encoding`, `content-length` and `set-cookie`.

## createDecisionEndpoint

```ts
import { createDecisionEndpoint } from "@ayme-dev/ayme/server";

const handleDecision = createDecisionEndpoint({
  apiKey: process.env.YOUR_OPENROUTER_KEY!,
  authorize(request) {
    // Return when the request is allowed, or throw a Response to reject it.
  },
});
```

| Option      | Type                                          | Meaning                                                                 |
| ----------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| `apiKey`    | `string`                                      | Your OpenRouter key. Keep it in a server-only environment variable.     |
| `authorize` | `(request: Request) => void \| Promise<void>` | Runs before the body is read. Throw a `Response` to reject the request. |

Both options are required. It returns a `(request: Request) => Promise<Response>` handler for any server that speaks the Fetch API. It throws a `RuntimeStateError` when called where `document` exists, so the key cannot end up in a browser bundle.

## decisionEndpoint

```ts
import { decisionEndpoint } from "@ayme-dev/ayme";

const decide = decisionEndpoint("/api/decisions", {
  credentials: "same-origin",
});
```

`decisionEndpoint(url, options?)` returns the decision function for `goalLoop`. It posts each `DecisionRequest` as JSON to `url`, sends `headers` (a value, or a function it calls for each request), passes `credentials` to `fetch`, and throws on a non-2xx response with its status and error text, or on a body that is not a decision response.
