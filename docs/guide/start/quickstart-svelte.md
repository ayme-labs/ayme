# Quickstart: Svelte

From a SvelteKit 2 app to your first Page Object Tool, called from a Playwright test or a coding agent.

## 1. Install

```sh
npm install @ayme-dev/ayme @ayme-dev/svelte
npm install -D @ayme-dev/unplugin-ayme @playwright/test @ayme-dev/inspector
```

## 2. Add the build plugin

```ts
// vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit(), ayme()],
});
```

Keep SvelteKit's generated tsconfig as the base and enable decorators:

```jsonc
// tsconfig.json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": { "experimentalDecorators": true },
}
```

SvelteKit 3 and plain Svelte apps differ only in this step; see [Svelte](../frameworks/svelte.md).

## 3. Write a Page Object Model

```ts
// src/lib/pom/CounterPage.ts
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

Start Ayme in the root layout, turn publication on and show the Inspector in development:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { dev } from "$app/environment";
  import { useAyme } from "@ayme-dev/svelte";

  let { children }: { children: Snippet } = $props();
  useAyme({ webMCP: { enabled: true }, inspector: dev });
</script>

{@render children()}
```

Use the Page Object in a page:

```svelte
<!-- src/routes/+page.svelte -->
<script lang="ts">
  import { usePageObject } from "@ayme-dev/svelte";
  import { CounterPage } from "$lib/pom/CounterPage";

  let count = $state(0);
  const pom = usePageObject(CounterPage);
</script>

<p>Count: <output>{count}</output></p>
<button onclick={() => (count += 1)}>Increment</button>
<button onclick={() => pom.increment()}>Call Page Object</button>
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

- [Svelte](../frameworks/svelte.md): SvelteKit 3, plain Svelte, Svelte 3 and 4 markup, and reading the runtime.
- [Page Object Models](../guides/page-object-models.md): children, collections and tool names.
