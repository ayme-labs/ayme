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

| Option        | Type                            | Meaning                                                                                                                                                                               |
| ------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pageFactory` | `() => Page`                    | Builds the browser Page the session drives. Called at most once, lazily, on first use in the browser, never during server rendering. Defaults to `createPage()`.                      |
| `ignore`      | `(element: Element) => boolean` | Drops matching elements and their descendants from the Structural Page State. See [Page state](../guides/page-state.md).                                                              |
| `customTools` | `CustomTool[]`                  | Operations on one element. See [Custom Tools](../guides/custom-tools.md).                                                                                                             |
| `goalLoop`    | `GoalLoopDecisionFunction`      | The decision function the Goal Loop calls, usually `decisionEndpoint(url)`. The `goal` tool exists only when it is set. See [Goals with Jev](../guides/goals-with-jev.md).            |
| `webMCP`      | `AymeWebMcpOptions`             | `{ enabled, toolNamePrefix }`. See [Publish tools](../guides/publish-tools.md).                                                                                                       |
| `inspector`   | `boolean \| { demo: boolean }`  | Loads and mounts the [Inspector](../guides/inspector.md) when the session starts in the browser. Off unless set. `{ demo: true }` adds [demo mode](../guides/inspector.md#demo-mode). |
| `navigate`    | `(url: string) => unknown`      | Your client router's navigation, which the [`navigate` Browser Tool](browser-tools.md) calls instead of loading a new document. See below.                                            |

`ignore`, `customTools`, `goalLoop` and `navigate` take effect on `start()` and are cleared when the session stops.

With `navigate`, the `navigate` tool moves through your router, so your app keeps its in-memory state. The function gets the absolute URL of a page on the document's own origin; the tool refuses other origins, and protocols other than `http:` and `https:`, before calling it. When it returns a promise, the tool waits for it and ignores its value, then waits for a Settled Page and answers with the Change Record; a rejection fails the call. If it starts a full load after all, the call answers as a [full page load](../guides/page-state.md#full-page-loads). A router that takes a path, such as Vue Router, gets the URL without its origin:

```ts
navigate: (url) => router.push(url.slice(location.origin.length)),
```

`ayme.start()` claims the runtime for the current document, one owner at a time, and returns the function that stops it.

## ayme.tools

`ayme.tools` (`AymeTools`) reaches every live tool by its unprefixed name, whether or not WebMCP publishes it.

| Member                | Behavior                                                                                                                                                                                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run(name, input)`    | Runs the tool the way an agent's call runs it. Browser Tools resolve with an `ActionResult`, except `generate_locator`, which resolves with its locators; `snapshot` with a `PageContextPayload`, `goal` with a `Handover`. Page Object Tools and Custom Tools resolve with an action result, typed `unknown`. |
| `list()`              | Every tool `run` can run now, in publication order, as `ToolInfo` objects (`name`, `description`, `inputSchema`, `group`). `group` is `"browser"`, `"custom"`, `"pageObject"` or `"agent"`. Returns the same array until the set changes, and `[]` while the session is not started.                           |
| `subscribe(listener)` | Calls `listener` with the new list after the set changes: the session starts or stops, a class is registered for the first time or unregistered for the last, or a Page Object becomes available or unavailable. Returns the function that unsubscribes.                                                       |

`run` throws `ToolInputError` for wrong input, `RefResolutionError` when a ref or instance does not match the page, and `RuntimeStateError` when the session is not started or the tool is not live. Errors from the browser Page pass through unchanged. `BuiltInTools` maps each built-in tool name to its input and result; `ToolInput<Name>` and `ToolResult<Name>` read them.

## ayme.pom

`ayme.pom` (`AymePom`) holds one Page Object of each Page Object Model for the session.

| Member              | Behavior                                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get(Model)`        | Returns the instance, created on first use. Safe during rendering: on the server it returns an inert object with the model's prototype and never calls `pageFactory`. |
| `register(Model)`   | Counts a registration and returns the instance. The class's tools are live while the session is started; registrations made before `start()` take effect on start.    |
| `unregister(Model)` | Removes one registration. The tools are withdrawn when the last one is removed.                                                                                       |

Every registration of a class shares one instance, so a Page Object should keep no per-component state in its own fields.

## ayme.webMCP

`ayme.webMCP` (`AymeWebMcp`) is the session's WebMCP publication.

| Member                | Behavior                                                                                                                                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publicationStatus`   | `{ state, message }`. `state` is `disabled` (publication off), `waiting` (for a WebMCP driver), `active` (published), `unavailable` (no driver within two seconds), `failed` (such as two published tools sharing a name) or `disposed` (the session stopped). |
| `subscribe(listener)` | Calls `listener` with each new status. Returns the function that unsubscribes.                                                                                                                                                                                 |
| `retryPublication()`  | Tries again after `unavailable` or `failed`. Pending attempts are shared, and an active publication is not repeated.                                                                                                                                           |

## createPage

`createPage(options?)` builds the browser Page the session drives by default. Its defaults are the Playwright settings the [build plugin](build-plugin.md) compiled in; each option you pass, `testIdAttribute`, `actionTimeout` or `navigationTimeout`, wins for that option only, so `createPage()` is exactly the default Page. Pass a factory as `pageFactory` to own page construction: without the Vite plugin, with a timeout that differs from your build, or wrapped in your own instrumentation. A wrapper must keep the locators the runtime observes.

```ts
createAyme({ pageFactory: () => createPage({ actionTimeout: 500 }) });
```

## decisionEndpoint

`decisionEndpoint(url, options?)` returns a decision function for `goalLoop` that posts each `DecisionRequest` to your Decision Endpoint. It resolves function `headers`, passes `credentials`, and throws on a non-2xx response with its status and error text, or on a body that is not a decision response. The [Decision Endpoint reference](decision-endpoint.md) has the route contract and `createDecisionEndpoint`.

## Errors

Ayme's own failures are `AymeError` subclasses: `ToolInputError`, `RefResolutionError` and `RuntimeStateError`. [Errors](errors.md) says what each means and lists the messages.
