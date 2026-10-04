# @ayme-dev/ayme

Ayme turns the Page Object Models your tests already use into tools that agents and tests call in your running app. Mark a model and its actions, and each action becomes a Page Object Tool, published through WebMCP and runnable from your own code and tests.

## Install

```sh
npm install @ayme-dev/ayme @ayme-dev/vue # or react, svelte, angular
npm install -D @ayme-dev/unplugin-ayme @playwright/test
```

The [build plugin](https://github.com/ayme-labs/ayme/blob/main/packages/unplugin-ayme/README.md) compiles your Page Object Models into the browser build. On Angular, `ng add @ayme-dev/angular` installs and sets up all of it.

## Mark a Page Object Model

```ts
import { ayme } from "@ayme-dev/ayme";
import type { Page } from "@playwright/test";

@ayme
export class GreetingPage {
  constructor(private readonly page: Page) {}

  @ayme.action({ description: "Greet the visitor." })
  async greet(name: string) {
    await this.page.getByRole("textbox", { name: "Name" }).fill(name);
    await this.page.getByRole("button", { name: "Greet", exact: true }).click();
  }
}
```

`GreetingPage.greet` is now a Page Object Tool. Enable `compilerOptions.experimentalDecorators` in the tsconfig of your Page Object Models.

## Start Ayme

Your framework package starts Ayme at the root of your app: `AymeProvider` in Vue and React, `useAyme` in Svelte, `provideAyme()` in Angular. Without one, create and start the session yourself:

```ts
import { createAyme } from "@ayme-dev/ayme";

const ayme = createAyme({ webMCP: { enabled: true } });
const stop = ayme.start();

ayme.pom.register(GreetingPage);
await ayme.tools.run("GreetingPage.greet", { name: "Ada" });
```

## Documentation

- [Page Object Models](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-object-models.md): marking models and actions, tool names, children and collections.
- [Publish tools](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/publish-tools.md): starting Ayme and turning WebMCP publication on.
- [Page state](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-state.md): the Structural Page State, Structural Refs and interaction history.
- [Custom Tools](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/custom-tools.md): operations of your own on one element.
- [Connect an agent](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md): try your tools from a coding agent through the WebMCP local relay.
- [Test your integration](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/test-your-integration.md): list and call the published tools from Playwright tests.
- [Browser Tools](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/browser-tools.md) and [errors](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/errors.md): the built-in tools and every error message.
- [`@ayme-dev/ayme` reference](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/ayme.md)
- [Ayme documentation](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md)

## Supported versions

`@playwright/test` 1.29 to 1.62, optional, for the types your Page Object Models use. [Install](https://github.com/ayme-labs/ayme/blob/main/docs/guide/start/install.md) lists the supported frameworks, Node.js and TypeScript versions.

## License

[FSL-1.1-ALv2](https://github.com/ayme-labs/ayme/blob/main/LICENSE). Bundled third-party code keeps its original license; see `THIRD_PARTY_NOTICES.txt` in the package.

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
import { createDecisionEndpoint } from "@ayme-dev/ayme/server";

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
import { createDecisionEndpoint } from "@ayme-dev/ayme/server";

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
import { decisionEndpoint } from "@ayme-dev/ayme";

const decide = decisionEndpoint("/api/decisions", {
  credentials: "same-origin",
});

useAyme({
  goalLoop: decide,
});
```

`decisionEndpoint` posts the `DecisionRequest`, resolves function `headers`,
passes `credentials`, and throws on non-2xx responses with the status and error
text. Use a fake function in deterministic tests.

## Goal Loop

The Goal Loop drives the page toward a natural-language goal in steps. Each
step is one judgement by a fast System One model, not by the calling agent's LLM.
The calling agent starts the loop with `goal` and receives a **Handover**.

### Turning it on

Pass `goalLoop` on the Vue composable or React provider. The `goal`
WebMCP tool is published only when `goalLoop` is set.

```ts
import { decisionEndpoint } from "@ayme-dev/ayme";

useAyme({
  goalLoop: decisionEndpoint("/api/ayme/decide"),
});
```

`goalLoop` accepts any function from `DecisionRequest` to
`Promise<DecisionResponse>`. Use `decisionEndpoint` for the common HTTP case,
or pass a fake in tests.

### Running it from your own code

`session.pursueGoal(goal, { maxSteps })` on the runtime session runs the same
loop and resolves with the Handover, whether or not tools are published and
whether or not a WebMCP driver is present. It rejects when the session is not
started or has no `goalLoop`.

### What one step asks

Both stages of a step are decided on the current Structural Page State as
JSON, one object per node, pruned of what a model cannot target: a `generic`
node with no name, props, state or pointer cursor is replaced by its children,
so wrapper chains vanish and the text of their leaves is hoisted, each string
as it was. The pruning is for what the model reads only; the options it is
offered and the Change Record are taken from the full capture, so every ref the
model reads or is offered is a ref of that capture.

A step first asks which operation moves closest to the goal and whether the
goal is met. When the chosen operation takes arguments the model can pick from
a closed set — a Structural Ref, an enum value or a boolean — a second request
asks for all of them at once and the operation runs with the chosen values.
The ref options are the elements the operation's `filter` keeps, one option per
element in document order; nothing is merged or ranked. One question takes at most
255 options. When the elements outnumber that, they are cut into contiguous
chunks of at most 254 plus "none of these", asked side by side in the same
request. When exactly one chunk names an element the operation runs on it; when
several do, one more question offers exactly those elements; when none does,
the loop ends with `no_fitting_option`. An optional closed-set parameter is
offered an extra choice that leaves it unset. The model never writes a free
value: an operation that requires one, such as `fill`, ends the
loop with `needs_value` so that the calling agent supplies it.

### The Handover

`goal({ goal, maxSteps })` and `session.pursueGoal(goal, { maxSteps })`
return a Handover:

```ts
{
  reason:  "done" | "no_fitting_option" | "needs_value"
         | "action_failed" | "step_budget" | "decide_failed",
  next:    string,     // plain words: what the calling agent should do now
  history: {
    operation: string,   // the tool's name; a Page Object tool's qualified name
    chosen: Record<string, { key: string, description: string }>,
    result: string,      // "ok", or the error the action failed with
    page_changed: boolean,
    did: string,         // operation(description, …), for a human skimming
  }[],
  needs?:  { tool: string, parameters: string[] },  // only with needs_value
  changes?: string,    // what the whole run changed; absent when nothing did
}
```

A run that opened a dialog, closed it and archived an item hands over only the
net result:

```ts
{
  reason: "done",
  next: "The goal has been achieved. Continue with your next task.",
  history: [
    { operation: "InboxPage.openDialog", chosen: {}, result: "ok",
      page_changed: true, did: "InboxPage.openDialog()" },
    { operation: "InboxPage.closeDialog", chosen: {}, result: "ok",
      page_changed: true, did: "InboxPage.closeDialog()" },
    { operation: "InboxPage.invoices.archive",
      chosen: { ref: { key: "e5",
        description: 'InboxPage.invoices[0] (listitem "Invoice 7")' } },
      result: "ok", page_changed: true,
      did: 'InboxPage.invoices.archive(InboxPage.invoices[0] (listitem "Invoice 7"))' },
  ],
  changes: `- e2 main:
  - e4 list:
    - e5 <removed> listitem: Invoice 7
  - e9 <added> paragraph: Archived Invoice 7`,
}
```

| Reason              | Meaning                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `done`              | The model judged the goal achieved (goal_met ≥ 0.5).                                                              |
| `no_fitting_option` | The model chose "none" — no available operation fits — or every chunk of a ref question answered "none of these". |
| `needs_value`       | The chosen operation needs parameter values the loop cannot fill. `needs` names the tool and its parameters.      |
| `action_failed`     | Two operations failed in a row.                                                                                   |
| `step_budget`       | `maxSteps` exhausted before the goal was achieved.                                                                |
| `decide_failed`     | The decision function failed (network, rejected, malformed).                                                      |

The `next` field tells the calling agent what to do in plain words. History
records each operation the loop ran: the tool in `operation`; in `chosen`,
per parameter asked, the key of the option the model chose and that option's
description exactly as it was offered, a choice to leave the parameter unset
included; `"ok"` or an error message in `result`; whether the page changed in
`page_changed`; and `did`, a one-line label derived from the others, such as
`click(button "Add item")`.
A step that hands over before acting records nothing. The model is sent the
same entries as its `history`.
`changes` is one Change Record for the whole run, in the notation of an action's
`changes`: the page the calling agent last received against the page after the
run, which becomes the agent's page for its next Change Record.

## Coding agent skill

Copy this request into your coding agent:

> Install the `ayme` skill from https://github.com/ayme-labs/ayme/tree/main/skills/ayme into this project's skill directory, including its references. Then use it to set up Ayme WebMCP here.
