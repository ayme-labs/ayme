# @ayme-dev/mcp

Ayme's MCP server for coding agents, and the page client it pairs with. A
coding agent runs its own server over stdio; the server pairs with one browser
tab of your app, and the page's tools become MCP tools the agent can call.

## Setup

Register the server in your coding agent like any other stdio MCP server, with
the command `ayme mcp` from this package, pinned to the version you install:

```sh
npx -y @ayme-dev/mcp@<version> mcp
```

Install the package beside `@ayme-dev/ayme`, which declares it as an optional
peer dependency, and turn the page side on with `agentConnection: true` where
Ayme starts: `useAyme` or `AymeProvider` in Vue, `AymeProvider` in React,
`useAyme` in Svelte, `provideAyme` in Angular, or `createAyme`:

```ts
useAyme({ agentConnection: import.meta.env.DEV });
```

The option is off unless `true`, and there is no production guard: you decide
when it is on. While it is on, the session loads the page client from
`@ayme-dev/mcp/client` when it starts in the browser, and ends the connection
when it stops. With the option off, the page requests none of its code. It
works whether WebMCP publication is on or off.

For your own end-to-end tests, `@ayme-dev/mcp/testing` starts this package's
`ayme mcp` with an MCP client (`startAgent`) and pairs a Playwright page through
a connect link (`connectPage`). Only test files may import it.

## Connecting a tab

The agent calls `ayme_connect` with the URL of the app page and gets back that
URL with `#ayme=ws://127.0.0.1:<port>/<token>` appended. Opening the link, in
the agent's browser tool or in yours, pairs the tab with that server: the page
keeps the pairing in `sessionStorage` for the tab and removes the fragment from
the address bar without reloading. Pasting the link into a tab that is already
open changes only its hash, so the page does not reload.

After pairing, the page's built-in tools and Custom Tools are MCP tools under
the names the page gives them, and calling one runs it on the page and returns
its result. The server's own tools stay in the server: the page never publishes
them through WebMCP.

## Security

The server listens on the loopback interface only, on the first free port from
9350 to 9365, and accepts a page only with the token from its connect link. The
page pairs only with a loopback address.
