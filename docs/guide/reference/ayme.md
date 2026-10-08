# @ayme-dev/ayme

The decorators, `createAyme` and the session it returns, and the other exports of `@ayme-dev/ayme` and its entries.

## Entries

| Entry                   | For                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `@ayme-dev/ayme`        | Your app: the decorators, `createAyme`, `createPage`, `decisionEndpoint`, the errors and their types. |
| `@ayme-dev/ayme/server` | Your backend: `createDecisionEndpoint`, the Decision Endpoint handler.                                |

`@ayme-dev/ayme/internal` serves Ayme's own packages and the code the build plugin generates. Applications do not import it, and it may change in any release.

## Decorators

| Decorator                                         | Marks                                                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `@ayme` or `@ayme({ description })`               | A class as a Page Object Model. Its subclasses are Page Object Models too.                                  |
| `@ayme.action` or `@ayme.action({ description })` | A method as a Page Object Action, published as a Page Object Tool. Without a description, one is generated. |

[Page Object Models](../guides/page-object-models.md) covers naming, input schemas and Page Object Children.

## createAyme

`createAyme(options?)` creates a session, of type `Ayme`.

| Option            | Type                                          | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pageFactory`     | `() => Page`                                  | Builds the browser Page the session drives. Called at most once, lazily, on first use in the browser, never during server rendering. Defaults to `createPage()`.                                                                                                                                                                                                                                                                                   |
| `ignore`          | `(element: Element) => boolean`               | Drops matching elements and their descendants from the Structural Page State. See [Page state](../guides/page-state.md).                                                                                                                                                                                                                                                                                                                           |
| `customTools`     | `CustomTool[]`                                | Operations on one element. See [Custom Tools](../guides/custom-tools.md).                                                                                                                                                                                                                                                                                                                                                                          |
| `goalLoop`        | `GoalLoopDecisionFunction`                    | The decision function the Goal Loop calls, usually `decisionEndpoint(url)`. The `goal` tool exists only when it is set. See [Goals with Jev](../guides/goals-with-jev.md).                                                                                                                                                                                                                                                                         |
| `webMCP`          | `AymeWebMcpOptions`                           | `{ enabled, toolNamePrefix }`. See [Publish tools](../guides/publish-tools.md).                                                                                                                                                                                                                                                                                                                                                                    |
| `inspector`       | `boolean \| { demo: boolean }`                | Loads and mounts the [Inspector](../guides/inspector.md) when the session starts in the browser. Off unless set. `{ demo: true }` adds [demo mode](../guides/inspector.md#demo-mode).                                                                                                                                                                                                                                                              |
| `navigate`        | `(url: string) => unknown`                    | Your client router's navigation, which the [`navigate` Browser Tool](browser-tools.md) calls instead of loading a new document. See below.                                                                                                                                                                                                                                                                                                         |
| `agentConnection` | `boolean \| { link?: string; port?: number }` | Lets a coding agent's Ayme MCP server pair with the session and call its tools while it is started: in the browser, the page; in Node, the process, as an App Process beside the page. Loads the optional `@ayme-dev/mcp` package on demand, so install it beside `@ayme-dev/ayme`. Off unless set. For an App Process, `link` (a connect link from `ayme_connect`) names one server, and `port` looks on that one port only; a page ignores both. |

`ignore`, `customTools`, `goalLoop` and `navigate` take effect on `start()` and are cleared when the session stops.

With `navigate`, the `navigate` tool moves through your router, so your app keeps its in-memory state. The function gets the absolute URL of a page on the document's own origin; the tool refuses other origins, and protocols other than `http:` and `https:`, before calling it. When it returns a promise, the tool waits for it and ignores its value, then waits for a Settled Page and answers with the Change Record; a rejection fails the call. If it starts a full load after all, the call answers as a [full page load](../guides/page-state.md#full-page-loads). A router that takes a path, such as Vue Router, gets the URL without its origin:

```ts
navigate: (url) => router.push(url.slice(location.origin.length)),
```

`ayme.start()` makes the session the owner of the place it runs and turns on what its options ask for, and returns the function that stops it. In the browser that place is the document; in a Node process it is the process, which the session runs as its App Process (see [In Node](#in-node)). Each has one owner at a time: a start while the document or the process already has one throws a `RuntimeStateError` with `code: "active-owner"`; once that owner stops, a session can start again. The sessions the framework integrations create to render on the server never own anything: their `start()` starts nothing, so server rendering needs no guard and never conflicts with the process's App Process.

## ayme.tools

`ayme.tools` (`AymeTools`) reaches every tool by its unprefixed name, whether or not WebMCP publishes it. A Page Object Tool stays listed while its Page Object is unavailable, flagged so: each surface decides whether to offer it. WebMCP publication, the Agent Connection and the Inspector offer only available tools.

| Member                | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run(name, input)`    | Runs the tool the way an agent's call runs it. Browser Tools resolve with an `ActionResult`, except `generate_locator`, which resolves with its locators; `snapshot` with a `PageContextPayload`, `goal` with a `Handover`. Page Object Tools and Custom Tools resolve with an action result, typed `unknown`.                                                                                                                  |
| `list()`              | Every tool, in publication order, as `ToolInfo` objects (`name`, `description`, `inputSchema`, `group`, `available`). `group` is `"browser"`, `"custom"`, `"pageObject"`, `"peek"` or `"agent"`. `available` says whether `run` can run it now: a Page Object Tool is available while its Page Object is; every other tool always is. Returns the same array until the list changes, and `[]` while the session is not started. |
| `subscribe(listener)` | Calls `listener` with the new list after the set changes: the session starts or stops, a class is registered for the first time or unregistered for the last, a Page Object becomes available or unavailable, or a Peek Tool appears or goes. Returns the function that unsubscribes.                                                                                                                                           |

