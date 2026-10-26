# Browser setup

Set up the connection as [Connect an agent](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md)
describes: `agentConnection` on behind the app's dev flag, and Ayme's MCP
server registered in your agent, pinned to the project's `@ayme-dev/mcp`
version. Diagnose with the "The agent cannot reach the page" section of
[Troubleshooting](https://github.com/ayme-labs/ayme/blob/main/docs/guide/troubleshooting.md).
For using the page's tools once it is connected, such as a ref that fails to
resolve, a `goal` Handover or an unavailable tool's reason, read
[Page tools](page-tools.md).

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
  that doesn't run Ayme's Agent Connection never pairs, through `ayme_connect`
  either: go back to a page of the app in that tab, in your browser tool or by
  asking the user, and its tools return.
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
