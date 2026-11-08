# Browser setup

Set up the connection as [Connect an agent](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md)
describes: `agentConnection` on behind the app's dev flag, and Ayme's MCP
server registered in your agent, pinned to the project's `@ayme-dev/mcp`
version. Diagnose with the "The agent cannot reach the page" section of
[Troubleshooting](https://github.com/ayme-labs/ayme/blob/main/docs/guide/troubleshooting.md).
For using the page's tools once it is connected, such as a ref that fails to
resolve or an unavailable tool's reason, read [Page tools](page-tools.md).

- The server's tools reach you only after your client restarts. When you
  cannot register the server or restart yourself, give the user the
  registration for your client and ask them to restart you.
- Connect: call `ayme_connect` with the URL of the app's page and open the
  returned link in your browser tool. Without a browser tool, give the link to
  the user to open, or to paste into the tab they already have open.
- When the page's tools are missing from your tool list after the page
  pairs, list them with `ayme_list_tools` and run them with `ayme_call`.
- When a tool answers that no page is connected right after your MCP server
  restarted, and a tab was paired before, wait a few seconds: the tab pairs
  again by itself, and the page's tools come back with a tool list change.
  If they don't come back, or no tab was paired, call `ayme_connect` again
  and open the new link.
- When a call answers that the page reloaded or navigated before it
  answered, the call's outcome is unknown: read the page with `snapshot`
  before deciding whether to call it again. When it answers that the tab
  closed, call `ayme_connect` again and open the new link.
- When a tool answers that no page reconnected in its place, the page the tab
  loaded did not pair within a few seconds. A slow page of the app pairs
  later by itself, and its tools come back with a tool list change. A page
  that doesn't run Ayme's Agent Connection, and loads no
  [served Page Objects](#a-page-that-doesnt-ship-ayme), never pairs, through
  `ayme_connect` either: go back to a page of the app in that tab, in your
  browser tool or by asking the user, and its tools return.
- When a Page Object's tools never appear, read the browser console, or ask
  the user to: a refused registration, `Cannot register the Page Object …`,
  is logged there and does not reach you. It names two classes that share a
  name; rename one. For a refusal beginning `The Page Object class`, see the
  [root rules](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/ayme.md#page-object-root). A `present` or root
  predicate that throws is logged there too, and its Page Object is absent.
- When the dev server refuses to build a Page Object, the reason is in the
  dev server's output. A page that loads after the refusal does not pair, and
  the tools answer that no page is connected; a page already paired can keep
  its earlier tools after a refused hot update. Once the build succeeds
  again, `reload` that page before relying on its tools: it can keep running
  the Page Objects from before the refusal.
- Check the connection end to end: invoke the exposed action through Ayme's
  MCP server and confirm its visible effect in the app. A direct Ayme call or
  a page-state read alone does not check the connection.
- When Chrome asks to allow local network access, ask the user to allow it,
  then reload.

## A page that doesn't ship Ayme

Experimental: this may change in any release. When you drive the browser
with Playwright MCP or Playwright CLI, `ayme mcp` can serve the project's Page
Objects to a page whose app doesn't ship Ayme. Set it up as
[A page that doesn't ship Ayme](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md#a-page-that-doesnt-ship-ayme)
describes:

- Put the entry at `.ayme/page-objects.ts`, in the folder `ayme mcp` starts
  in. Its default export lists the Page Object classes. Put the Page Object
  files in `.ayme/pom/`, unless the project keeps them elsewhere. The project
  needs `@ayme-dev/ayme`, `@ayme-dev/mcp`, TypeScript and `@playwright/test`
  installed, and no build plugin.
- On start, `ayme mcp` writes `.ayme/init-script.js` and ignores it in
  `.ayme/.gitignore`. Don't commit the init script or edit it: each start
  writes it again.
- Point the browser tool's config file at the init script, with both context
  settings:

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

  Pass it to Playwright MCP with `--config <file>` in its registration, and
  to Playwright CLI with `playwright-cli open --config <file> <url>`. A path in
  the file is relative to the file's folder, so from
  `.playwright/cli.config.json` it is `../.ayme/init-script.js`.

- When the browser can start before `ayme mcp`, add `--port <port>` to
  `ayme mcp`'s registration, so each start writes the same init script.
- Connect with `ayme_connect` as for any page. Its answer ends with a line
  naming the init script while `ayme mcp` serves Page Objects; without that
  line, `ayme mcp` found no entry in the folder it started in.

When it fails:

- When Playwright MCP or Playwright CLI fails with
  `Init script file does not exist`, `ayme mcp` has not started in that
  folder yet. Restart the browser tool once `ayme mcp` runs, or ask the user
  to.
- When the page never pairs and its tools answer that no page is connected,
  check that the config file has both `bypassCSP` and the
  `local-network-access` permission, and that the browser started after
  `ayme mcp` or that `--port` pins its port. A page whose console logs
  `The Page Objects ayme mcp serves at … did not load` has no good build to
  load yet.
- After an edit to a Page Object, the page swaps in the new build by itself.
  A build that fails keeps the last good build. Build errors, with their file,
  line and column, are in `ayme mcp`'s standard error.
- After navigating to another origin, call `ayme_connect` with a URL on that
  origin and open the new link.
- On a page whose app ships Ayme, you get the app's tools, not the served
  Page Objects' tools.
- Only Chromium-based browsers are supported.
