# Publish tools

How to start Ayme in your app and turn on WebMCP publication, so agents that run in the browser see your tools.

## Start Ayme

Your framework package starts Ayme at the root of your app and gives the rest of the app the running session, `ayme`. Vue and React wrap the app in `AymeProvider`, Svelte calls `useAyme` in the root component, and Angular adds `provideAyme()` to the application config. Each takes the same options, including `webMCP`:

```tsx
<AymeProvider webMCP={{ enabled: true }}>
  <App />
</AymeProvider>
```

Without a framework package, such as in a script on a page, create the session with `createAyme` and start it yourself:

```ts
import { createAyme } from "@ayme-dev/ayme";

const ayme = createAyme({ webMCP: { enabled: true } });
const stop = ayme.start();
```

One session owns the current document at a time. `start()` returns the function that stops it. The [`@ayme-dev/ayme` reference](../reference/ayme.md) lists every option.

## Register Page Objects

A Page Object's tools are listed while its class is registered and the Page Object is present, as [`@ayme`](ayme-page-objects.md#ayme) describes. Register pages at app setup, in the `pageObjects` option of `createAyme`, `AymeProvider`, `useAyme` or `provideAyme`. A page states its own presence from the URL, so it can be listed once with all the others. Its tools then come and go with the browser's location. The classes stay registered for the session's lifetime.

```ts
const ayme = createAyme({
  pageObjects: [ProjectsPage, SettingsPage],
  webMCP: { enabled: true },
});
const stop = ayme.start();
```

Register at a component instead when the model's presence is the component's lifetime and no page expression states it, such as a panel that is mounted on several routes, or when the model belongs in a route's chunk and must not load with the app. The framework hook in that component registers the class while the component lives and removes the registration when it unmounts. A Page Object Child needs no registration of its own: it is reached through the registered Page Object.

A registration counts, so a class registered at setup and in a component stays registered until both are gone. On the server, registration is inert; see [Server rendering](server-rendering.md).

## Turn publication on

Publication lives in its own package. Install it beside `@ayme-dev/ayme`, which declares it as an optional peer dependency:

```sh
npm install @ayme-dev/webmcp
```

The call that starts Ayme decides whether its tools are published through WebMCP.

- `webMCP.enabled` turns publication on. The session then loads `@ayme-dev/webmcp` when it starts in the browser; with the option off, the page requests none of its code. It is off unless set. Page Objects, page state and the Goal Loop work either way.
- `webMCP.toolNamePrefix` is prepended to every published tool name: `snapshot`, `goal`, the Browser Tools, Custom Tools and Page Object Tools. With `toolNamePrefix: "shop_"`, the agent sees `shop_snapshot` and `shop_ProjectsPage.openNewProjectDialog`. It is empty by default. It applies only at publication: `ayme.tools`, the Goal Loop and the Inspector use the unprefixed names.

```ts
createAyme({ webMCP: { enabled: true, toolNamePrefix: "shop_" } });
```

WebMCP publication is for agents that run in the browser and read the page's `document.modelContext`. A coding agent such as Claude Code, Codex or Cursor connects through Ayme's MCP server instead, with or without publication; see [Connect an agent](connect-an-agent.md).

## Give the page WebMCP

Chrome with the WebMCP flag supplies `document.modelContext` natively: open `chrome://flags/#enable-webmcp-testing`, enable the flag and relaunch, as [Chrome's WebMCP guide](https://developer.chrome.com/docs/ai/webmcp) describes. In any other browser, load a WebMCP polyfill, such as [`@mcp-b/global`](https://www.npmjs.com/package/@mcp-b/global) pinned to a version, before your app's entry module. If it loads after Ayme's initial wait, retry publication as [Publication status](#publication-status) describes.

## What gets published

With publication on, an agent sees `snapshot`, which returns the page state, the Browser Tools, your Custom Tools, the Page Object Tools of every registered Page Object on the page, and `goal` when the Goal Loop is configured. The set follows the page: a Page Object's tools appear when its class is registered and it is present, by its URL or its root, and disappear when it leaves. A tool whose action cannot run now stays published, and a call to it is refused with its reason. [`@ayme.action`](ayme-page-objects.md#aymeaction) shows one. The agent gets the refusal as an error result, as [Errors](../reference/errors.md#how-an-agent-sees-a-failure) shows.

## Publication status

`ayme.webMCP.publicationStatus` reports where publication stands. With publication on, its `state` reads:

| State         | When                                           |
| ------------- | ---------------------------------------------- |
| `waiting`     | No WebMCP driver has appeared yet.             |
| `active`      | A driver appeared and the tools are published. |
| `unavailable` | No driver appeared within two seconds.         |
| `failed`      | Publication failed.                            |

After `unavailable` or `failed`, `ayme.webMCP.retryPublication()` tries again. The framework packages hand out the same status in their own reactive form. [`ayme.webMCP`](../reference/ayme.md#aymewebmcp) lists every state.
