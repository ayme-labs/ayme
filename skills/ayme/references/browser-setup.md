# Browser setup

Set up the connection as [Connect an agent](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md)
describes: `agentConnection` on behind the app's dev flag, and Ayme's MCP
server registered in your agent, pinned to the project's `@ayme-dev/mcp`
version. Diagnose with the "The agent cannot reach the page" section of
[Troubleshooting](https://github.com/ayme-labs/ayme/blob/main/docs/guide/troubleshooting.md).

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
- When a ref fails to resolve, call `snapshot` and use the ref it prints for
  that node; if that ref fails the same way, use a selector such as
  `role=button[name="Save"]`. Pass a ref alone, such as `e36`, and for a
  collection tool the ref of the item's Page Object Root.
  [Page state](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-state.md#structural-refs)
  says what each failure reason means. Refs belong to one document: after a
  full load, call `snapshot` before you use a ref, since a ref printed before
  the load can name another element on the new page.
- When `goal` hands over with `needs_value` because none of a parameter's
  allowed values belongs in it, the loop offered that parameter only its
  allowed values, so a Goal Value of a type it does not take changes nothing.
  Call the tool named in `needs` yourself with the value, or call `goal` again
  with a goal that names it.
- When a Page Object's tools never appear, read the browser console, or ask
  the user to: a refused registration, `Cannot register the Page Object …`,
  is logged there and does not reach you. It names two classes that share a
  name; rename one.
- When a tool answers that it is unavailable, read the reason. A runtime
  reason, `a click would not reach it; e42 is in the way`, names the element
  in the way in the page state, such as an open dialog to close first, and
  stops before the ref when nothing in the way has one. A Browser Tool that
  types or selects (`type`, `fill`, `select_option`, or a `fill_form` field
  other than a checkbox or radio) gives
  `it cannot take focus; e42 is in the way` instead, for a field outside an
  open modal dialog or inside an inert region. Any other reason is the app's
  own, such as `No item is selected`. A Page Object Tool stays listed:
  `ayme_list_tools` shows whether each tool is available and why not,
  and a tool result says which tools became available or unavailable since
  your previous call.
- Check the connection end to end: invoke the exposed action through Ayme's
  MCP server and confirm its visible effect in the app. A direct Ayme call or
  a page-state read alone does not check the connection.
- When Chrome asks to allow local network access, ask the user to allow it,
  then reload.
