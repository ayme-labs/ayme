# Page Objects on a page without Ayme

How to let `ayme mcp` serve your Page Objects to a page whose app doesn't ship Ayme, through Playwright MCP or Playwright CLI.

> **Experimental:** this may change in any release. See [Experimental APIs](../reference/experimental-apis.md).

When your agent drives the browser with Playwright MCP or Playwright CLI, `ayme mcp` can build your Page Objects and load them into any page, such as a staging site or an app you can't change. Register `ayme mcp` in your agent as in [Connect an agent](connect-an-agent.md#register-the-server-in-your-agent); you don't turn anything on in the page.

## Set it up

1. In the folder `ayme mcp` starts in, export your [Page Object](ayme-page-objects.md) classes from `.ayme/page-objects.ts`, and keep their files in `.ayme/pom/`. Install `@ayme-dev/ayme`, `@ayme-dev/mcp`, TypeScript and `@playwright/test` there, with a `tsconfig.json` whose `include` covers `.ayme/`, such as `".ayme/**/*.ts"`; plain `".ayme"` fails with TS18003, no inputs found. No build plugin is needed. `--page-objects <file>` after `mcp` names another entry.

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

4. Ask the agent to call `ayme_connect` with the page's URL and open the link. The answer adds a line naming the init script, and your Page Objects' tools become the agent's tools. While no build of the entry has succeeded, that line, and the answer to a page tool while no page is connected, give the build's first error instead.

To have the page also publish your Page Objects' tools through WebMCP, for a browser tool that calls a page's WebMCP tools such as Playwright CLI, add `--webmcp` after `mcp` in the registration, such as `npx -y @ayme-dev/mcp@<version> mcp --webmcp`. It is off by default, and `ayme mcp` refuses to start with it when there are no Page Objects to serve.

`bypassCSP` lets a page with a Content Security Policy connect to `ayme mcp`. The `local-network-access` permission lets a page on a public site reach `127.0.0.1`; without it, Chrome blocks the connection when headless and waits on a permission prompt when headed.

## What to expect

- Playwright MCP and Playwright CLI refuse to start while the init script is missing, so start `ayme mcp` first in a fresh clone.
- The browser reads the init script when it starts. If it can start before `ayme mcp`, or outlive a restart on another port, add `--port <port>` to the `ayme mcp` registration so every start writes the same init script, then restart the browser once.
- After an edit, `ayme mcp` rebuilds and the open page swaps in the new Page Objects. A failed build is logged to `ayme mcp`'s standard error, and the page keeps the last good one.
- Chromium-based browsers only.
- Navigating to another origin needs a new `ayme_connect` link.
- On a page whose app already ships Ayme, the app's own tools win over the served ones.
