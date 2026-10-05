# Example certification

The end-to-end certification that every framework's example app runs, written once. Each example's `playwright.config.ts` and spec are short calls into it, plus the example's framework-only tests. What the certification checks, and why every framework runs it, is on the [framework integrations page](../../docs/framework-integrations.md#example-app).

## Config

`certificationConfig` from `@ayme-dev/example-certification/config` builds an example's Playwright config: a free port kept across Playwright's workers, and the app's server for the run's mode. The example supplies only the command that serves it on that port. Against the dev server, a global setup loads the counter page and `/other` once before the tests, so no test pays for the dev server's first compile of a page.

The environment selects the mode, so an example has one config and its `test:e2e:*` scripts set the variables its `webServer` honours:

| Variable                     | Selects                             |
| ---------------------------- | ----------------------------------- |
| `AYME_E2E_SERVER=production` | the production build instead of dev |
| `AYME_E2E_RENDER=spa`        | the SPA instead of server rendering |

## Tests

From `@ayme-dev/example-certification/tests`, each builder defines plain Playwright tests, one assertion story each:

- `serverRenderTests()`: the server-rendered counter and its initial publication status on repeated requests, or no counter in SPA mode.
- `counterTests({ CounterPage, navigation? })`: the published schemas, an undecorated subclass, Ayme's own tools, the Page Object called from the app, its tool and Playwright, unmount and remount, the answer to a `click` that starts a full page load, to `navigate` to another page, to `navigate_back` from it and to `reload`, that page's published tools, and, with `navigation`, client navigation away and back.
- `devRebuildTests({ counterModePath })`: on the dev server only, editing `CounterMode.ts` rebuilds the published schema. Call it last: it edits a source file, and the dev server rebuilds after it.
- `agentConnectionTests({ enabled, snapshotText })`: where `enabled()` holds, a coding agent's MCP client pairs with `/` through a connect link and calls the page's `snapshot` tool; elsewhere, such as a production build, the page loads no Agent Connection code and opens no WebSocket. Every example runs it, gated as its app gates `agentConnection`.
- `test`: Playwright's `test`, failing on page errors, console errors and hydration warnings. Every builder except the dev rebuild and the Agent Connection uses it, and so do an example's own tests.

Tools are called through the recording WebMCP driver from `@ayme-dev/ayme/testing`, and the agent's side through `@ayme-dev/mcp/testing`.

## Counter contract

The builders drive this DOM, which each example renders on `/` beneath its runtime owner, with publication enabled:

- a `region` named `Counter`, holding the `output` with the count, starting at `0`, and the buttons `Increment` and `Call Page Object`, which increments through the Page Object;
- a `status` named `Publication`, reading `Publication: <state>`;
- a button `Unmount counter` that removes the region, which then reads `Mount counter` and mounts a new one;
- a link `Full page load` to `/other`, a page reading `Other page without Page Objects.`, which the browser loads as a new document, never through the client router; `/other` runs the runtime too, so it publishes Ayme's own tools;
- with `navigation`, a link to a page without Page Objects and a link back.

The Page Object Models live in the example's own source, because the build plugin compiles them only from there:

- `CounterMode.ts`: `export type CounterMode = "single" | "double";`
- `CounterPage.ts`: an `@ayme` class whose `increment` action, "Increment the counter.", clicks the `Increment` button, and whose `setMode(mode: CounterMode)` action is "Set counter mode metadata.";
- `SubCounterPage.ts`: `export class SubCounterPage extends CounterPage {}`, undecorated, registered by the counter beside `CounterPage`.
