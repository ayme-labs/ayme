# @ayme-dev/ayme

Ayme turns the Page Object Models your tests already use into tools that agents and tests call in your running app. Mark a model and its actions, and each action becomes a Page Object Tool, published through WebMCP and runnable from your own code and tests.

## Install

```sh
npm install @ayme-dev/ayme @ayme-dev/vue # or react, svelte, angular
npm install -D @ayme-dev/unplugin-ayme @playwright/test
```

The [build plugin](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/build-plugin.md) compiles your Page Object Models into the browser build. On Angular, `ng add @ayme-dev/angular` installs and sets up all of it.

## Mark a Page Object Model

```ts
import { ayme } from "@ayme-dev/ayme";
import type { Page } from "@playwright/test";

@ayme
export class GreetingPage {
  constructor(private readonly page: Page) {}

  @ayme.action({ description: "Greet the visitor." })
  async greet(name: string) {
    await this.page.getByRole("textbox", { name: "Name" }).fill(name);
    await this.page.getByRole("button", { name: "Greet", exact: true }).click();
  }
}
```

`GreetingPage.greet` is now a Page Object Tool. Enable `compilerOptions.experimentalDecorators` in the tsconfig of your Page Object Models.

## Start Ayme

Your framework package starts Ayme at the root of your app: `AymeProvider` in Vue and React, `useAyme` in Svelte, `provideAyme()` in Angular. Without one, create and start the session yourself:

```ts
import { createAyme } from "@ayme-dev/ayme";

const ayme = createAyme({ webMCP: { enabled: true } });
const stop = ayme.start();

ayme.pom.register(GreetingPage);
await ayme.tools.run("GreetingPage.greet", { name: "Ada" });
```

## Documentation

- [Page Object Models](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-object-models.md): marking models and actions, tool names, children and collections.
- [Publish tools](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/publish-tools.md): starting Ayme and turning WebMCP publication on.
- [Page state](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-state.md): the Structural Page State, Structural Refs and interaction history.
- [Custom Tools](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/custom-tools.md): operations of your own on one element.
- [Connect an agent](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md): try your tools from a coding agent through the WebMCP local relay.
- [Test your integration](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/test-your-integration.md): list and call the published tools from Playwright tests.
- [Goals with Jev](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/goals-with-jev.md): let a decision model drive the page toward a goal, through your Decision Endpoint.
- [Browser Tools](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/browser-tools.md), [errors](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/errors.md) and the [Decision Endpoint contract](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/decision-endpoint.md)
- [`@ayme-dev/ayme` reference](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/ayme.md)
- [Ayme documentation](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md)

## Supported versions

`@playwright/test` 1.29 to 1.62, optional, for the types your Page Object Models use. [Install](https://github.com/ayme-labs/ayme/blob/main/docs/guide/start/install.md) lists the supported frameworks, Node.js and TypeScript versions.

## License

[FSL-1.1-ALv2](https://github.com/ayme-labs/ayme/blob/main/LICENSE). Bundled third-party code keeps its original license; see `THIRD_PARTY_NOTICES.txt` in the package.
