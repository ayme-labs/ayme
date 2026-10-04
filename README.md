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

Then start Ayme in your app and use the Page Object, as the quickstart for [Vue](docs/guide/start/quickstart-vue.md), [React](docs/guide/start/quickstart-react.md), [Svelte](docs/guide/start/quickstart-svelte.md) or [Angular](docs/guide/start/quickstart-angular.md) shows. A coding agent can do the setup for you with the [`ayme` skill](docs/guide/guides/coding-agent-skill.md).

## Pick your framework

- [Vue](docs/guide/frameworks/vue.md)
- [React](docs/guide/frameworks/react.md)
- [Svelte](docs/guide/frameworks/svelte.md)
- [Angular](docs/guide/frameworks/angular.md)

Next.js, Nuxt and SvelteKit work with the React, Vue and Svelte packages, including server rendering.

## Documentation

The [documentation](docs/guide/README.md) is a folder of pages in this repository, grouped as [Start](docs/guide/README.md#start), [Guides](docs/guide/README.md#guides), [Frameworks](docs/guide/README.md#frameworks), [Reference](docs/guide/README.md#reference) and [Troubleshooting](docs/guide/troubleshooting.md).

## License

Ayme is [Fair Source](https://fair.io), licensed under the
[Functional Source License, Version 1.1, ALv2 Future License](LICENSE)
(FSL-1.1-ALv2). You may use, modify, and redistribute it for any purpose other
than a Competing Use, including in your own applications and products. Each
version becomes available under the Apache License 2.0 two years after its
release.

Bundled third-party code keeps its original license; see each package's
`THIRD_PARTY_NOTICES.txt`.
