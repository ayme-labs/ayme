# @ayme-dev/webmcp-react

React integration for Ayme WebMCP. This first version supports React 19 in client-rendered Vite applications. Next.js and server rendering are not supported yet.

## Vite setup

Use `@ayme-dev/unplugin-webmcp/vite` alongside the React Vite plugin:

```ts
import react from "@vitejs/plugin-react";
import { aymeWebMcp } from "@ayme-dev/unplugin-webmcp/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), aymeWebMcp({ publish: true })],
});
```

Keep decorated Page Object Models in separate `.ts` files. Enable `experimentalDecorators` in your TypeScript configuration. Use `@WebMCP` on the model and `@WebMCP.tool(...)` on exposed actions, as shown in [CounterPage](../../apps/example-react/playwright/pom/CounterPage.ts).

Publication is disabled unless the Vite plugin enables it. Local Page Object calls work without a WebMCP driver, including when publication is disabled.

## Root setup

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AymeWebMcpProvider } from "@ayme-dev/webmcp-react";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AymeWebMcpProvider>
      <App />
    </AymeWebMcpProvider>
  </StrictMode>
);
```

The provider creates a Page for the current document. To use a custom or decorated Page, create it once and pass `page={customPage}`. Ayme observation requires the browser adapter's locator metadata; a wrapper must preserve it. An arbitrary object typed as Playwright `Page` is not sufficient for observation.

Pass `ignore={ignorePageState}` to keep matching elements and their descendants out of the Structural Page State:

```ts
const ignorePageState = (element: Element) =>
  element.matches("[data-assistant-panel]");
```

When the predicate returns `true`, the matching subtree is dropped from page state capture. This affects page state only; it does not change which tools are published.

The Page and `ignore` predicate must stay fixed while the provider is mounted. Remount the provider and its consumers to change either option. Only one runtime owner may be active. Nested providers and concurrent owners are rejected.

## Page Objects, status, and retry

Call the hooks in descendants of the provider:

```tsx
import { useAymeWebMcp, usePageObject } from "@ayme-dev/webmcp-react";
import { CounterPage } from "./playwright/pom/CounterPage";

export default function Controls() {
  const pom = usePageObject(CounterPage);
  const { publicationStatus, retryPublication } = useAymeWebMcp();

  return (
    <>
      <p>{publicationStatus.message}</p>
      <button onClick={() => void pom.increment()}>
        Increment through POM
      </button>
      <button onClick={() => void retryPublication()}>Retry publication</button>
    </>
  );
}
```

`publicationStatus` is a read-only snapshot that updates with React renders. Its state is `disabled`, `waiting`, `active`, `unavailable`, `failed`, or `disposed`. Enabled publication waits up to two seconds for a driver. Retry starts another attempt after unavailability or failure; pending attempts are shared and an active publication is not duplicated.

`usePageObject` returns the concrete instance immediately. Constructors must only initialize fields and compose locators: do not execute actions, register listeners, or start other activity in them. React can discard render-time construction. Committed instances stay the same across rerenders and Strict Mode effect replay. A real unmount/remount creates a new instance. Changing the model class requires remounting the consuming component.

Registration and publication happen after commit. Unmounting a consumer removes its registration; unmounting the provider stops publication and observation. Provider cleanup/setup replay preserves the Page and retained instances. Hooks without an ancestor provider throw. A provider returned from a component does not supply context to hooks called in that same component.

## Framework parity

Vue exposes the same provider, `usePageObject`, and status/retry names. Vue additionally retains standalone `useAymeWebMcp({ page })` setup for compatibility. React requires the provider and does not expose global bootstrap configuration.

## Smoke example

From the workspace root, run `pnpm run build`, then `pnpm --filter @ayme-dev/example-react dev`. The [small example](../../apps/example-react) verifies direct Page Object calls, generated tool execution, and mount/unmount registration. Run it with `pnpm --filter @ayme-dev/example-react test:e2e`.
