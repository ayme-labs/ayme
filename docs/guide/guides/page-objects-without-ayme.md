# Page Objects on a page without Ayme

How to let `ayme mcp` serve your Page Objects to a page whose app doesn't ship Ayme, through Playwright MCP or Playwright CLI.

> **Experimental:** this may change in any release. See [Experimental APIs](../reference/experimental-apis.md).

When your agent drives the browser with Playwright MCP or Playwright CLI, `ayme mcp` can build your Page Objects and load them into any page, such as a staging site or an app you can't change. Register `ayme mcp` in your agent as in [Connect an agent](connect-an-agent.md#register-the-server-in-your-agent); you don't turn anything on in the page.

## Set it up

1. In the folder `ayme mcp` starts in, export your [Page Object](ayme-page-objects.md) classes from `.ayme/page-objects.ts`, and keep their files in `.ayme/pom/`. Install `@ayme-dev/ayme`, `@ayme-dev/mcp`, TypeScript and `@playwright/test` there, with a `tsconfig.json` that covers `.ayme/`; no build plugin is needed. `--page-objects <file>` after `mcp` names another entry.

   ```ts
   import type { AymeOptions } from "@ayme-dev/ayme";

   import { SignInPage } from "./pom/SignInPage";

   export default [SignInPage] satisfies AymeOptions["pageObjects"];
   ```

2. Start `ayme mcp`, by restarting your agent. It writes `.ayme/init-script.js`, which names its port, and adds it to `.ayme/.gitignore`.
3. Point your browser tool at the init script in its config file. A path in the file is relative to the file's folder.

   ```json
   {
     "browser": {
       "initScript": [".ayme/init-script.js"],
       "contextOptions": {
         "bypassCSP": true,
         "permissions": ["local-network-access"]
       }
     }
   }
   ```

   Pass it to Playwright MCP with `--config <file>` in its registration, or to Playwright CLI with `playwright-cli open --config <file> <url>`.

4. Ask the agent to call `ayme_connect` with the page's URL and open the link. The answer adds a line naming the init script, and your Page Objects' tools become the agent's tools.

`bypassCSP` lets a page with a Content Security Policy connect to `ayme mcp`. The `local-network-access` permission lets a page on a public site reach `127.0.0.1`; without it, Chrome blocks the connection when headless and waits on a permission prompt when headed.

## Publish through WebMCP too

Add `--webmcp` after `mcp` in the registration, and each start writes an init script that also starts the served runtime with `webMCP: { enabled: true }`. A page that loads it then publishes your Page Objects' tools through WebMCP as well, for an agent that reads the page's `document.modelContext`, while `ayme mcp` offers the same tools as before. It is off unless set.

Install `@ayme-dev/webmcp` beside `@ayme-dev/ayme`, and give the page a WebMCP driver, as [Publish tools](publish-tools.md#give-the-page-webmcp) describes. `ayme mcp` refuses to start with `--webmcp` when it has no entry to serve.

## Offer the Page Object Tools alone

Add `--only-page-object-tools` after `mcp` in the registration when the agent keeps its own browser tool for everything else. `ayme mcp` then lists the Page Object Tools of the screen the page is on and the read tool `page_objects`, and nothing else: no `snapshot`, no [Browser Tool](../reference/browser-tools.md), and none of its own tools. It is off unless set, and `ayme mcp` refuses to start with it when it has no entry to serve.

Each tool has the name, description and input schema it has when [published through WebMCP](publish-tools.md), and the same answer:

- A Page Object action answers `{ settled, result?, url?, loading?, changes? }`: whether the page settled, what the action returned, the new URL when it changed, what was still loading, and under `changes` how the Page Object instances on the screen changed. It carries no Change Record.
- `page_objects` answers with the Page Object instances on the screen as text. A tool of a Page Object with several instances takes the `po<n>` ref that text shows.
- A refused call says why, and nothing else.

The init script sets this with the session option `agentConnection: { tools: "page-objects" }`, so the page hands `ayme mcp` the tools its WebMCP publication has. `--webmcp` can be set beside it.

- The agent has no `ayme_connect`, so the page has to pair by itself: on `localhost` or `127.0.0.1`, with exactly one Ayme MCP server running.
- The agent's tool list changes with the screen. An agent that reads its tool list once sees the tools of the screen it started on only.
- The tools of an [App Process](server-rendering.md#server-state) are not listed.
- A page whose app ships Ayme itself hands `ayme mcp` the tools its own session was started with, whatever the init script says.

## What to expect

- Playwright MCP and Playwright CLI refuse to start while the init script is missing, so start `ayme mcp` first in a fresh clone.
- The browser reads the init script when it starts. If it can start before `ayme mcp`, or outlive a restart on another port, add `--port <port>` to the `ayme mcp` registration so every start writes the same init script, then restart the browser once.
- After an edit, `ayme mcp` rebuilds and the open page swaps in the new Page Objects. A failed build is logged to `ayme mcp`'s standard error, and the page keeps the last good one.
- Chromium-based browsers only.
- Navigating to another origin needs a new `ayme_connect` link, which an agent started with `--only-page-object-tools` cannot ask for.
- On a page whose app already ships Ayme, the app's own tools win over the served ones.
