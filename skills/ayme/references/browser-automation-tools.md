# Using Ayme with browser automation tools

You keep driving the browser with the automation you already use. Ayme adds two
things to it for the screen the browser is on: a Page Object Tool for each
action of the Page Objects there, and `page_objects`, which lists those Page
Objects as a tree with the id (`po<n>`) each rooted Page Object Tool takes.
[Page tools](page-tools.md) shows how to read the tree and a Page Object Tool's
answer.

Before you take a full snapshot, check your tool list. When a Page Object Tool
does the next step, call it instead; take the snapshot only when none does.

Each section below names a start command. It goes after
`npx -y @ayme-dev/mcp@<version>`, registered in your agent as
[Browser setup](browser-setup.md) describes. On a page that doesn't ship Ayme,
the server serves the project's Page Objects through the init script your
browser automation loads; see
[A page that doesn't ship Ayme](browser-setup.md#a-page-that-doesnt-ship-ayme).

## Playwright CLI

- **Channel:** WebMCP. `playwright-cli webmcp-list` lists the page's tools and
  `playwright-cli webmcp-call <name> --params '<json>'` calls them. Call the
  Page Object Tools this way, even when the `ayme` server lists them too.
- **Start:** `mcp --webmcp`.
- **After a Page Object Tool:** read `page_objects` and take a snapshot limited
  to depth 1, chained in the same command:
  `playwright-cli webmcp-call page_objects && playwright-cli snapshot --depth=1`.
  The snapshot is what makes Playwright refresh its list of the page's tools.
- **After a navigation:** on either [error](#errors-after-a-navigation), run
  the same chained command again.
- **Through the `ayme` server instead:** start `mcp`. After a Page Object Tool,
  read `page_objects` as the next call.

## Playwright MCP

- **Channel:** Ayme as its own MCP server, `ayme`, beside Playwright MCP.
- **Start:** `mcp`.
- **After a Page Object Tool:** read `page_objects` as the next call.
- **After a navigation:** on either [error](#errors-after-a-navigation), read
  `page_objects` again.
- **Through WebMCP instead:** start `mcp --webmcp` and leave Playwright MCP's
  WebMCP support on. Playwright MCP collects the page's tools with each
  snapshot and lists each as `webmcp_<name>`, a dot in the name read as an
  underscore, such as `webmcp_page_objects`. After a Page Object Tool, call
  `webmcp_page_objects` and `browser_snapshot` with `depth: 1` as the next
  calls.

## agent-browser

- **Channel:** Ayme as its own MCP server, `ayme`, beside the `agent-browser`
  command. For a page that doesn't ship Ayme, start agent-browser with
  `--init-script .ayme/init-script.js`.
- **Start:** `mcp`.
- **After a Page Object Tool:** read `page_objects` as the next call.
- **After a navigation:** on either [error](#errors-after-a-navigation), read
  `page_objects` again.
- **Through WebMCP instead:** start `mcp --webmcp`, with agent-browser's
  WebMCP support on. `agent-browser webmcp list` lists the page's tools and
  `agent-browser webmcp invoke <name> --params '<json>'` calls them. After a
  Page Object Tool, read `page_objects` and `agent-browser webmcp list` in the
  same command.

## Errors after a navigation

Two errors follow a navigation, and both mean the page's tools were replaced:

- `page_objects` or a Page Object Tool answers that it is not registered in
  this frame (Playwright, through WebMCP).
- agent-browser answers that the page context changed before the invocation
  completed (through WebMCP).

Read the page again as your tool's section says. If the step is still to do,
call its Page Object Tool again, with the id the fresh `page_objects` shows.
