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

A tab with no link and no stored pairing pairs by itself when the page is on
`localhost` or `127.0.0.1` and exactly one Ayme MCP server runs on the
machine. With none or several running, it stays unpaired until you open or
paste a connect link, so it never pairs with the wrong agent.

After pairing, the page's built-in tools and Custom Tools are MCP tools under
the names the page gives them, and calling one runs it on the page and returns
its result. The server's own tools stay in the server: the page never publishes
them through WebMCP.

## Ports

The server listens on the first free port from 9350 to 9365, the range a page
searches for auto-pairing. `ayme mcp --port <port>` listens on that port only,
and fails if it is taken; its connect links carry the port, so the page needs
no change. On a port outside the range, a tab pairs with it only through a link.

## Security

The server listens on the loopback interface only. It accepts a page with the
token from its connect link, or without a token only when the page's origin is
`localhost` or `127.0.0.1`, so another website you have open cannot drive it.
The page pairs only with a loopback address.
