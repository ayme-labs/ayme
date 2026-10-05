# Publish tools

How to start Ayme in your app and turn on WebMCP publication, so agents connected to the page see your tools.

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

## Turn publication on

The call that starts Ayme decides whether its tools are published through WebMCP.

- `webMCP.enabled` turns publication on. It is off unless set. Page Objects, page state and the Goal Loop work either way.
- `webMCP.toolNamePrefix` is prepended to every published tool name: the agent's tools, Browser Tools, Custom Tools and Page Object Tools. It is empty by default. It applies at publication only: `ayme.tools`, the Goal Loop and the Inspector use the unprefixed names.

```ts
createAyme({ webMCP: { enabled: true, toolNamePrefix: "shop_" } });
```

## What gets published

With publication on, an agent sees `snapshot`, which returns the page state, the Browser Tools, your Custom Tools, the Page Object Tools of every registered Page Object that is available, and `goal` when the Goal Loop is configured. The set follows the page: a Page Object's tools appear when its class is registered and its root is available, and disappear when they are not.

## Publication status

`ayme.webMCP.publicationStatus` reports where publication stands. With publication on, it reads `waiting` until a WebMCP driver appears, then `active`; `unavailable` when none appeared within two seconds and `failed` when publication failed, and `retryPublication()` tries again after either. The framework packages hand out the same status in their own reactive form, and [`ayme.webMCP`](../reference/ayme.md#aymewebmcp) lists every state.
