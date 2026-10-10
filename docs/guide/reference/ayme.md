# @ayme-dev/ayme

The decorators, `createAyme` and the session it returns, and the other exports of `@ayme-dev/ayme` and its entries.

## Entries

| Entry                   | For                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `@ayme-dev/ayme`        | Your app: the decorators, `createAyme`, `createPage`, `decisionEndpoint`, the errors and their types. |
| `@ayme-dev/ayme/server` | Your backend: `createDecisionEndpoint`, the Decision Endpoint handler.                                |

`@ayme-dev/ayme/internal` serves Ayme's own packages and the code the build plugin generates. Applications do not import it, and it may change in any release.

## Decorators

| Decorator                                                    | Marks                                                                                                                                                                      |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ayme` or `@ayme({ description })`                          | A class as a Page Object Model. Its subclasses are Page Object Models too.                                                                                                 |
| `@ayme.action` or `@ayme.action({ description, available })` | A method as a Page Object Action, published as a Page Object Tool. Without a description, one is generated. `available` is the action's availability predicate; see below. |

[Page Object Models](../guides/page-object-models.md) covers naming, input schemas and Page Object Children.

### Action availability

`available` is an availability predicate, `(self) => boolean | string | Promise<boolean | string>` (`AvailabilityPredicate`), where `self` is the live Page Object instance. `true` means the action can run now. A string means it cannot, and the string is its Availability Reason. `false` means it cannot, with no reason. Declared as its own function, `const canRemove = async (self: SettingsPanel) => …`, `self` is typed, and one predicate can be given to several actions.

The predicate runs read-only with the runtime's observation of the page, the same probe that checks Page Object Roots, never when the action is called, so it must not scroll, click, focus or change the page. It runs once per present instance: on a collection action such as `ListPage.items.archive`, each item is judged on its own, so the tool is available while any item passes, carries the first failing item's reason when none does, and a call on an item that failed is refused with that item's reason. A predicate that throws makes the action unavailable with the error's text as the reason, such as `TypeError: store is undefined`. Without `available`, an action shares its Page Object's availability: its root is present and a click would reach it. The build plugin does not read the predicate; the decorator keeps it at runtime.

Availability never adds or withdraws a tool. [`ayme.tools`](#aymetools) says how an unavailable tool is listed and refused, and [Page Object Models](../guides/page-object-models.md#action-availability) shows a predicate in use.

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

`ayme.tools` (`AymeTools`) reaches every tool by its unprefixed name, whether or not WebMCP publishes it. It lists every tool of a present Page Object, available or not, flagged so. Only presence, the Page Object Root on the page, adds or withdraws Page Object Tools; availability says whether a listed tool would run. WebMCP publication and the Agent Connection publish every listed tool and refuse a call of an unavailable one, the Goal Loop offers only the available ones, and the Inspector shows an unavailable one dimmed with its reason.

| Member                      | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run(name, input, { by }?)` | Runs the tool as a Run for the Caller `by` names, `"app"` by default, the way an agent's call runs it. Browser Tools resolve with an `ActionResult`, except `generate_locator`, which resolves with its locators; `snapshot` with a `PageContextPayload`, `goal` with a `Handover`. Page Object Tools and Custom Tools resolve with an action result, typed `unknown`.                                                                                                                                                                                                                                                            |
| `list()`                    | Every tool, in publication order, as `ToolInfo` objects (`name`, `description`, `inputSchema`, `group`, `available`, `reason`). `group` is `"browser"`, `"custom"`, `"pageObject"`, `"peek"` or `"agent"`. `available` says whether `run` can run it now: a Page Object Tool is available while its Page Object is and its action's [availability predicate](#action-availability), if it has one, holds; every other tool always is. `reason`, present only when the tool is unavailable and there is one, is its Availability Reason. Returns the same array until the list changes, and `[]` while the session is not started. |
| `subscribe(listener)`       | Calls `listener` with the new list after it changes: the session starts or stops, a class is registered for the first time or unregistered for the last, a Page Object appears on the page or leaves it, a tool becomes available or unavailable or its reason changes, or a Peek Tool appears or goes. Returns the function that unsubscribes.                                                                                                                                                                                                                                                                                   |

A `reason` has one of two producers. When the Page Object Root is present but a click would not reach it, covered by another element, behind an open native modal or inside an inert ancestor, the runtime writes `a click would not reach it; e42 is in the way`, where `e42` is the Structural Ref of the element the click would hit instead: for a covered root, the nearest ref-bearing ancestor of the element at the root's centre; for a native modal or an inert ancestor, that element itself. The ref is the one the agent's latest recorded page state gave that element; until a page state shows it, or when nothing in the way has a ref, such as `pointer-events: none` on `body`, it writes `a click would not reach it`. The runtime reports what it measured and never names a kind of widget, such as a modal, popover or banner. Otherwise the reason is the string the action's availability predicate returned.

