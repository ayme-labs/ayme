# Troubleshooting

The common reasons an Ayme setup fails, by what you see.

## The build fails

- **`Unsupported Page Object Tool input type for …`**: an action takes a parameter type the compiler cannot describe, such as an array. [Page Object Models](guides/page-object-models.md#tool-names-and-inputs) lists the supported types.
- **`Could not find a tsconfig.json for POM source …`**: the Page Object Model is outside every tsconfig. Add one, or pass `tsconfigPath` to the [build plugin](reference/build-plugin.md).
- **Angular's `maximumError` budget fails**: Ayme adds about 240 kB transferred to the initial chunk. Raise the `initial` budget; see [Angular](frameworks/angular.md#bundle-size).
- **`Unsupported Playwright config loader version …`**: loading a Playwright config through `playwright.config` needs `@playwright/test` 1.62. Remove `config` and pass `use` values directly, or upgrade.

## A Page Object has no tools

- **`The imported page object has no compiler-derived Ayme metadata`**: the build plugin did not compile the class. Check that it is marked `@ayme`, lives in a `.ts` file the app imports, and that `experimentalDecorators` is on. On Vite 8 with your own `oxc` or `esbuild` settings, see the [build plugin reference](reference/build-plugin.md#vite). A subclass in a file without `@ayme` needs a bundler content filter that matches it; see [What it compiles](reference/build-plugin.md#what-it-compiles).
- **The tool is not in `ayme.tools.list()`**: the class is not registered. A child model needs a `root`.
- **The tool is listed with `available: false`**: its Page Object Root is not on the page or not available.
- **A Svelte decorator in a `.svelte` file is ignored**: Page Object Models must be `.ts` modules.
- **Editing a type an action uses does not change its schema** with Angular: reload the page.

## The agent cannot reach the page

These are for a coding agent connected through Ayme's MCP server, as [Connect an agent](guides/connect-an-agent.md) sets up.

- **The agent has no `ayme_connect` tool**: the server is not registered or did not start. Check the registration for your agent, pinned to your `@ayme-dev/mcp` version, and restart the agent.
- **An open tab does not pair by itself**: a tab pairs by itself only on `localhost` or `127.0.0.1`, and only when exactly one Ayme MCP server is running and not already working with another tab. With several running, such as one per agent or worktree, ask your agent for a link with `ayme_connect` and paste it into the tab; the page does not reload.
- **The page logs red failed-WebSocket lines in the console**: an unpaired page on `localhost` logs one for each port where it looks for a server and finds none. They are expected and harmless. The page looks again each time the tab gains focus, until it pairs.
- **The agent sees only `ayme_connect`, `ayme_list_tools` and `ayme_call`, or no Page Object Tools**: the agent reads its tool list once, when it starts, and does not follow changes to it. Ask it to list the page's tools with `ayme_list_tools` and run them with `ayme_call`.
- **A tool answers that no page is connected**: no tab is paired, or the tab closed or navigated to another origin. Ask the agent to call `ayme_connect` again and open the new link.
- **`No free port for the Ayme MCP server between 9350 and 9365.`**: other programs hold the range. Add `--port <port>` after `mcp` in the registration, with a free port. The connect link carries it, so the page needs no change.
- **`The agentConnection option could not load @ayme-dev/mcp.`**: install `@ayme-dev/mcp` beside `@ayme-dev/ayme`, or turn the option off.
- **The page is on a deployed preview or another non-local origin**: open the connect link there, and allow Chrome's local network access prompt if it asks.
- **A tool call times out just after the app's tab went to the background**: while the machine is under heavy CPU load, the first call after the tab is hidden can stall and fail with `Timeout … exceeded`. The calls after it run normally, so retry it, or keep the tab visible.

## A Peek Tool is missing

These are for [Peeks](reference/ayme.md#aymepeek), which reach a coding agent through Ayme's MCP server and the Inspector only.

- **No `peek.<name>` tool**: `ayme.peek` does nothing unless the session has `agentConnection` on, or `inspector` in the browser. A component's Peek appears once the component has mounted, and goes when its last instance unmounts. An agent that does not follow tool-list changes finds it with `ayme_list_tools`.
- **No `peek.node.<name>` tool**: in Node, only `agentConnection` turns Peeks on, and the process must have started its session and paired. It pairs by itself only when exactly one Ayme MCP server answers on the ports from 9350 to 9365; with several running, name one with `agentConnection: { link }` or `{ port }`. See [In Node](reference/ayme.md#in-node).
- **`[ayme] peek.<name> is hidden: another tool uses that name. Rename the Peek.`**: another of the page's tools took the Peek Tool's name, and keeps it. Rename the Peek.
- **`[ayme] peek.node.<name> is hidden: another App Process offers a tool with the same name. Rename one.`**, in the process's terminal: two App Processes offer one name, and the one that connected first keeps it.
- **`The Peek "node.<name>" would be read through peek.node.<name>, which names an App Process's Peek.`**: a Peek in the browser has a name starting with `node.`. Rename it.

## In-browser agents see no tools

These are for agents that run in the browser and read the tools Ayme publishes through WebMCP.

- **The publication status is `disabled`**: pass `webMCP: { enabled: true }` where Ayme starts. See [Publish tools](guides/publish-tools.md).
- **The status is `unavailable`**: no WebMCP driver appeared within two seconds. Load the polyfill or enable Chrome's flag before your app's entry module, as [Publish tools](guides/publish-tools.md#give-the-page-webmcp) shows, or call `retryPublication()` once it is there.
- **The status is `failed`**: most often two published tools share a name, such as a Custom Tool named like a Page Object Tool, or the WebMCP driver rejected a registration. The message says which.
- **The tools have unexpected names**: `webMCP.toolNamePrefix` is set, and agents see the prefixed names.

## Ayme starts twice

- **`The Ayme runtime already has an active owner`**, or a framework's nested-owner error: start Ayme once, at the app's root. In a Node process, start one session, in the server's entry point. In SvelteKit, only the root `+layout.svelte` may call `useAyme(options)`; in Angular, put `provideAyme` in the application config, not in route providers.

[Errors](reference/errors.md) lists every message with its cause.
