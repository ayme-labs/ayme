# Connect an agent

How to let Claude Code, Codex, Cursor or another coding agent call your app's tools through Ayme's MCP server.

## How the connection works

Each coding agent starts its own Ayme MCP server, `ayme mcp` from `@ayme-dev/mcp`, like any other stdio MCP server. The server does not launch or manage a browser. The agent calls `ayme_connect` with your app's URL and gets back a link to that page. Opening the link, in the agent's browser tool or in yours, pairs that tab with the agent's server: an Agent Connection. The page's tools then become the agent's MCP tools. Your app's own Node processes, such as its dev server, can pair with the same server beside the tab as App Processes, and offer the Peek Tools of their server-side state; see [In Node](../reference/ayme.md#in-node).

Because every agent runs its own server, Claude Code and Codex on the same machine, or one agent per worktree, each connect to their own page without sharing a port or settings.

To see what an agent experiences before setting up your own app, open the [Ayme playground](https://ayme-labs.github.io/ayme/) and choose **Try with your own coding agent**.

## Turn it on in the page

Install `@ayme-dev/mcp` beside `@ayme-dev/ayme`, which declares it as an optional peer dependency:

```sh
npm install -D @ayme-dev/mcp
```

Then pass `agentConnection: true` where Ayme starts: `useAyme` or `AymeProvider` in Vue, `AymeProvider` in React, `useAyme` in Svelte, `provideAyme` in Angular, or `createAyme`. Gate it with your app's dev flag, as you do the [Inspector](inspector.md):

```ts
useAyme({
  inspector: import.meta.env.DEV,
  agentConnection: import.meta.env.DEV,
});
```

- The option is off unless `true`, and there is no production guard: you decide when it is on.
- While it is on, the session loads the page client from `@ayme-dev/mcp` when it starts in the browser, and ends the connection when it stops. With the option off, the page requests none of its code.
- If the package cannot be loaded, the error names `@ayme-dev/mcp`.
- It works whether [WebMCP publication](publish-tools.md) is on or off.

## Register the server in your agent

Register the server pinned to the version of `@ayme-dev/mcp` your app installed, the same version as your other Ayme packages: replace `<version>` below with the installed version, which `npm ls @ayme-dev/mcp` prints, so the server matches the page client in your app.

Claude Code:

```sh
claude mcp add ayme -- npx -y @ayme-dev/mcp@<version> mcp
```

Add `--scope project` before `ayme` to share the server with your team through the project's `.mcp.json`.

Codex:

```sh
codex mcp add ayme -- npx -y @ayme-dev/mcp@<version> mcp
```

Or add it to `~/.codex/config.toml`, or to `.codex/config.toml` in a trusted project:

```toml
[mcp_servers.ayme]
command = "npx"
args = ["-y", "@ayme-dev/mcp@<version>", "mcp"]
```

Cursor, in `.cursor/mcp.json` for the project or `~/.cursor/mcp.json` for every project:

```json
{
  "mcpServers": {
    "ayme": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@ayme-dev/mcp@<version>", "mcp"]
    }
  }
}
```

Any other MCP client takes the same command, `npx`, with the arguments `-y @ayme-dev/mcp@<version> mcp`. Restart the agent after registering, so it starts the server and lists `ayme_connect`.

Your app already installs `@ayme-dev/mcp`, so a client that starts its servers in the app's folder can run that copy instead, which always matches the page client: the command `npx` with the arguments `--no -p @ayme-dev/mcp ayme mcp`. `--no` keeps `npx` from downloading anything, so started from any other folder the server fails to start rather than running another version.

## Connect a tab

Run your dev server and ask the agent to connect to the page, giving it the URL, such as `http://localhost:5173/`. The agent calls `ayme_connect` and gets back that URL with `#ayme=...` appended, which carries the server's address and a token.

- The agent can open the link in its own browser tool, or give it to you to open in yours.
- Pasting the link into a tab that already shows the app changes only its hash, so the page does not reload and keeps its state. The page removes the fragment from the address bar once it has read it.
- On `localhost` or `127.0.0.1`, an open tab with no link pairs by itself when exactly one Ayme MCP server is running. It looks when the page loads and again each time the tab gains focus, so a tab opened before the agent started pairs once you switch back to it. With several servers running, it stays unpaired until you paste a link, so it never pairs with the wrong agent.
- A server already working with a tab ignores other tabs that look for a server; only its connect link moves it. The newest tab wins: opening the link in a second tab moves the agent there, and the first tab is no longer connected.

## What the agent sees

Once a tab is paired, the page's tools are the agent's MCP tools, under the names the page gives them: `snapshot`, the [Browser Tools](../reference/browser-tools.md), your Custom Tools, the Page Object Tools of every Page Object on the page, the Peek Tools of the page's [Peeks](../reference/ayme.md#aymepeek), `peek.<name>`, and `goal` when the Goal Loop is configured. Each App Process paired beside the tab adds its own Peek Tools, `peek.node.<name>`. A good first check is to ask the agent to call one of your Page Object Tools and confirm the effect in the app.

A Peek's values reach the agent, and its model provider, unchanged, so return only what you want it to see; see [What a Peek exposes](../reference/ayme.md#what-a-peek-exposes).

Page Object Tools appear and disappear as Page Objects come and go, Peek Tools as Peeks do, and the server tells the agent each time the list changes. When the page's tools changed since the agent's previous call, the result also says which ones appeared or disappeared.

Some agents read the tool list once, when they start, so they never see the page's tools, which arrive later. For them, `ayme_list_tools` lists the page's current tools with their input schemas, and `ayme_call` runs any of them by name. A failed tool call answers with an error result. While no tab is paired, every page tool and fallback tool answers that the agent should call `ayme_connect` and open the link.

## Reloads, navigation and closed tabs

The connection follows its tab through reloads and through navigation to other pages of the same origin: the new document pairs again by itself and the agent sees its tools. Every call gets an answer: when the page reloads, navigates or closes before a call finishes, the agent gets an error that says what happened and that the call's outcome is unknown.

A closed tab, or navigation to another origin, ends the connection. Ask the agent to call `ayme_connect` again and open the new link.

## Ports

The server listens on the loopback interface only, on the first free port from 9350 to 9365, the range an open tab looks through. To use another port, add `--port <port>` after `mcp` in the registration; the server then fails to start if that port is taken. The connect link carries the port, so the page needs no setting, but a tab pairs with a server outside the range only through its link.

## Limits

- The agent and the browser must run on the same machine. Remote agents, such as an agent on another machine driving a browser on your computer, are not supported in the alpha.
- From an origin other than `localhost` or `127.0.0.1`, such as a deployed preview, a tab pairs only through a link, and Chrome may ask you to allow local network access before the page can reach the server. Allow it and reload.

[Troubleshooting](../troubleshooting.md#the-agent-cannot-reach-the-page) covers the common problems.
