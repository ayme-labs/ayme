# @ayme-dev/ayme

Ayme turns the Page Object Models from your Playwright tests into tools that coding agents and your own app call in the running page. Mark a model and its actions, and each action becomes a Page Object Tool, published through WebMCP and runnable from your own code.

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
export class ProjectsPage {
  constructor(private readonly page: Page) {}

  @ayme.action({ description: "Create a project with the given name." })
  async createProject(name: string) {
    await this.page.getByRole("button", { name: "New project" }).click();
    await this.page.getByRole("textbox", { name: "Project name" }).fill(name);
    await this.page.getByRole("button", { name: "Create" }).click();
  }
}
```

`ProjectsPage.createProject` is now a Page Object Tool. Enable `compilerOptions.experimentalDecorators` in the tsconfig of your Page Object Models.

## Start Ayme

Your framework package starts Ayme at the root of your app: `AymeProvider` in Vue and React, `useAyme` in Svelte, `provideAyme()` in Angular. Without one, create and start the session yourself:

```ts
import { createAyme } from "@ayme-dev/ayme";

const ayme = createAyme({ webMCP: { enabled: true } });
const stop = ayme.start();

ayme.pom.register(ProjectsPage);
await ayme.tools.run("ProjectsPage.createProject", { name: "Launch plan" });
```

Every call of a tool is a Run, started by a Caller. `ayme.tools.run` runs as the app by default; pass `by` to name another Caller, such as your in-app assistant:

```ts
await ayme.tools.run(
  "ProjectsPage.createProject",
  { name: "Launch plan" },
  { by: "support-assistant" }
);
```

A Caller name is any non-empty string; an empty one throws a `RuntimeStateError`. Name yours in lowercase kebab-case; Ayme does not enforce it. Ayme's own Callers use the names in `callers`: `app`, `webmcp` (WebMCP publication), `ayme-mcp` (the Ayme MCP server) and `inspector`.

## Peek at app state

While a coding agent or the Inspector is connected, `ayme.peek` lets the agent read state the page does not show. Each name becomes a Peek Tool, `peek.<name>`, which reads the values when the agent calls it:

```ts
const ayme = createAyme({ agentConnection: true });
ayme.start();

const removeCart = ayme.peek(() => cartStore.getState(), "cart");
await ayme.tools.run("peek.cart", {}); // { name: "cart", instances: [{ values: … }] }
```

`read` may be async. Pass an id as the third argument for one instance per id, such as one per mounted component; without one, a later call replaces the earlier one. The returned function removes the instance. Peeks do nothing unless the session has `agentConnection` or `inspector` on, and WebMCP never publishes them. The [reference](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/ayme.md#aymepeek) has the details.

## Peek at server state

Your app's own Node processes, such as its dev server or an Express backend, can offer Peeks too, as `peek.node.<name>`. Install `@ayme-dev/mcp` beside `@ayme-dev/ayme` there, and start Ayme once, in the server's entry point: the session becomes the process's App Process, and a process has one. An Express backend, in `server/ayme.ts`:

```ts
import { createAyme } from "@ayme-dev/ayme";

import { sessions } from "./sessions";

export const ayme = createAyme({
  agentConnection: process.env.NODE_ENV !== "production",
});
ayme.start(); // pairs with the agent's server only with agentConnection

ayme.peek(() => ({ active: sessions.size }), "sessions"); // peek.node.sessions
```

The [reference](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/ayme.md#in-node) covers Next.js's `instrumentation.ts`, how the process finds the agent's server, and the Inspector's Node section.

## Documentation

- [Page Object Models](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-object-models.md): marking models and actions, tool names, children and collections.
- [Publish tools](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/publish-tools.md): starting Ayme and turning WebMCP publication on.
- [Page state](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-state.md): the Structural Page State, Structural Refs and interaction history.
- [Custom Tools](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/custom-tools.md): operations of your own on one element.
- [Connect an agent](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md): try your tools from a coding agent through the WebMCP local relay.
- [Goals with Jev](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/goals-with-jev.md): let a decision model drive the page toward a goal, through your Decision Endpoint.
- [Browser Tools](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/browser-tools.md), [errors](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/errors.md) and the [Decision Endpoint contract](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/decision-endpoint.md)
- [`@ayme-dev/ayme` reference](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/ayme.md)
- [Ayme documentation](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md)

## Supported versions

`@playwright/test` 1.29 to 1.62, optional, for the types your Page Object Models use. [Install](https://github.com/ayme-labs/ayme/blob/main/docs/guide/start/install.md) lists the supported frameworks, Node.js and TypeScript versions.

## License

[FSL-1.1-ALv2](https://github.com/ayme-labs/ayme/blob/main/LICENSE). Bundled third-party code keeps its original license; see `THIRD_PARTY_NOTICES.txt` in the package.
