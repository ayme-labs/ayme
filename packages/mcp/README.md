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
a connect link (`connectPage`); `Agent.call` returns the tool's own text and
the change note apart. `freePort` picks a port outside the range a page scans,
for `startAgent("--port", ...)` when no page should auto-pair with the server,
and `aymeCommand` is the command's file. Only test files may import it.

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
paste a connect link, so it never pairs with the wrong agent. A server busy
with a tab, paired or waiting for it to reconnect, refuses other tabs without a
token and does not count for their scan; only its connect link moves it to
another tab. The server hands an auto-paired tab its token, which the tab keeps
and reconnects with like a link's. If another server has taken that port since,
it does not know the token: the tab forgets the pairing and looks again.

After pairing, the page's built-in tools and Custom Tools are MCP tools under
the names the page gives them, and calling one runs it on the page and returns
its result. The server's own tools stay in the server: the page never publishes
them through WebMCP.

Page Object Tools appear and disappear as MCP tools while the page registers
and unregisters its Page Objects, and the server sends
`notifications/tools/list_changed` on every change. When the page's tools
changed since the agent's previous call, the result ends with a separate text
item such as `The page's tools changed since your previous call. Appeared:
Basket.readHeading. ayme_list_tools lists the current tools; ayme_call runs any
of them.` For agents that never re-read the tool list, `ayme_list_tools` lists
the page's current tools with their input schemas and `ayme_call` runs any of
them by name.

## Ports

The server listens on the first free port from 9350 to 9365, the range a page
searches for auto-pairing. `ayme mcp --port <port>` listens on that port only,
and fails if it is taken; its connect links carry the port, so the page needs
no change. On a port outside the range, a tab pairs with it only through a link.

## Reloads, navigation and tabs

The connection follows its tab. After a reload, or a navigation in the same
tab to another document of the same origin, the new document pairs again from
`sessionStorage` and reports its tools; a page's tools change with it. A
navigation to another origin ends the connection.

Every call gets one answer. When the page answers, that is the answer. When
the page goes away first, the server answers with an error result whose text
is a JSON object: `error` says what happened and that the call's outcome is
unknown, and `next` what to do now. The server waits up to 3 seconds for the
tab to reconnect, then tells the cases apart like this:

- **Reloaded or navigated:** the same tab reconnected. It reloaded when the
  page said it started a reload, or, without a word from the page, when the
  new document has the old one's URL; otherwise it navigated. The answer has
  `settled: false`, the new document's URL in `loading` and its tools in
  `tools`.
- **Started loading, not reconnected yet:** the page said it started loading
  another document (the Navigation API's `navigate` event, for loads the page
  starts, such as a link click or `location.reload()`), and the tab has not
  reconnected. The answer has `settled: false` and the URL in `loading`.
- **Closed:** the tab did not reconnect and the page said nothing, as when the
  tab closes or the browser itself loads a document without Ayme.
- **Another tab connected:** the newest tab wins. Pairing a second tab answers
  the first tab's calls at once, the first tab forgets its pairing and does not
  reconnect, and the server works with the second tab.

While the page is away, no page is paired. A closed tab leaves it that way
until a tab pairs again.

## Security

The server listens on the loopback interface only. It accepts a page with the
token from its connect link, or without a token only when the page's origin is
`localhost` or `127.0.0.1`, so another website you have open cannot drive it.
The page pairs only with a loopback address.
