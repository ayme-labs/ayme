# @ayme-dev/ayme

Expose selected Page Object Actions as Page Object Tools. Ordinary TypeScript POMs
remain the source of the behavior; no Ayme base class is required.

## Install

These packages are not published yet. The commands below describe registry
installation once released; before then use supplied package tarballs.

```sh
npm install @ayme-dev/ayme @ayme-dev/vue # or @ayme-dev/react
npm install -D @ayme-dev/unplugin-ayme @playwright/test@~1.62.1
```

Use your project's package manager. Configure the
[compiler integration](https://github.com/ayme-labs/ayme/blob/main/packages/unplugin-ayme/README.md),
then follow your framework integration's README:
[Vue](https://github.com/ayme-labs/ayme/blob/main/packages/vue/README.md) or
[React](https://github.com/ayme-labs/ayme/blob/main/packages/react/README.md).
Internal adapter packages are bundled; consumers do not install them separately.

## Entries

- `@ayme-dev/ayme` is what a consumer uses: the `@ayme` and `@ayme.action`
  decorators, the runtime session (`createAyme`), `createPage`,
  `decisionEndpoint`, and their types.
- `@ayme-dev/ayme/server` is the Decision Endpoint handler,
  `createDecisionEndpoint`, for your backend.
- `@ayme-dev/ayme/internal` serves ayme's own packages only: the code
  `unplugin-ayme` generates into your bundle (`registerCompiledPom`) and the
  inspector. Applications do not import it, and what it exports may change
  without notice.
- `@ayme-dev/ayme/testing` is for Playwright tests of an integration: a
  recording WebMCP driver that `recordPublishedTools` installs into a browser
  context (or `recordPublishedToolsLate` into an already loaded page, to test
  a driver that appears late), with queries to list, inspect, await and execute the tools the
  runtime publishes. It uses Playwright's types and receives your test's
  `Page` and `BrowserContext`. Only tests may import it; application code
  never does.

## Expose an action

Keep the existing POM behavior. Mark the class with `@ayme` and each action to
expose with `@ayme.action`; each becomes a Page Object Tool:

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

Both decorators also take the other form: `@ayme({ description })` describes
the Page Object Model, and a bare `@ayme.action` publishes with a generated
description. `description` is the only option. The build fails on a class or
method still marked with the replaced `@WebMCP` or `@WebMCP.tool`.

A Page Object Tool is named after its class and method, as `GreetingPage.greet`.
Registering a Page Object while a different class with the same name is
registered throws; rename one of them. Several instances of one class can be
registered together and share its tools.

Put annotated POMs in `.ts` files imported by the application. Enable
`compilerOptions.experimentalDecorators` in their TypeScript configuration.
Tool schemas come from method signatures. Public members are not automatically
published as tools. Keep browser-imported POMs free of Node-only code and
runtime test-runner imports, including decorators that call `test.step`.
Type-only Playwright imports are appropriate.

## Page state

After runtime setup and POM registration, the runtime captures Structural Page
State for agents and for the Goal Loop. Page state works without WebMCP
publication. Tool invocation through a browser
client also requires the driver and publication setup.

Pass `ignore` on the Vue composable or React provider to keep parts of the DOM
out of the Structural Page State. When the predicate returns `true` for an
element, that element and everything inside it are dropped from page state
capture. This affects page state only; it does not change which tools are
published. Polarity is the opposite of a Custom Tool's `filter`: `ignore` true
drops, `filter` true keeps.

```ts
useAyme({
  ignore: (element) => element.matches("[data-assistant-panel]"),
});
```

### Interaction history

The runtime records what happens in the document for as long as it lives: a
Visit at load and at each same-document navigation, every tool call and Goal
Loop step as an action, and every page state it captures. Each caller, the
calling agent, the Goal Loop's model and your application's `tools.run`, has
its own last-received page state; an action's Change Record is the difference
between that state and the page after the action. So an agent's next action
reports what your application changed in between. A Goal Loop run leaves its
caller's state alone until the Handover. A full page load starts a new
history.

## Runtime session

The framework packages create and start the runtime session for you and hand
it out as `ayme`. Any other consumer, such as a prebuilt script on a page,
creates it with `createAyme`:

```ts
import { createAyme, createPage, decisionEndpoint } from "@ayme-dev/ayme";

const ayme = createAyme({
  pageFactory: () => createPage({ actionTimeout: 500 }),
  customTools: [
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
const stop = ayme.start();
const handover = await ayme.tools.run("goal", {
  goal: "archive the oldest item",
  maxSteps: 5,
});
stop();
```

`createAyme(options?)` takes one options object, `AymeOptions`:

- `pageFactory`: a factory for the browser Page the session drives. The
  session calls it at most once, lazily, on its first use in the browser, and
  never during server rendering. Without it, the session calls `createPage()`.
- `ignore`, `customTools` and `goalLoop`: described in their own sections below.
  They are configured on `start()` and cleared when the session stops.
- `webMCP`: whether and how the session publishes its tools through WebMCP;
  see [WebMCP publication](#webmcp-publication).

`start()` claims the runtime for the current document, one owner at a time,
and returns the function that stops it. The session, of type `Ayme`, has three
members: `tools`, `pom` and `webMCP`.

### Running tools

`ayme.tools` reaches every registered tool by its name: Browser Tools, Custom
Tools, Page Object Tools, `snapshot` and `goal`. It works the same whether
WebMCP publication is on, off, waiting or failed, and `toolNamePrefix` does
not apply to it.

```ts
const { structure } = await ayme.tools.run("snapshot", {});
await ayme.tools.run("click", { target: "e5" });
await ayme.tools.run("TodoPage.addTodo", { title: "Milk" });

ayme.tools.list(); // [{ name, description, inputSchema, group }, …]
const unsubscribe = ayme.tools.subscribe((tools) => render(tools));
```

- `run(name, input)` runs a live tool the way an agent's call runs it: the
  same input validation, target resolution, action recording and settling.
  The built-in tools are typed by name: a Browser Tool resolves with its
  action result (`ActionResult`), `snapshot` with `PageContextPayload` and
  `goal` with the `Handover`. Any other name takes an object and resolves with
  `unknown`; Page Object Tools and Custom Tools resolve with an action result.
- A failure throws: `ToolInputError`, `RefResolutionError`, or
  `RuntimeStateError` when the session is not started or the tool is not live.
  An agent gets the same error as the text of an `isError` result. Errors from
  the browser Page pass through unchanged.
- Your application is a caller of its own: its actions do not move a
  connected agent's Change Record, so the agent's next action reports what
  your application changed.
- `list()` returns every tool `run` can run now, in publication order, with
  its `group`: `"browser"`, `"custom"`, `"pageObject"` or `"agent"`. It
  returns the same array until the set changes, and `[]` while the session is
  not started, including during server rendering.
- `subscribe(listener)` calls `listener` with the new list after the set
  changes: the session starts or stops, a Page Object class is registered for
  the first time or unregistered for the last, or a registered Page Object
  becomes available or unavailable. It returns the function that unsubscribes.

### Page Objects

`ayme.pom` holds one instance of each Page Object class for the session:

```ts
const editor = ayme.pom.get(Editor); // the instance, created on first use
ayme.pom.register(Editor); // counts a registration; returns the instance
ayme.pom.unregister(Editor); // removes one registration
```

- `get(Model)` is safe during rendering. During server rendering it returns an
  inert Page Object with the model's prototype and never calls `pageFactory`.
- `register(Model)` makes the class's tools live while the session is started.
  Registrations made before `start()` take effect on start. Each component
  that uses a Page Object registers it, and the tools are withdrawn when the
  last registration is removed.
- Every registration of a class shares one instance, so a Page Object should
  keep no per-component state in its own fields.

### WebMCP status

`ayme.webMCP` holds the WebMCP publication: `publicationStatus` reports its
status, `subscribe(listener)` calls `listener` with each new status, and
`retryPublication()` retries it.

### WebMCP publication

The call that starts Ayme decides whether its tools are published through
WebMCP: `useAyme`, `AymeProvider` or `createAyme`. The build
integration has no publication setting.

```ts
useAyme({
  webMCP: { enabled: true, toolNamePrefix: "ayme_" },
});
```

- `webMCP.enabled` turns publication on. It is off unless set, and then
  `webMCP.publicationStatus` reads `disabled`. Page Objects, page state and the
  Goal Loop work either way.
- `webMCP.toolNamePrefix` is prepended to every published tool name: the
  agent's tools, the Browser Tools, Custom Tools and Page Object Tools. It is
  empty by default. It applies at publication only; the Goal Loop and the
  Inspector use the unprefixed names. The `testing` helpers take the published
  name, prefix included.
- A tool name that two published tools would share fails publication; the
  status reads `failed` and names the tool.
- When enabled, publication waits up to two seconds for a WebMCP driver.
  `retryPublication()` tries again after `unavailable` or `failed`.
- Turning publication off does not remove Ayme or Page Object code from the
  bundle.

### Browser Page

The runtime session drives one browser Page for the current document. When it
is given no `pageFactory`, it creates the default Page: the `testIdAttribute`,
`actionTimeout` and `navigationTimeout` come from the Playwright settings the
Vite plugin compiled in.

`createPage(options?)` builds that same Page for you. The compiled settings
are its defaults; each option you pass wins for that option only, so the
result of `createPage()` is exactly the default Page.

```ts
import { createPage } from "@ayme-dev/ayme";

const page = () => createPage({ actionTimeout: 500 });
```

Pass such a factory as the runtime session's `pageFactory` when you want to own
page construction: without the Vite plugin, with a timeout that differs from
your build, or wrapped in your own instrumentation. The Vue and React packages
keep creating the default Page; their `pageFactory` option takes the same
factory.

## Custom Tools

A **Custom Tool** is an operation your app registers that applies to one
element. Register it through `customTools` on the Vue composable or React
provider. One registration publishes the operation as a WebMCP tool for the
calling agent and makes it an operation the Goal Loop may choose, as the
single-element [Browser Tools](#browser-tools) are.

```ts
import type { CustomTool } from "@ayme-dev/ayme";

const highlight: CustomTool = {
  name: "highlight_element",
  description: "Outline one element on the page so the user can see it.",
  filter: (element) => element.matches("[data-highlightable]"),
  async execute({ ref, element }) {
    element.classList.add("highlighted");
    return { highlighted: ref };
  },
};

useAyme({ customTools: [highlight] });
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
  `filter`, every node that has a ref may be offered.
- A Custom Tool whose name is already taken by another published tool is
  rejected.
- Custom Tools live for the runtime session: they are unregistered when it
  ends.

## Browser Tools

A **Browser Tool** is a built-in operation on the page itself, as opposed to
one a Page Object provides. An agent that knows Playwright MCP can use them as
it would there:

| Tool            | Playwright MCP counterpart     | Input                                             |
| --------------- | ------------------------------ | ------------------------------------------------- |
| `click`         | `browser_click`                | `target`, `doubleClick?`, `button?`, `modifiers?` |
| `hover`         | `browser_hover`                | `target`                                          |
| `type`          | `browser_type`                 | `target`, `text`, `submit?`, `slowly?`            |
| `fill`          | none                           | `target`, `text`                                  |
| `fill_form`     | `browser_fill_form`            | `fields`: `{ target, name, type, value }[]`       |
| `check`         | `browser_check` (skill-only)   | `target`                                          |
| `uncheck`       | `browser_uncheck` (skill-only) | `target`                                          |
| `select_option` | `browser_select_option`        | `target`, `values`                                |
| `press_key`     | `browser_press_key`            | `key`                                             |

- The inputs follow Playwright MCP as bundled in `playwright-core` 1.62.1: the
  same field names, and the same behaviour when an option is omitted. `type`
  replaces the field's value, or types one character at a time with
  `slowly: true`. `press_key` acts on the focused element. `check` and
  `uncheck` take the input of Playwright MCP's skill-only `browser_check` and
  `browser_uncheck`; `fill` has no counterpart and takes `target` and `text`.
  Playwright MCP's `element`, the description its host shows when asking the
  user to allow an action, is left out: Ayme has no such prompt, so a call
  that passes it is rejected like any other undeclared option.
- `target` is a Structural Ref from `snapshot`, or a selector: CSS, `xpath=`,
  or a Playwright selector such as `role=button[name="Save"]` or
  `text=Save`. A selector must match exactly one element; one that matches
  several fails and never acts on the first. Playwright MCP also takes locator
  expressions such as `getByRole('button', { name: 'Save' })`; this runtime
  does not, and rejects them as an unsupported target.
- An option a tool does not declare is rejected with an error naming it; it is
  never ignored.
- Every action returns the compact action result: `page_changed`, `settled`,
  `changes` and, when it has one, the action's own `result`.
- `fill_form` fills its fields in order and stops at the first that fails. Its
  `result` names the fields filled (`filled`) and the one that failed
  (`failed`, with its error). Fields filled before it stay filled.
- The single-element tools are operations the Goal Loop may choose, each for
  the elements its filter keeps: `click` and `hover` take
  elements that are not disabled and have an interactive role or a pointer
  cursor; `type` and `fill` take elements text can actually be entered into;
  `check` takes checkboxes, radio buttons and switches, and `uncheck` the
  same without radio buttons;
  `select_option` takes select elements. The loop fills only the element and
  the required fields. `fill_form` and `press_key` are published only.

The browser runtime differs from a real browser driven by Playwright:

- Input is synthetic. Its events are not trusted, so they grant no user
  activation.
- `hover` does not apply CSS `:hover`.
- Key presses do not move focus natively; `Tab` does not move to the next
  field.

## Tool failures

A published tool never throws. WebMCP drops the reason of a rejected tool call:
native Chrome reports only a generic `UnknownError`. Every tool Ayme publishes,
including `snapshot` and `goal`, therefore resolves a failure as
an MCP tool-failure result:

```json
{
  "content": [
    {
      "type": "text",
      "text": "RefResolutionError: Cannot click ref \"e12\": removed."
    }
  ],
  "isError": true
}
```

- `document.modelContext.executeTool()` resolves with this result's JSON. A
  caller must read `isError`; the call does not reject.
- The text is the error's full message, prefixed with the error's name unless
  the name is plain `Error`. A browser action failure keeps Playwright Lite's
  name and call log, for example
  `TimeoutError: page.click: Timeout 1000ms exceeded. …` followed by
  `Call log:`.
- The result has no `structuredContent`; no standard defines a structured error
  yet.
- Only publication converts errors. The Goal Loop still records a failed
  step's message in its history.
- Whether an MCP client connected through the WebMCP local relay sees
  `isError` depends on the relay.

Ayme's own failures are `AymeError` subclasses, exported from
`@ayme-dev/ayme`. Each `name` is its class name, and `kind` tells them apart:

| Class                | `kind`       | Meaning                                                           |
| -------------------- | ------------ | ----------------------------------------------------------------- |
| `ToolInputError`     | `input`      | The caller's arguments are wrong.                                 |
| `RefResolutionError` | `resolution` | A Structural Ref or Page Object instance does not match the page. |
| `RuntimeStateError`  | `runtime`    | Ayme is not set up for this call.                                 |

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

`ayme.tools.run("goal", { goal, maxSteps })` on the runtime session runs the
same loop and resolves with the Handover, whether or not tools are published
and whether or not a WebMCP driver is present. It rejects when the session is
not started or has no `goalLoop`.

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

`goal({ goal, maxSteps })`, from an agent or from `ayme.tools.run`, returns a
Handover:

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
