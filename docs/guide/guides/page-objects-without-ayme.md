# Page Objects on a page without ayme

How to let `ayme mcp` serve your Page Objects to a page whose app doesn't ship ayme, through Playwright MCP, Playwright CLI or agent-browser.

> **Experimental:** this may change in any release. See [Experimental APIs](../reference/experimental-apis.md).

When your agent drives the browser with Playwright MCP, Playwright CLI or agent-browser, `ayme mcp` can build your Page Objects and load them into any page, such as a staging site or an app you can't change. Register `ayme mcp` in your agent as in [Connect an agent](connect-an-agent.md#register-the-server-in-your-agent); you don't turn anything on in the page.

## Set it up

1. In the folder `ayme mcp` starts in, export your [Page Object](ayme-page-objects.md) classes from `ayme/page-objects.ts`, and keep their files in `ayme/pom/`. Install `@ayme-dev/ayme`, `@ayme-dev/mcp`, TypeScript and `@playwright/test` there, with TypeScript 7 also `@typescript/typescript6`, `@ayme-dev/ayme` at the same version as `@ayme-dev/mcp`. Give the folder its `tsconfig.json`, as step 2 of [The `ayme` folder](ayme-folder.md#set-the-folder-up-for-page-objects) shows; the `#pom/*` alias there is only for app code and tests that import the Page Objects. No build plugin is needed. `--page-objects <file>` after `mcp` names another entry.

   ```ts
   import type { AymeOptions } from "@ayme-dev/ayme";

   import { SignInPage } from "./pom/SignInPage";

   export default [SignInPage] satisfies AymeOptions["pageObjects"];
   ```

2. Start `ayme mcp`, by restarting your agent. It writes `ayme/init-script.js`, which names its port, and adds it to `ayme/.gitignore`.
3. Point your browser tool at the init script, so that it loads the script into every page before the page's own scripts. Playwright MCP and Playwright CLI take it in a config file, where a path is relative to the file's folder.

   ```json
   {
     "browser": {
       "initScript": ["ayme/init-script.js"],
       "launchOptions": { "channel": "chrome" },
       "contextOptions": {
         "bypassCSP": true,
         "permissions": ["local-network-access"]
       }
     }
   }
   ```

   Pass it to Playwright MCP in its registration, such as `npx -y @playwright/mcp@<version> --config=<file>`, or to Playwright CLI with `playwright-cli open --config <file> <url>`. Playwright CLI reads `.playwright/cli.config.json` by default, without `--config`; from that file, the init script is `../ayme/init-script.js`.

   `"channel": "chrome"` runs the Chrome installed on the machine. With `"browserName": "chromium"` and no channel, the browser tool runs Playwright's own Chromium, which it downloads first.

   agent-browser takes it as a flag: `agent-browser --init-script ayme/init-script.js open <url>`.

4. Ask the agent to call `ayme_connect` with the page's URL and open the link. The answer adds a line naming the init script. Once the page pairs, `ayme mcp` offers your Page Objects' tools; an agent whose tool list doesn't show them yet lists them with `ayme_list_tools` and runs them with `ayme_call`. While no build of the entry has succeeded, that line, and the answer to a page tool while no page is connected, give the build's first error instead. When the project's `@ayme-dev/ayme` is another version than `ayme mcp`'s, the build does not start, and that error names the command that installs the matching version.

`bypassCSP` lets a page with a Content Security Policy connect to `ayme mcp`. The `local-network-access` permission lets a page on a public site reach `127.0.0.1`; without it, Chrome blocks the connection when headless and waits on a permission prompt when headed.

## What to expect

- Playwright MCP and Playwright CLI refuse to start while the init script is missing, so start `ayme mcp` first in a fresh clone.
- The browser reads the init script when it starts. If it can start before `ayme mcp`, or outlive a restart on another port, add `--port <port>` to the `ayme mcp` registration so every start writes the same init script, then restart the browser once.
- After an edit, `ayme mcp` rebuilds and the open page swaps in the new Page Objects. A failed build is logged to `ayme mcp`'s standard error, and the page keeps the last good one.
- Chromium-based browsers only.
- Navigating to another origin needs a new `ayme_connect` link.
- On a page whose app already ships ayme, the app's own tools win over the served ones.
