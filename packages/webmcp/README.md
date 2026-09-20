# @ayme-dev/webmcp

Expose selected Page Object Actions as WebMCP tools. Ordinary TypeScript POMs
remain the source of the behavior; no Ayme base class is required.

## Install

These packages are not published yet. The commands below describe registry
installation once released; before then use supplied package tarballs.

```sh
npm install @ayme-dev/webmcp
npm install -D @ayme-dev/unplugin-webmcp @playwright/test@~1.62.1
```

Use your project's package manager. Configure the
[compiler integration](https://github.com/ayme-labs/ayme/blob/main/packages/unplugin-webmcp/README.md),
then follow the framework integration README, currently
[Vue](https://github.com/ayme-labs/ayme/blob/main/packages/webmcp-vue/README.md).
Internal adapter packages are bundled; consumers do not install them separately.

## Expose an action

Keep the existing POM behavior and annotate the class and selected methods:

```ts
import { WebMCP } from "@ayme-dev/webmcp";
import type { Page } from "@playwright/test";

@WebMCP
export class GreetingPage {
  constructor(private readonly page: Page) {}

  @WebMCP.tool({ description: "Greet the visitor." })
  async greet(name: string) {
    await this.page.getByRole("textbox", { name: "Name" }).fill(name);
    await this.page.getByRole("button", { name: "Greet", exact: true }).click();
  }
}
```

Put annotated POMs in `.ts` files imported by the application. Enable
`compilerOptions.experimentalDecorators` in their TypeScript configuration.
Tool schemas come from method signatures. Public members are not automatically
published as tools. Keep browser-imported POMs free of Node-only code and
runtime test-runner imports, including decorators that call `test.step`.
Type-only Playwright imports are appropriate.

## Page state

After runtime setup and POM registration:

```ts
import { ayme } from "@ayme-dev/webmcp";
console.log((await ayme.getPageState()).text);
```

Page state works without WebMCP publication. Tool invocation through a browser
client also requires the driver and publication setup.

Pass `ignore` on the Vue composable or React provider to keep parts of the DOM
out of the Structural Page State. When the predicate returns `true` for an
element, that element and everything inside it are dropped from page state
capture. This affects page state only; it does not change which tools are
published. Polarity is the opposite of a Ref Tool's `filter`: `ignore` true
drops, `filter` true keeps.

```ts
useAymeWebMcp({
  ignore: (element) => element.matches("[data-assistant-panel]"),
});
```

## Decision Endpoint

The Goal Loop calls a **Decision Endpoint** in your backend. Ayme ships the
handler and a browser helper; your app mounts the route, holds the model key, and
gates access.

### Route contract

`POST` with JSON body `{ model, state, questions }`.

- `model`, `state`, and `questions` follow the System One decisions API. The
  endpoint accepts only `typesafe/jev-*` models.
- Success and upstream errors: return the upstream status and body unchanged.
- The endpoint's own rejections return `{ "error": "<one plain sentence>" }`:
  - `405` when the method is not `POST`
  - `413` when the body is over 1 MB
  - `400` when the body is not JSON, a field is missing, or the model is not
    `typesafe/jev-*`
  - `502` when the upstream provider cannot be reached
- Authorization failures return whatever `Response` your `authorize` function
  throws.

The handler forwards no incoming request headers. It builds the upstream request
from scratch with your key and `Content-Type: application/json`, posting to
OpenRouter's System One API at `https://openrouter.ai/api/v1/systemone`.

### Server handler

```ts
import { createDecisionEndpoint } from "@ayme-dev/webmcp/server";

const handleDecision = createDecisionEndpoint({
  apiKey: process.env.YOUR_OPENROUTER_KEY!,
  authorize(request) {
    // Return nothing when allowed, or throw a Response to reject.
  },
});
```

`createDecisionEndpoint` requires both options and throws when `document` exists.

Mount `handleDecision` on your backend route. In Vite during local development:

```ts
import { createDecisionEndpoint } from "@ayme-dev/webmcp/server";

const handler = createDecisionEndpoint({
  apiKey: process.env.YOUR_OPENROUTER_KEY!,
  authorize() {},
});

server.middlewares.use("/api/decisions", async (req, res) => {
  const request = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body:
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : await readRequestBody(req),
  });
  const response = await handler(request);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
});
```

Keep the key in a server-only environment variable without a `VITE_` prefix.

### Browser helper

```ts
import { decisionEndpoint } from "@ayme-dev/webmcp";

const decide = decisionEndpoint("/api/decisions", {
  credentials: "same-origin",
});

useAymeWebMcp({
  goalLoop: decide,
});
```

`decisionEndpoint` posts the `DecisionRequest`, resolves function `headers`,
passes `credentials`, and throws on non-2xx responses with the status and error
text. Use a fake function in deterministic tests.

## Coding agent skill

Copy this request into your coding agent:

> Install the `ayme` skill from https://github.com/ayme-labs/ayme/tree/main/skills/ayme into this project's skill directory, including its references. Then use it to set up Ayme WebMCP here.
