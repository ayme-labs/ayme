# Ayme

Ayme turns the Page Object Models your tests already use into tools that agents and tests call in your running app.

Mark a Page Object Model and the actions to expose, and each action becomes a tool, published to agents through WebMCP and callable from your Playwright tests. An agent can also hand Ayme a goal in natural language: the Goal Loop drives the page toward it, and each step is one judgement by Jev, TypeSafe's System One model, not by the calling agent's LLM.

<!--
Reserved for the Goal Loop clip and the comparison table. Both are added once
the eval work has produced them; until then this README makes no comparison.
-->

## Install

Install Ayme, your framework's package and the build plugin. `@playwright/test` supplies the `Page` and `Locator` types your Page Object Models use:

```sh
npm install @ayme-dev/ayme @ayme-dev/vue # or react, svelte
npm install -D @ayme-dev/unplugin-ayme @playwright/test
```

On Angular, one command sets it all up:

```sh
ng add @ayme-dev/angular
```

Mark the Page Object Model and the actions to expose:

```ts
import { ayme } from "@ayme-dev/ayme";
import type { Page } from "@playwright/test";

@ayme
export class GreetingPage {
  constructor(private readonly page: Page) {}

  @ayme.action({ description: "Greet the visitor." })
  async greet(name: string) {
    await this.page.getByRole("textbox", { name: "Name" }).fill(name);
    await this.page.getByRole("button", { name: "Greet" }).click();
  }
}
```

Then start Ayme in your app and register the Page Object, as your framework's page shows. A coding agent can do the setup for you: ask it to install the `ayme` skill from https://github.com/ayme-labs/ayme/tree/main/skills/ayme, including its references, and use it to set up Ayme in your project.

## Pick your framework

- [Vue](docs/guide/frameworks/vue.md)
- [React](docs/guide/frameworks/react.md)
- [Svelte](packages/svelte/README.md)
- [Angular](packages/angular/README.md)

Next.js, Nuxt and SvelteKit work with the React, Vue and Svelte packages, including server rendering.

## Documentation

The [documentation](docs/guide/README.md) starts with [what Ayme is](docs/guide/start/what-is-ayme.md) and [install](docs/guide/start/install.md), which lists the supported versions. The reference covers [Playwright in the browser](docs/guide/reference/playwright-in-the-browser.md), the Playwright calls your Page Object Models can make, and the [build plugin](docs/guide/reference/build-plugin.md).

## License

Ayme is [Fair Source](https://fair.io), licensed under the
[Functional Source License, Version 1.1, ALv2 Future License](LICENSE)
(FSL-1.1-ALv2). You may use, modify, and redistribute it for any purpose other
than a Competing Use, including in your own applications and products. Each
version becomes available under the Apache License 2.0 two years after its
release.

Bundled third-party code keeps its original license; see each package's
`THIRD_PARTY_NOTICES.txt`.
