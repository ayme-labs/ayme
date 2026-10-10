# @ayme-dev/mcp

Ayme's MCP server for coding agents, and the page client and App Process side
it pairs with. A coding agent runs its own server over stdio; the server pairs
with one browser tab of your app, and with the app's own Node processes beside
it, and their tools become MCP tools the agent can call.

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
and `ignoreAutoPairScan(context)` keeps a Playwright context's pages from
auto-pairing with any server on the machine. `aymeCommand` is the command's
file. Only test files may import it.

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
paste a connect link, so it never pairs with the wrong agent. Until it pairs,
it looks again each time the tab gains focus, so a tab opened before the
agent's server started pairs once you switch back to it. A server busy
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
and unregisters its Page Objects and while their Page Objects come and go on
the page, and the server sends `notifications/tools/list_changed` on every such
change. Every tool of a Page Object on the page is listed, whether or not its
action can run now; the MCP tool list changes only when tools appear or
disappear, never when one becomes available or unavailable, so a cached list
does not churn. Calling an unavailable tool is refused before anything runs,
with an error result that carries its reason, such as `RuntimeStateError:
Panel.remove is unavailable: No item is selected.`

When the page's tools changed since the agent's previous call, the result ends
with a separate text item such as `The connected tools changed since your
previous call. Appeared: Basket.readHeading. Became unavailable: Panel.remove
(No item is selected). ayme_list_tools lists the current tools; ayme_call runs
any of them.` It lists the tools that appeared or disappeared and the ones that
became available or unavailable, with the reason in parentheses when there is
one; a tool that appears unavailable reads `Appeared: Panel.remove
(unavailable: No item is selected).` For agents that never re-read the tool
list, `ayme_list_tools` lists the page's current tools with their input
schemas, whether each is available and, when it is not, why, and `ayme_call`
runs any of them by name.

## App Processes

An App Process is a Node process of your app, such as its dev server or an
Express backend, that pairs with the agent's server beside the tab. Its tools,
such as the Peek Tools of its server-side state, are MCP tools next to the
page's. Start it with `createAyme({ agentConnection })` and `start()` from
`@ayme-dev/ayme` in the process's entry point; its README shows an Express
setup, and its
[reference](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/ayme.md#in-node)
a Next.js one. `@ayme-dev/mcp/process` is the side
of the connection that `start()` loads in Node:
`startAgentConnection(ayme, options)` takes the runtime object, whose `tools`
(a `{ list, subscribe, run }` object, as the page client takes) it offers,
and returns `{ dispose }`.

- **Finding the server:** it probes the ports from 9350 to 9365 and pairs only
  when exactly one Ayme MCP server answers, as a tab's auto-pairing does.
  `port` makes it look on that one port instead, for a server started with
  `--port`. `link`, a connect link from `ayme_connect`, names one server
  instead of looking; it throws when the link is not one.
- **Waiting for the agent:** while unpaired it looks again every 3 seconds,
  and it looks again when its server goes away, so a dev server started
  before the agent pairs once the agent's server is up, and again after it
  restarts. The wait never keeps a process running that is otherwise done.
- **Beside the tab:** it never replaces the tab or another App Process, and
  the tab never replaces it. A server busy with a tab still answers its scan
  and accepts it. It pairs without a token; the server hands it its token,
  which it reconnects with while that server runs, even beside another one.
  It reports no navigation.
- **Tool names:** the agent sees one tool per name. The page's tool keeps its
  name; of two App Processes that offer one name, the one that connected first
  keeps it, counting from each one's current connection. The agent's next tool result says the other's tool is hidden, and
  the other process logs it in its terminal, also when the first one offers the name only later: `[ayme] peek.node.jobs is hidden:
another App Process offers a tool with the same name. Rename one.`
- **Leaving:** when it exits, its tools go at once, and a call still waiting
  for it gets an error result that says so.
- **In the Inspector:** the server sends the paired tab the App Processes'
  tools the agent sees, and again after every change, so the page's
  Inspector lists them in its Node Peek tools and runs one through the
  server, which sends the call to its App Process. The page client's
  `startAgentConnection(ayme)` returns them beside `dispose`, as
  `processTools`: `list` and `subscribe` follow them, none while no server
  is paired, and `run` resolves with the tool's result or throws its error.

The server logs each App Process that connects and disconnects on stderr.

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
A connection that sends no `Origin` is accepted without a token too: browsers
always send one, so it comes from a local program, which can already act as
you (ADR-0033). Only such a connection may pair as an App Process. Any local
program can therefore offer tools to the agent. The page and App Processes
pair only with a loopback address.
