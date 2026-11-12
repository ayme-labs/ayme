# Using Ayme with browser automation tools

Ayme adds the Page Object Tools of the screen the browser is on, and
`page_objects`, to the browser automation you already drive. Keep driving the
browser with it, and call a Page Object Tool whenever one does the step.
`page_objects` shows the Page Objects on the page as a tree, with the id
(`po<n>`) a rooted Page Object Tool takes; [Page tools](page-tools.md) has how
to read it and a Page Object Tool's answer.

Each start command below follows `npx -y @ayme-dev/mcp@<version>`, registered
in your agent as [Browser setup](browser-setup.md) describes. For a page that
doesn't ship Ayme, it serves the project's Page Objects through the init
script your browser automation loads, as
[A page that doesn't ship Ayme](browser-setup.md#a-page-that-doesnt-ship-ayme)
describes.

In every case, take a full snapshot only when the next step has no Page Object
Tool.

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

Read again, as your section says. When the step is still to do, call its Page
Object Tool again, by the id the fresh `page_objects` shows.
