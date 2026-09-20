# @ayme-dev/webmcp

Expose selected Page Object Actions as WebMCP tools. Ordinary TypeScript POMs
remain the source of the behavior; no Ayme base class is required.

## Install

These packages are not published yet. The commands below describe registry
installation once released; before then use supplied package tarballs.

```sh
npm install @ayme-dev/webmcp
npm install -D @ayme-dev/unplugin-webmcp @playwright/test@~1.62.1
```

Use your project's package manager. Configure the
[compiler integration](https://github.com/ayme-labs/ayme/blob/main/packages/unplugin-webmcp/README.md),
then follow the framework integration README, currently
[Vue](https://github.com/ayme-labs/ayme/blob/main/packages/webmcp-vue/README.md).
Internal adapter packages are bundled; consumers do not install them separately.

## Expose an action

Keep the existing POM behavior and annotate the class and selected methods:

```ts
import { WebMCP } from "@ayme-dev/webmcp";
import type { Page } from "@playwright/test";

@WebMCP
export class GreetingPage {
  constructor(private readonly page: Page) {}

  @WebMCP.tool({ description: "Greet the visitor." })
  async greet(name: string) {
    await this.page.getByRole("textbox", { name: "Name" }).fill(name);
    await this.page.getByRole("button", { name: "Greet", exact: true }).click();
  }
}
```

Put annotated POMs in `.ts` files imported by the application. Enable
`compilerOptions.experimentalDecorators` in their TypeScript configuration.
Tool schemas come from method signatures. Public members are not automatically
published as tools. Keep browser-imported POMs free of Node-only code and
runtime test-runner imports, including decorators that call `test.step`.
Type-only Playwright imports are appropriate.

## Page state

After runtime setup and POM registration:

```ts
import { ayme } from "@ayme-dev/webmcp";
console.log((await ayme.getPageState()).text);
```

Page state works without WebMCP publication. Tool invocation through a browser
client also requires the driver and publication setup.

Pass `ignore` on the Vue composable or React provider to keep parts of the DOM
out of the Structural Page State. When the predicate returns `true` for an
element, that element and everything inside it are dropped from page state
capture. This affects page state only; it does not change which tools are
published. Polarity is the opposite of a Ref Tool's `filter`: `ignore` true
drops, `filter` true keeps.

```ts
useAymeWebMcp({
  ignore: (element) => element.matches("[data-assistant-panel]"),
});
```

## Coding agent skill

Copy this request into your coding agent:

> Install the `ayme` skill from https://github.com/ayme-labs/ayme/tree/main/skills/ayme into this project's skill directory, including its references. Then use it to set up Ayme WebMCP here.
