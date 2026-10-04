# @ayme-dev/react

React integration for Ayme. It supports React 18 and 19, client-rendered or server-rendered with hydration. The [Next.js example](https://github.com/ayme-labs/ayme/tree/main/apps/example-next) shows server rendering with Next.js 16 and later.

## Install

```sh
npm install @ayme-dev/ayme @ayme-dev/react
npm install -D @ayme-dev/unplugin-ayme @playwright/test@~1.62.1
```

## Vite setup

Use `@ayme-dev/unplugin-ayme/vite` alongside the React Vite plugin:

```ts
import react from "@vitejs/plugin-react";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), ayme()],
});
```

Keep decorated Page Object Models in separate `.ts` files. Enable `experimentalDecorators` in your TypeScript configuration. Use `@ayme` on the model and `@ayme.action` on exposed actions, as shown in [CounterPage](https://github.com/ayme-labs/ayme/blob/main/apps/example-react/playwright/pom/CounterPage.ts).

Publication is off unless the provider enables it with `webMCP={{ enabled: true }}`. `webMCP.toolNamePrefix` prefixes every published tool name; see the [Publish tools guide](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/publish-tools.md). Local Page Object calls work without a WebMCP driver, including when publication is off.

## Root setup

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AymeProvider } from "@ayme-dev/react";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AymeProvider webMCP={{ enabled: true }}>
      <App />
    </AymeProvider>
  </StrictMode>
);
```

The provider creates a Page for the current document. To use a custom or decorated Page, pass a factory, `pageFactory={() => customPage}`; the runtime calls it once, in the browser, on first use, and never during server rendering. `createPage(options)` from `@ayme-dev/ayme` builds the default Page with your own settings. Ayme observation requires the browser adapter's locator metadata; a wrapper must preserve it. An arbitrary object typed as Playwright `Page` is not sufficient for observation.

Pass `ignore={ignorePageState}` to keep matching elements and their descendants out of the Structural Page State:

```ts
const ignorePageState = (element: Element) =>
  element.matches("[data-assistant-panel]");
```

When the predicate returns `true`, the matching subtree is dropped from page state capture. This affects page state only; it does not change which tools are published.

The `pageFactory`, `ignore` predicate and `webMCP` settings must stay fixed while the provider is mounted. Remount the provider and its consumers to change either option. Only one runtime owner may be active. Nested providers and concurrent owners are rejected.

## Page Objects, the session, and publication

Call the hooks in descendants of the provider:

```tsx
import { useAyme, usePageObject } from "@ayme-dev/react";
import { CounterPage } from "./playwright/pom/CounterPage";

export default function Controls() {
  const pom = usePageObject(CounterPage);
  const { ayme, webMCP } = useAyme();

  return (
    <>
      <p>{webMCP.publicationStatus.message}</p>
      <button onClick={() => void pom.increment()}>
        Increment through POM
      </button>
      <button onClick={() => void webMCP.retryPublication()}>
        Retry publication
      </button>
    </>
  );
}
```

`ayme` is the runtime session, so `ayme.pursueGoal(goal, { maxSteps })` runs a goal. `webMCP` is the session's `webMCP` member as React state: `webMCP.publicationStatus` is a read-only snapshot that updates with React renders. Its state is `disabled`, `waiting`, `active`, `unavailable`, `failed`, or `disposed`. Enabled publication waits up to two seconds for a driver. Retry starts another attempt after unavailability or failure; pending attempts are shared and an active publication is not duplicated.

`usePageObject` returns the concrete instance immediately. Constructors must only initialize fields and compose locators: do not execute actions, register listeners, or start other activity in them. React can discard render-time construction. Committed instances stay the same across rerenders and Strict Mode effect replay. A real unmount/remount creates a new instance. Changing the model class requires remounting the consuming component.

Registration and publication happen after commit. Unmounting a consumer removes its registration; unmounting the provider stops publication and observation. Provider cleanup/setup replay preserves the Page and retained instances. Hooks without an ancestor provider throw. A provider returned from a component does not supply context to hooks called in that same component.

## Framework parity

Vue exposes the same provider, `useAyme`, `usePageObject`, and `{ ayme, webMCP }` return value. Vue additionally supports standalone `useAyme({ pageFactory })` root setup. React requires the provider and does not expose global bootstrap configuration.

## Smoke example

From the workspace root, run `pnpm run build`, then `pnpm --filter @ayme-dev/example-react dev`. The [small example](https://github.com/ayme-labs/ayme/tree/main/apps/example-react) verifies direct Page Object calls, Page Object Tool execution, and mount/unmount registration. Run it with `pnpm --filter @ayme-dev/example-react test:e2e`.