`run` throws `ToolInputError` for wrong input, `RefResolutionError` when a ref or instance does not match the page, and `RuntimeStateError` for an empty `by`, when the session is not started, no tool has the name, or the tool is unavailable, which is refused with its reason before anything runs; [Errors](errors.md#messages) has the message. Errors from the browser Page pass through unchanged. `BuiltInTools` maps each built-in tool name to its input and result; `ToolInput<Name>` and `ToolResult<Name>` read them.

Every Caller starts its Runs through `run`: WebMCP publication as `"webmcp"`, the Ayme MCP server's page client as `"ayme-mcp"`, and your code as `"app"` unless it passes another name, such as `{ by: "support-assistant" }` for an in-app assistant. A Caller name is any non-empty string; use lowercase kebab-case, which is not enforced. `callers` holds the built-in names (`callers.app`, `callers.webmcp`, `callers.aymeMcp`, `callers.inspector`); `BuiltInCaller` is one of them, and `Caller` is any name. Each Caller name has its own Change Record cursor, the page that Caller last received, so a Run's Change Record starts at its Caller's own last page: `changes_before` up to the action, `changes` from there; two Callers under one name share one cursor.

Runs take turns: the page runs one at a time, in the order they were started, whatever their Callers. An action's turn ends once the page has settled, so the next Run starts from a Settled Page; a read (`snapshot`, a Peek Tool) waits its turn but adds no settle wait. A failed Run ends its turn like any other. A tool's own code must not call `run` while the tool runs: that Run would wait for the tool's turn to end, which never happens. A tool starts other tools through the `run` it is handed instead, such as a [Custom Tool](../guides/custom-tools.md#use-other-tools-from-a-custom-tool)'s `execute(target, { run })`: each is a child Run, which runs inside its parent's turn, never waiting on the page's queue. A parent's child Runs run one after the other, in the order it starts them, so two started together never act on the page at once. The `goal` tool runs each step's tool as a child Run of the goal Run.

## ayme.runs

`ayme.runs` (`AymeRuns`) is the document's Run log: the Runs started through `ayme.tools.run`, by any Caller, each listed once its turn starts, and the child Runs a tool starts, each listed after the Run that started it. An App Process tool the Inspector runs from the page is listed too, as an `"inspector"` Run; it acts on no page, so it takes no turn.

| Member                | Behavior                                                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list()`              | The newest 200 top-level Runs with their child Runs, oldest first, as `Run` objects; an older top-level Run is dropped with its children. Returns the same array until a Run starts, gains an Interaction, or ends. A new document starts an empty log. |
| `subscribe(listener)` | Calls `listener` with the new list when a Run starts, gains an Interaction, or ends. Returns the function that unsubscribes.                                                                                                                            |

A `Run` has an `id`, the `tool` name, its `input` as JSON, its Caller as `by` for a top-level Run, or its parent Run's id as `parent` for a child Run, which has no Caller, and a `status`: `"running"`, `"succeeded"` or `"failed"`. A succeeded Run has its `result` as JSON captured when it returned, absent for `undefined`; a failed one has its `error` text, the error's message prefixed with its name unless that is plain `Error`. `startedAt` is in epoch milliseconds; `durationMs` is absent while the Run runs. `interactions` lists, in order, the Interactions the Run performed itself on the session's Page: each click, fill, key press, hover or selection on an element, and each keyboard or mouse input, as an `Interaction` with its `operation` (such as `"click"` or `"keyboard.press"`), the `locator` it acted on when there is one, and its `value` when there is one. Waits, assertions, scrolls, focus changes and navigations are not Interactions. A child Run's Interactions are its own, not its parent's, so a goal Run lists none and its steps' child Runs list theirs. A failed Run is recorded and `run` still throws, and a failed WebMCP call is still an error result. That includes a Run whose tool does not exist or is unavailable, or whose session is not started; only an empty `by` throws without a Run, since there is no Caller to record.

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

### What a Peek exposes

Through the Agent Connection, whatever `read` returns goes to the coding agent unchanged, and from the agent's context to its model provider, as a page snapshot does; the Inspector shows it to you. Ayme sends it nowhere else. A Peek is live only while the Agent Connection or the Inspector is on, which you turn on in development only; there is no production guard. `read` is where you decide what the agent sees: return only what you would paste into a chat with that provider. Pick the fields rather than handing over a whole record, and a class with a `toJSON` method controls its own shape:

```ts
ayme.peek(() => ({ id: user.id, name: user.name }), "user"); // not the whole user, with its email and token
```

### In Node

In Node, `start()` makes the session the process's App Process, unless a framework integration created the session to render a request. It needs no page, and the session's tools are its Peek Tools alone; with `agentConnection` the process pairs with the agent's Ayme MCP server beside the page. Without `agentConnection` the session still owns the process, but connects nothing and offers no Peeks. A process has one App Process, so start one session per process, once, in the server's entry point.

Peeks follow one rule on both sides: start the connection where the process starts, and define each Peek in the module that owns the state it reads. In the browser, that is the component, with your framework's Peek hook. In Node, it is the module that holds the state, or one next to it that the same code imports. The App Process offers the Peeks of every session in the process that has `agentConnection` on, so that module needs no started session: it creates its own with `agentConnection` on in development and calls `peek` on it. When a dev server evaluates the module again after an edit, its new `ayme.peek` call replaces the old instance, so the Peek reads the new code.

In Next.js, start the App Process in `instrumentation.ts`, which runs once when the server starts:

```ts
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV === "production") return;
  const { createAyme } = await import("@ayme-dev/ayme");
  createAyme({ agentConnection: true }).start();
}
```

Define the Peeks in a module that request code imports, such as one the root layout imports:

```ts
// app/server-peeks.ts, imported by app/layout.tsx
import { createAyme } from "@ayme-dev/ayme";
import { db } from "./db";

