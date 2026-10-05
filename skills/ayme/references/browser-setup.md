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
- When a tool answers that no page is connected, call `ayme_connect` again
  and open the new link.
- Check the connection end to end: invoke the exposed action through Ayme's
  MCP server and confirm its visible effect in the app. A direct Ayme call or
  a page-state read alone does not check the connection.
- When Chrome asks to allow local network access, ask the user to allow it,
  then reload.
