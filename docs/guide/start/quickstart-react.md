# Quickstart: React

From a Vite React app to your first Page Object Tool, called from a Playwright test or a coding agent.

## 1. Install

```sh
npm install @ayme-dev/ayme @ayme-dev/react
npm install -D @ayme-dev/unplugin-ayme @playwright/test @ayme-dev/inspector
```

## 2. Add the build plugin

```ts
// vite.config.ts
import react from "@vitejs/plugin-react";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), ayme()],
});
```

Enable decorators in the tsconfig that covers your Page Object Models:

```json
{ "compilerOptions": { "experimentalDecorators": true } }
```

On Next.js, use the Turbopack loader instead, as the [build plugin reference](../reference/build-plugin.md#nextjs) shows.

## 3. Write a Page Object Model

```ts
// src/pom/CounterPage.ts
import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

@ayme
export class CounterPage {
  readonly incrementButton: Locator;

  constructor(page: Page) {
    this.incrementButton = page.getByRole("button", {
      name: "Increment",
      exact: true,
    });
  }

  @ayme.action({ description: "Increment the counter." })
  async increment() {
    await this.incrementButton.click();
  }
}
```

## 4. Start Ayme and use the Page Object

Wrap the app in `AymeProvider`, turn publication on, show the Inspector in development, and use the Page Object in a component:

```tsx
// src/main.tsx
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AymeProvider, usePageObject } from "@ayme-dev/react";
import { CounterPage } from "./pom/CounterPage";

function Counter() {
  const [count, setCount] = useState(0);
  const pom = usePageObject(CounterPage);
  return (
    <>
      <p>
        Count: <output>{count}</output>
      </p>
      <button onClick={() => setCount((value) => value + 1)}>Increment</button>
      <button onClick={() => void pom.increment()}>Call Page Object</button>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AymeProvider webMCP={{ enabled: true }} inspector={import.meta.env.DEV}>
      <Counter />
    </AymeProvider>
  </StrictMode>
);
```

Run the dev server. The Inspector opens on the page; its Tools lens lists `CounterPage.increment`, and running it increments the counter.

## 5. Call the tool

From a Playwright test, with a config whose `webServer` starts your dev server:

```ts
// tests/counter.spec.ts
import { expect, test } from "@playwright/test";
import {
  executePublishedTool,
  recordPublishedTools,
  waitForPublishedTool,
} from "@ayme-dev/ayme/testing";

test("CounterPage.increment is published and runs", async ({
  context,
  page,
}) => {
  await recordPublishedTools(context);
  await page.goto("/");
  await waitForPublishedTool(page, "CounterPage.increment");
  await executePublishedTool(page, "CounterPage.increment");
  await expect(page.locator("output")).toHaveText("1");
});
```

From a coding agent, connect it to the page through the WebMCP local relay, as [Connect an agent](../guides/connect-an-agent.md) shows, and ask it to call `CounterPage.increment`.

## Next

- [React](../frameworks/react.md): the provider, hooks and server rendering with Next.js.
- [Page Object Models](../guides/page-object-models.md): children, collections and tool names.
