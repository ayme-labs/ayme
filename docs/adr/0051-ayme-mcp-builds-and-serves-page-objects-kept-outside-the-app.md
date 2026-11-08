---
status: accepted
---

# `ayme mcp` builds and serves Page Objects kept outside the app, and the browser automation loads them through its init script

An agent driving a browser through Playwright MCP or Playwright CLI gets Ayme's tools only on pages whose app ships Ayme, and most don't. So `ayme mcp`, experimentally, builds a project's Page Objects itself and serves them, with the project's own `@ayme-dev/ayme`, from the server it already runs. The browser automation loads them through an init script that `ayme mcp` writes for its port. On this path only, `ayme mcp` compiles the Page Objects, and a page gets them only while `ayme mcp` runs on the port its init script names.

We rejected three alternatives. The user building one file with their own bundler and pointing the init script at it keeps old Page Objects in every tab until a new tab opens, and loads the Inspector and every lazy part eagerly. A fixed loader that scans the port range for a server, so that the init script never changes, cannot tell several `ayme mcp` servers on one machine apart, one per worktree. Serving a runtime bundled in `@ayme-dev/mcp` can drift from the version of `@ayme-dev/ayme` the Page Objects are written against.