`run` throws `ToolInputError` for wrong input, `RefResolutionError` when a ref or instance does not match the page, and `RuntimeStateError` when the session is not started, no tool has the name, or the tool is not available. Errors from the browser Page pass through unchanged. `BuiltInTools` maps each built-in tool name to its input and result; `ToolInput<Name>` and `ToolResult<Name>` read them.

## ayme.pom

`ayme.pom` (`AymePom`) holds one Page Object of each Page Object Model for the session.

| Member              | Behavior                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get(Model)`        | Returns the instance, created on first use. Safe during rendering: on the server it returns an inert object with the model's prototype and never calls `pageFactory`.                                  |
| `register(Model)`   | Counts a registration and returns the instance. The class's tools are live while the session is started; registrations made before `start()` take effect on start. On the server it registers nothing. |
| `unregister(Model)` | Removes one registration. The tools are withdrawn when the last one is removed.                                                                                                                        |

Every registration of a class shares one instance, so a Page Object should keep no per-component state in its own fields.

## ayme.peek

`ayme.peek(read, name, id?)` adds a Peek: a named view of app state that a coding agent reads on demand. It returns the function that removes it.

- `read` returns the values when an agent asks, and may be async. The values go out as JSON: a property whose value is `undefined` is left out, so the agent cannot tell it from one the Peek does not have; a `Date` becomes its ISO string; and an instance whose `read` returns `undefined` reads `null`.
- `name` is required; an empty name throws `RuntimeStateError`, and so does a name whose Peek Tool name another tool already uses, or, in the browser, a name starting with `node.`, whose tool would read as an App Process's. A tool that takes the name later wins, and the console warns that the Peek Tool is hidden. Each name has one Peek Tool, `peek.<name>` in the browser and `peek.node.<name>` in a Node process (an App Process), with characters outside `[A-Za-z0-9_.-]` replaced by `_`. It takes no input and returns `{ name, instances }`: per live instance, its `id` and either its `values` or the `error` its read threw.
- There is one instance per (`name`, `id`). A later call with the same `id` updates that instance's `read`. Without an `id` there is one instance per name, and a later call replaces the earlier one, so a module that runs again replaces its Peek.
- The tool goes when its last instance is removed. An instance removed and added again in one go, such as by React StrictMode's remount, keeps it.

Peek Tools are in `ayme.tools` and reach coding agents through the Agent Connection and the Inspector. WebMCP never publishes them, and the Goal Loop never offers them. A call answers at once, without waiting for a Settled Page. `ayme.peek` does nothing unless the session has `agentConnection` on, or `inspector` in the browser.

### In Node

In Node, `start()` makes the session the process's App Process, unless a framework integration created the session to render a request. It needs no page, and the session's tools are its Peek Tools alone; with `agentConnection` the process pairs with the agent's Ayme MCP server beside the page. Without `agentConnection` the session still owns the process, but connects nothing and offers no Peeks. A process has one App Process, so start one session per process, once, in the server's entry point; in Next.js, that is `instrumentation.ts`, which runs once when the server starts:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV === "production") return;
  const { createAyme } = await import("@ayme-dev/ayme");
  const ayme = createAyme({ agentConnection: true });
  ayme.start();
  ayme.peek(async () => ({ users: await db.user.count() }), "users");
}
```

