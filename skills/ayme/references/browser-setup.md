# Browser setup

Set up the connection as [Connect an agent](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md)
describes: `agentConnection` on behind the app's dev flag, and Ayme's MCP
server registered in your agent as the copy of `@ayme-dev/mcp` the project
installed, started in the project's folder. Diagnose with the "The agent cannot reach the page" section of
[Troubleshooting](https://github.com/ayme-labs/ayme/blob/main/docs/guide/troubleshooting.md).
For using the page's tools once it is connected, such as naming a Page Object
by its id or an unavailable tool's reason, read [Page tools](page-tools.md).

- Start command, after `npx --no -p @ayme-dev/mcp ayme`, or after
  `npx -y @ayme-dev/mcp@<version>`, pinned to the project's version, when your
  agent starts its servers in another folder:
  - `mcp` beside another browser automation, such as Playwright MCP,
    Playwright CLI or agent-browser: it lists the Page Object Tools,
    `page_objects`, Peek Tools and its own tools, and none of Ayme's own
    browser driving. [Browser automation tools](browser-automation-tools.md)
    names the start command for each.
  - `mcp --browser-tools` when Ayme is your only browser automation: it also
    lists `snapshot`, the Browser Tools, the app's Custom Tools and `goal`.
  - `mcp --webmcp` with [served Page Objects](#a-page-that-doesnt-ship-ayme)
    whose page should also publish them through WebMCP, such as for
    Playwright CLI, with `@ayme-dev/webmcp` installed beside
    `@ayme-dev/ayme`. It refuses to start without Page Objects to serve.
- The server's tools reach you only after your client restarts. When you
  cannot register the server or restart yourself, give the user the
  registration for your client and ask them to restart you.
- Connect: call `ayme_connect` with the URL of the app's page and open the
  returned link in your browser tool. Without a browser tool, give the link to
  the user to open, or to paste into the tab they already have open.
- When the page's tools are missing from your tool list after the page
  pairs, list them with `ayme_list_tools` and run them with `ayme_call`.
- Right after `ayme_connect`, a call of a page tool or `ayme_list_tools`
  waits up to 10 seconds for the page its link opens to pair. When it still
  answers that no page is connected, the link was not opened, or the page
  has no Ayme: see [A page that doesn't ship Ayme](#a-page-that-doesnt-ship-ayme).
- When a tool answers that no page is connected right after your MCP server
  restarted, and a tab was paired before, wait a few seconds: the tab pairs
  again by itself, and the page's tools come back with a tool list change.
  If they don't come back, or no tab was paired, call `ayme_connect` again
  and open the new link.
- When a call answers that the page reloaded or navigated before it
  answered, the call's outcome is unknown: read the page, with
  `page_objects` or a snapshot, before deciding whether to call it again. When it answers that the tab
  closed, call `ayme_connect` again and open the new link.
- When a tool answers that no page reconnected in its place, the page the tab
  loaded did not pair within a few seconds. A slow page of the app pairs
  later by itself, and its tools come back with a tool list change. A page
  that doesn't run Ayme's Agent Connection and loads no
  [served Page Objects](#a-page-that-doesnt-ship-ayme), such as another site,
  never pairs. `ayme_connect` can't pair it either. Go back to a page of the
  app in that tab, with your browser tool or by asking the user. Its tools
  then return.
- When a Page Object's tools never appear, read the browser console, or ask
  the user to. A refused registration is logged there and does not reach you.
  - `Cannot register the Page Object "…": …` names two different classes
    with one name. Rename one.
  - `The Page Object class "…" declares no root and is reached from more than one place: …`
    or `… declares no root and has many instances below a collection: …`
    names a class without a root. Give it one, usually by extending the
    project's component base class. The
    [root rules](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/ayme.md#page-object-root)
    have the details.

  A `present` or root predicate that throws is logged there too, and its
  Page Object is absent.

- When the dev server refuses to build a Page Object, the reason is in the
  dev server's output. A page that loads after the refusal does not pair, so
  the tools answer that no page is connected. A page that was already paired
  can keep its earlier tools after a refused hot update. Once the build
  succeeds again, reload that page before relying on its tools. Until then
  it may still run the Page Objects from before the refusal.
- Check the connection end to end: invoke the exposed action through Ayme's
  MCP server and confirm its visible effect in the app. A direct Ayme call or
  a page-state read alone does not check the connection.
- When Chrome asks to allow local network access, ask the user to allow it,
  then reload.

## A page that doesn't ship Ayme

Experimental. With Playwright MCP, Playwright CLI or agent-browser, `ayme mcp`
can serve the project's Page Objects to a page that doesn't ship Ayme. Set it
up as
[Page Objects on a page without Ayme](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-objects-without-ayme.md)
describes. When it fails:

- The browser tool fails with `Init script file does not exist`: start
  `ayme mcp` first, and check the path, which is relative to the config
  file's folder. Then restart the browser tool.
- The page never pairs: check the browser tool's config has `bypassCSP` and
  the `local-network-access` permission, and that the browser started after
  `ayme mcp`. Otherwise pin the port with `--port` and restart the browser.
- A Page Object's tools don't change after an edit: a failed build is in
  `ayme mcp`'s standard error, and a build that failed to load is in the
  browser console.
