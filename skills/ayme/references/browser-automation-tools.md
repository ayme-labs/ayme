# Using ayme with browser automation tools

You keep driving the browser with the automation you already use, such as
Playwright CLI, Playwright MCP or agent-browser. ayme adds two things to it for
the screen the browser is on: a Page Object Tool for each action of the Page
Objects there, and `page_objects`, which lists those Page Objects as a tree
with the id (`po<n>`) each rooted Page Object Tool takes. A rooted Page Object
Tool takes that id and the action's own arguments under `args`, such as
`{"id": "po3", "args": {"text": "Soy milk"}}`. A Page Object Tool of a Page
Object with no id takes the action's arguments directly, such as
`{"text": "Soy milk"}`. [Page tools](page-tools.md) shows how to read the tree
and a Page Object Tool's answer.

ayme reaches you as its own MCP server, `ayme`, beside your browser
automation. Its start command is `mcp`, after
`npx --no -p @ayme-dev/mcp ayme`, registered in your agent as
[Browser setup](browser-setup.md) describes.

On a page that doesn't ship ayme, the server serves the project's Page Objects
through the init script your browser automation loads; see
[A page that doesn't ship ayme](browser-setup.md#a-page-that-doesnt-ship-ayme).
Playwright CLI and Playwright MCP load it from their config file; start
agent-browser with `--init-script ayme/init-script.js`.

- Before you take a full snapshot, check your tool list. When a Page Object
  Tool does the next step, call it instead; take the snapshot only when none
  does.
- After a Page Object Tool, read `page_objects` as the next call.
- After a navigation, read `page_objects` again. If the step is still to do,
  call its Page Object Tool again, with the id the fresh `page_objects` shows.