In Nuxt, start it in a Nitro server plugin, as the [Nuxt example](../../../apps/example-nuxt/README.md#peeks) does.

The process finds the agent's server the way a tab does: it pairs only when exactly one Ayme MCP server answers on the ports from 9350 to 9365. While unpaired it looks again every few seconds, and again when its server goes away, so a dev server started before the agent pairs once the agent is up. With several servers running, name one with `agentConnection: { link }` or `{ port }`. Read these from your own environment if you need them; Ayme reads none. Component Peeks register only after mount in the browser, so server rendering adds none to the process. While the tab is paired with that server too, its Inspector lists the process's Peek Tools in the Node section of its Peek tools and runs them through the server. The [`@ayme-dev/mcp` README](../../../packages/mcp/README.md#app-processes) covers the pairing and what happens when two App Processes offer one name.

## ayme.webMCP

`ayme.webMCP` (`AymeWebMcp`) is the session's WebMCP publication.

| Member                | Behavior                                                                                                                                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publicationStatus`   | `{ state, message }`. `state` is `disabled` (publication off), `waiting` (for a WebMCP driver), `active` (published), `unavailable` (no driver within two seconds), `failed` (such as two published tools sharing a name) or `disposed` (the session stopped). |
| `subscribe(listener)` | Calls `listener` with each new status. Returns the function that unsubscribes.                                                                                                                                                                                 |
| `retryPublication()`  | Tries again after `unavailable` or `failed`. Pending attempts are shared, and an active publication is not repeated.                                                                                                                                           |

## createPage

`createPage(options?)` builds the browser Page the session drives by default. Its defaults are the Playwright settings the [build plugin](build-plugin.md) compiled in; each option you pass, `testIdAttribute`, `actionTimeout` or `navigationTimeout`, wins for that option only, so `createPage()` is exactly the default Page. Without either, `actionTimeout` is 1 second and `navigationTimeout` 30 seconds. `actionTimeout` also bounds element reads such as `boundingBox`, so an action on a locator that matches nothing fails instead of waiting forever. Navigation keeps its own default whatever `actionTimeout` is; pass `navigationTimeout` to change it. Pass a factory as `pageFactory` to own page construction: without the Vite plugin, with a timeout that differs from your build, or wrapped in your own instrumentation. A wrapper must keep the locators the runtime observes.

```ts
createAyme({ pageFactory: () => createPage({ actionTimeout: 500 }) });
```

## decisionEndpoint

`decisionEndpoint(url, options?)` returns a decision function for `goalLoop` that posts each `DecisionRequest` to your Decision Endpoint. It resolves function `headers`, passes `credentials`, and throws on a non-2xx response with its status and error text, or on a body that is not a decision response. The [Decision Endpoint reference](decision-endpoint.md) has the route contract and `createDecisionEndpoint`.

## Errors

Ayme's own failures are `AymeError` subclasses: `ToolInputError`, `RefResolutionError` and `RuntimeStateError`. [Errors](errors.md) says what each means and lists the messages.