createAyme({
  agentConnection: process.env.NODE_ENV !== "production",
}).peek(async () => ({ users: await db.user.count() }), "users");
```

Do not add Peeks in `register()`. `next dev` never evaluates `instrumentation.ts` again, not even after you edit it, and the modules it imports get their own copies, apart from the ones pages, layouts and Server Actions use. A Peek added there reads that copy: state request code changed does not show in it, and after an edit to the module it reads, it keeps running the old code until `next dev` restarts. A Peek in request code reads the same modules the page does. After an edit, it runs the old code until the next request evaluates its module again, so load a page after editing server code.

In Nuxt, start it in a Nitro server plugin, as the [Nuxt example](https://github.com/ayme-labs/ayme/blob/main/apps/example-nuxt/README.md#peeks) does.

The process finds the agent's server the way a tab does: it pairs only when exactly one Ayme MCP server answers on the ports from 9350 to 9365. While unpaired it looks again every few seconds, and again when its server goes away, so a dev server started before the agent pairs once the agent is up. With several servers running, name one with `agentConnection: { link }` or `{ port }`. Read these from your own environment if you need them; Ayme reads none. Component Peeks register only after mount in the browser, so server rendering adds none to the process. While the tab is paired with that server too, its Inspector lists the process's Peek Tools in the Node section of its Peek tools and runs them through the server. The [`@ayme-dev/mcp` README](https://github.com/ayme-labs/ayme/blob/main/packages/mcp/README.md#app-processes) covers the pairing and what happens when two App Processes offer one name.

## ayme.webMCP

`ayme.webMCP` (`AymeWebMcp`) is the session's WebMCP publication.

| Member                | Behavior                                                                                                                                                                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publicationStatus`   | `{ state, message }`. `state` is `disabled` (publication off), `waiting` (for a WebMCP driver), `active` (published), `unavailable` (no driver within two seconds), `failed` (such as two published tools sharing a name, or `@ayme-dev/webmcp` not installed) or `disposed` (the session stopped). |
| `subscribe(listener)` | Calls `listener` with each new status. Returns the function that unsubscribes.                                                                                                                                                                                                                      |
| `retryPublication()`  | Tries again after `unavailable` or `failed`. Pending attempts are shared, and an active publication is not repeated.                                                                                                                                                                                |

## createPage

`createPage(options?)` builds the browser Page the session drives by default. Its defaults are the Playwright settings the [build plugin](build-plugin.md) compiled in; each option you pass, `testIdAttribute`, `actionTimeout` or `navigationTimeout`, wins for that option only, so `createPage()` is exactly the default Page. Without either, `actionTimeout` is 1 second and `navigationTimeout` 30 seconds. `actionTimeout` also bounds element reads such as `boundingBox`, so an action on a locator that matches nothing fails instead of waiting forever. Navigation keeps its own default whatever `actionTimeout` is; pass `navigationTimeout` to change it. Pass a factory as `pageFactory` to own page construction: without the Vite plugin, with a timeout that differs from your build, or wrapped in your own instrumentation. A wrapper must keep the locators the runtime observes.

```ts
createAyme({ pageFactory: () => createPage({ actionTimeout: 500 }) });
```

## decisionEndpoint

`decisionEndpoint(url, options?)` returns a decision function for `goalLoop` that posts each `DecisionRequest` to your Decision Endpoint. It resolves function `headers`, passes `credentials`, and throws on a non-2xx response with its status and error text, or on a body that is not a decision response. The [Decision Endpoint reference](decision-endpoint.md) has the route contract and `createDecisionEndpoint`.

## Errors

Ayme's own failures are `AymeError` subclasses: `ToolInputError`, `RefResolutionError` and `RuntimeStateError`. [Errors](errors.md) says what each means and lists the messages.
