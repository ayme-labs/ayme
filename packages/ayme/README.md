# @ayme-dev/ayme

Ayme turns the Page Object Models from your Playwright tests into tools that coding agents and your own app call in the running page. Mark a model and its actions, and each action becomes a Page Object Tool, published through WebMCP and runnable from your own code.

## Install

```sh
npm install @ayme-dev/ayme @ayme-dev/webmcp @ayme-dev/vue # or react, svelte, angular
npm install -D @ayme-dev/unplugin-ayme @playwright/test
```

The [build plugin](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/build-plugin.md) compiles your Page Object Models into the browser build. On Angular, `ng add @ayme-dev/angular` installs and sets up all of it.

## Mark a Page Object Model

```ts
import { ayme } from "@ayme-dev/ayme";
import type { Page } from "@playwright/test";

@ayme
export class ProjectsPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

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

`webMCP` publishes the tools through WebMCP, for agents that run in the browser, with `@ayme-dev/webmcp`.

Every call of a tool is a Run, started by a Caller. `ayme.tools.run` runs as the app by default; pass `by` to name another Caller, such as your in-app assistant:

```ts
await ayme.tools.run(
  "ProjectsPage.createProject",
  { name: "Launch plan" },
  { by: "support-assistant" }
);
```

A Caller name is any non-empty string; an empty one throws a `RuntimeStateError`. Name yours in lowercase kebab-case; Ayme does not enforce it. Ayme's own Callers use the names in `callers`: `app`, `webmcp` (WebMCP publication), `ayme-mcp` (the Ayme MCP server) and `inspector`.

Each Caller name has its own Change Record cursor: the page that Caller last received, through `snapshot` or as the Settled Page of its last action, is where its next action's Change Record starts. Two Callers under one name share one cursor. An action's result carries the record in two parts: `changes_before`, what changed since the Caller last received the page, on its own or by another Caller, and `changes`, what the action changed; `page_changed` is true when either has a change.

Runs take turns: the page runs one at a time, whichever Caller starts it. An action's turn ends once the page has settled; a read such as `snapshot` or a Peek Tool waits its turn without a settle wait. Don't call `ayme.tools.run` from inside a tool while it runs: that Run waits behind the tool's own and never starts. A Custom Tool uses the `run` in its context instead, `execute(target, { run })`: each tool it starts that way is a child Run, which runs inside its turn, after the child Runs it started before. The `goal` tool runs each step's tool as a child Run too.

Ayme keeps a log of the page's Runs, `ayme.runs`, whoever started them. `list()` returns the newest 200 top-level Runs with their child Runs, oldest first, each a `Run` with its `id`, `tool`, `input`, Caller (`by`) or, for a child Run, its parent's id (`parent`), `status` (`"running"`, `"succeeded"` or `"failed"`), its `result` as JSON captured when it returned (absent for `undefined`) or its `error` text, `startedAt`, `durationMs`, and the `interactions` it performed itself on the page (each a click, fill, key press, hover, selection, or keyboard or mouse input, with its `operation`, and its `locator` or `value` when it has one; waits, assertions, scrolls, focus changes and navigations are not Interactions). `subscribe(listener)` calls `listener` with the new list when a Run starts, gains an Interaction, or ends, and returns the function that unsubscribes. A new document starts an empty log.

```ts
const unsubscribe = ayme.runs.subscribe((runs) => {
  for (const run of runs) console.log(run.by, run.tool, run.status);
});
```

## Peek at app state

While a coding agent or the Inspector is connected, `ayme.peek` lets the agent read state the page does not show. Each name becomes a Peek Tool, `peek.<name>`, which reads the values when the agent calls it:

```ts
const ayme = createAyme({ agentConnection: true });
ayme.start();

const removeCart = ayme.peek(() => cartStore.getState(), "cart");
await ayme.tools.run("peek.cart", {}); // { name: "cart", instances: [{ values: … }] }
```

`read` may be async. Pass an id as the third argument for one instance per id, such as one per mounted component; without one, a later call replaces the earlier one. The returned function removes the instance. Peeks do nothing unless the session has `agentConnection` on, or `inspector` in the browser, and WebMCP never publishes them. The [reference](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/ayme.md#aymepeek) has the details.

## Peek at server state

Your app's own Node processes, such as its dev server or an Express backend, can offer Peeks too, as `peek.node.<name>`. Install `@ayme-dev/mcp` beside `@ayme-dev/ayme` there, and start Ayme once, in the server's entry point: the session becomes the process's App Process, and a process has one. The sessions your framework package creates to render on the server never claim it. An Express backend, in `server/ayme.ts`:

```ts
import { createAyme } from "@ayme-dev/ayme";

import { sessions } from "./sessions";

export const ayme = createAyme({
  agentConnection: process.env.NODE_ENV !== "production",
});
ayme.start(); // pairs with the agent's server only with agentConnection

ayme.peek(() => ({ active: sessions.size }), "sessions"); // peek.node.sessions
```

The [reference](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/ayme.md#in-node) covers where Peeks live in Next.js (not in `instrumentation.ts`), how the process finds the agent's server, and the Inspector's Node section.

## Documentation

- [Page Object Models](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-object-models.md): marking models and actions, tool names, children and collections.
- [Publish tools](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/publish-tools.md): starting Ayme and turning WebMCP publication on.
- [Page state](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-state.md): the Structural Page State, Structural Refs and interaction history.
- [Custom Tools](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/custom-tools.md): operations of your own on one element.
- [Connect an agent](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md): let a coding agent call your tools through Ayme's MCP server.
- [Goals with Jev](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/goals-with-jev.md): let a decision model drive the page toward a goal, through your Decision Endpoint.
- [Browser Tools](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/browser-tools.md), [errors](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/errors.md) and the [Decision Endpoint contract](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/decision-endpoint.md)
- [`@ayme-dev/ayme` reference](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/ayme.md)
- [Ayme documentation](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md)

## Supported versions

`@playwright/test` 1.29 to 1.64, optional, for the types your Page Object Models use. [Install](https://github.com/ayme-labs/ayme/blob/main/docs/guide/start/install.md) lists the supported frameworks, Node.js and TypeScript versions.

## License

[FSL-1.1-ALv2](https://github.com/ayme-labs/ayme/blob/main/LICENSE). Bundled third-party code keeps its original license; see `THIRD_PARTY_NOTICES.txt` in the package.
