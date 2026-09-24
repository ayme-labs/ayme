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

## Entries

- `@ayme-dev/webmcp` is what a consumer uses: the `@WebMCP` decorators, the
  runtime session (`createRuntimeSession`, with `pursueGoal` for the Goal
  Loop), `createPage`, the `ayme` page-state facade, `decisionEndpoint`, and
  their types.
- `@ayme-dev/webmcp/server` is the Decision Endpoint handler,
  `createDecisionEndpoint`, for your backend.
- `@ayme-dev/webmcp/internal` serves ayme's own packages only: the framework
  packages (`webmcp-vue`, `webmcp-react`) for server page objects and page
  registrations, the code `unplugin-webmcp` generates into your bundle
  (`registerCompiledPom`), and the inspector. Applications do not import it,
  and what it exports may change without notice.

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

## Runtime session

The Vue and React packages start the runtime for you. Any other consumer,
such as a prebuilt script on a page, starts it through the runtime session:

```ts
import {
  createPage,
  createRuntimeSession,
  decisionEndpoint,
} from "@ayme-dev/webmcp";

const session = createRuntimeSession({
  page: () => createPage({ actionTimeout: 500 }),
  refTools: [
    {
      name: "highlight_element",
      description: "Outline one element on the page so the user can see it.",
      async execute({ element }) {
        element.classList.add("highlighted");
      },
    },
  ],
  goalLoop: decisionEndpoint("/api/decisions"),
});
const stop = session.start();
const handover = await session.pursueGoal("archive the oldest item", {
  maxSteps: 5,
});
stop();
```

`createRuntimeSession(options?)` takes one options object:

- `page`: a factory for the browser Page the session drives. The session calls
  it at most once, lazily, on its first use in the browser, and never during
  server rendering. Without it, the session calls `createPage()`.
- `ignore`, `refTools` and `goalLoop`: described in their own sections below.
  They are configured on `start()` and cleared when the session stops.

`start()` claims the runtime for the current document, one owner at a time,
and returns the function that stops it. `construct(Model)` and
`register(Model, instance)` create and register Page Objects. `getSnapshot()`
and `subscribe()` report the WebMCP publication status and `retryPublication()`
retries it; publication is a build policy of the Vite plugin, and the session
works without it. `pursueGoal(goal, { maxSteps })` runs the Goal Loop.

### Browser Page

The runtime session drives one browser Page for the current document. When it
is given no `page`, it creates the default Page: the `testIdAttribute`,
`actionTimeout` and `navigationTimeout` come from the Playwright settings the
Vite plugin compiled in.

`createPage(options?)` builds that same Page for you. The compiled settings
are its defaults; each option you pass wins for that option only, so the
result of `createPage()` is exactly the default Page.

```ts
import { createPage } from "@ayme-dev/webmcp";

const page = () => createPage({ actionTimeout: 500 });
```

Pass such a factory as the runtime session's `page` when you want to own page
construction: without the Vite plugin, with a timeout that differs from your
build, or wrapped in your own instrumentation. The Vue and React packages keep
creating the default Page; their `page` option takes the same factory.

## Ref Tools

A **Ref Tool** is an operation that applies to one Structural Ref. Click and
fill are built in; your app registers its own through `refTools` on the Vue
composable or React provider. One registration publishes the operation as a
WebMCP tool for the calling agent and makes it an operation the Goal Loop may
choose.

```ts
import type { RefTool } from "@ayme-dev/webmcp";

const highlight: RefTool = {
  name: "highlight_element",
  description: "Outline one element on the page so the user can see it.",
  filter: (element) => element.matches("[data-highlightable]"),
  async execute({ ref, element }) {
    element.classList.add("highlighted");
    return { highlighted: ref };
  },
};

useAymeWebMcp({ refTools: [highlight] });
```

- The published tool takes `{ ref }`. Ayme parses the ref, resolves it against
  the Page State Session and calls `execute` with the current ref and its
  element. An unknown, removed or ambiguous ref fails before `execute` runs.
- `description` is the only instruction the model gets about the operation.
- The call returns the same action result as every other action: a JSON value
  returned by `execute` appears under `result`, next to `page_changed`,
  `settled` and `changes`.
- `filter` limits only which elements the Goal Loop may offer for this tool. It
  is not enforced when the calling agent calls the tool with a ref. Without a
  `filter`, every node that has a ref may be offered. Click's built-in filter
  keeps elements that are not disabled and have an interactive role or a
  pointer cursor; fill's keeps elements text can actually be entered into.
- A Ref Tool whose name is already taken by another published tool is rejected.
- Ref Tools live for the runtime session: they are unregistered when it ends.

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

## Goal Loop

The Goal Loop drives the page toward a natural-language goal in steps. Each
step is one judgement by a fast System One model, not by the calling agent's LLM.
The calling agent starts the loop with `pursue_goal` and receives a **Handover**.

### Turning it on

Pass `goalLoop` on the Vue composable or React provider. The `pursue_goal`
WebMCP tool is published only when `goalLoop` is set.

```ts
import { decisionEndpoint } from "@ayme-dev/webmcp";

useAymeWebMcp({
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

A step first asks which operation moves closest to the goal and whether the
goal is met. When the chosen operation takes arguments the model can pick from
a closed set — a Structural Ref, an enum value or a boolean — a second request
asks for all of them at once and the operation runs with the chosen values.
The ref options are the elements the operation's `filter` keeps. An optional
closed-set parameter is offered an extra choice that leaves it unset. The model
never writes a free value: an operation that requires one, such as
`fill_page_state_ref`, ends the loop with `needs_value` so that the calling
agent supplies it.

### The Handover

`pursue_goal({ goal, maxSteps })` and `session.pursueGoal(goal, { maxSteps })`
return a Handover:

```ts
{
  reason:  "done" | "no_fitting_option" | "needs_value"
         | "action_failed" | "step_budget" | "decide_failed",
  next:    string,     // plain words: what the calling agent should do now
  history: { did: string, result: string, page_changed: boolean }[],
  needs?:  { tool: string, parameters: string[] },  // only with needs_value
}
```

| Reason              | Meaning                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `done`              | The model judged the goal achieved (goal_met ≥ 0.5).                                                         |
| `no_fitting_option` | The model chose "none" — no available operation fits.                                                        |
| `needs_value`       | The chosen operation needs parameter values the loop cannot fill. `needs` names the tool and its parameters. |
| `action_failed`     | Two operations failed in a row.                                                                              |
| `step_budget`       | `maxSteps` exhausted before the goal was achieved.                                                           |
| `decide_failed`     | The decision function failed (network, rejected, malformed).                                                 |

The `next` field tells the calling agent what to do in plain words. History
records each operation the loop ran: a readable label in `did`, `"ok"` or an
error message in `result`, and whether the page changed in `page_changed`.

## Coding agent skill

Copy this request into your coding agent:

> Install the `ayme` skill from https://github.com/ayme-labs/ayme/tree/main/skills/ayme into this project's skill directory, including its references. Then use it to set up Ayme WebMCP here.
