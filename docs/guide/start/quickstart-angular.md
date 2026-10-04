# Quickstart: Angular

From an Angular app to your first Page Object Tool, called from a Playwright test or a coding agent.

## 1. Install and configure

```sh
ng add @ayme-dev/angular
npm install -D @ayme-dev/inspector
```

`ng add` installs Ayme, the build plugin and `@playwright/test`, switches the build and serve builders to `@angular-builders/custom-esbuild`, adds the plugin, and adds `provideAyme()` to the application config. New Angular workspaces already enable `experimentalDecorators`. [Angular](../frameworks/angular.md) lists the manual steps.

## 2. Write a Page Object Model

```ts
// playwright/pom/CounterPage.ts
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

## 3. Start Ayme and use the Page Object

Turn publication on and show the Inspector in development where `ng add` added `provideAyme()`:

```ts
// src/app/app.config.ts
import { ApplicationConfig, isDevMode } from "@angular/core";
import { provideAyme } from "@ayme-dev/angular";

export const appConfig: ApplicationConfig = {
  providers: [
    provideAyme({ webMCP: { enabled: true }, inspector: isDevMode() }),
  ],
};
```

Use the Page Object in a component:

```ts
// src/app/counter.ts
import { Component, signal } from "@angular/core";
import { injectPageObject } from "@ayme-dev/angular";
import { CounterPage } from "../../playwright/pom/CounterPage";

@Component({
  selector: "app-counter",
  template: `
    <p>
      Count: <output>{{ count() }}</output>
    </p>
    <button (click)="count.set(count() + 1)">Increment</button>
    <button (click)="pom.increment()">Call Page Object</button>
  `,
})
export class Counter {
  protected readonly count = signal(0);
  protected readonly pom = injectPageObject(CounterPage);
}
```

Render `<app-counter />` in your app and run `ng serve`. The Inspector opens on the page; its Tools lens lists `CounterPage.increment`, and running it increments the counter.

## 4. Call the tool

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

- [Angular](../frameworks/angular.md): manual setup, the API, server rendering and bundle size.
- [Page Object Models](../guides/page-object-models.md): children, collections and tool names.
