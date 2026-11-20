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

Then pass `agentConnection: true` where Ayme starts: `useAyme` or `AymeProvider` in Vue, `AymeProvider` in React, `useAyme` in Svelte, `provideAyme` in Angular, or `createAyme`. Both `agentConnection` and the [Inspector](inspector.md) are development tools, so gate them with your framework's development flag:

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

### The development flag per framework

| Framework                | Development flag                         | Setup                                                                                                                                                                |
| ------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vite: React, Vue, Svelte | `import.meta.env.DEV`                    | [React](../frameworks/react.md#start-ayme-at-the-root), [Vue](../frameworks/vue.md#start-ayme-at-the-root), [Svelte](../frameworks/svelte.md#start-ayme-at-the-root) |
| Angular                  | `isDevMode()` from `@angular/core`       | [Angular](../frameworks/angular.md#start-ayme-in-the-application-config)                                                                                             |
| SvelteKit                | `dev` from `$app/environment`            | [Svelte](../frameworks/svelte.md#start-ayme-at-the-root)                                                                                                             |
| Next.js                  | `process.env.NODE_ENV === "development"` | [React: Server rendering](../frameworks/react.md#server-rendering)                                                                                                   |
| Nuxt                     | `import.meta.dev`                        | [Vue: Server rendering](../frameworks/vue.md#server-rendering)                                                                                                       |

With Vite, a development build you serve without a dev server, such as static files, comes from `NODE_ENV=development vite build`. `vite build --mode development` alone still builds with `NODE_ENV=production`, so `import.meta.env.DEV` is `false` and both features stay off.

## Register the server in your agent

Register the copy of `@ayme-dev/mcp` your app installed. It always matches the page client in your app, and nothing is downloaded again. The command is `npx` with the arguments `--no -p @ayme-dev/mcp ayme mcp`, and the agent has to start it in the app's folder, as an agent you run from that folder does. `--no` stops `npx` from downloading anything, so started from any other folder, the server fails to start instead of running another version.

Claude Code:

```sh
claude mcp add ayme -- npx --no -p @ayme-dev/mcp ayme mcp
```

Add `--scope project` before `ayme` to share the server with your team through the project's `.mcp.json`.

Codex:

```sh
codex mcp add ayme -- npx --no -p @ayme-dev/mcp ayme mcp
```

Or add it to `.codex/config.toml` in a trusted project:

```toml
[mcp_servers.ayme]
command = "npx"
args = ["--no", "-p", "@ayme-dev/mcp", "ayme", "mcp"]
```

Cursor, in the project's `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "ayme": {
      "type": "stdio",
      "command": "npx",
      "args": ["--no", "-p", "@ayme-dev/mcp", "ayme", "mcp"]
    }
  }
}
```

Any other MCP client takes the same command, `npx`, with the arguments `--no -p @ayme-dev/mcp ayme mcp`. Restart the agent after registering, so it starts the server and lists `ayme_connect`.

If your agent starts its servers in another folder, as one registered for every project may, pin the server to the version your app installed instead, so it still matches the page client. `npm ls @ayme-dev/mcp` prints that version. The command is `npx` with the arguments `-y @ayme-dev/mcp@<version> mcp`, such as `claude mcp add ayme -- npx -y @ayme-dev/mcp@<version> mcp`. `npx` downloads that version the first time.

### Options

Options go after `mcp`, in the command or the client's `args` list:

| Option                  | What it adds                                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--browser-tools`       | Ayme's own browser driving: the [Browser Tools](../reference/browser-tools.md), `snapshot`, `goal` and your Custom Tools. Use it when Ayme is your agent's only browser automation. Without it, see [What the agent sees](#what-the-agent-sees). |
| `--port <port>`         | Listens on that port only; see [Ports](#ports).                                                                                                                                                                                                  |
| `--page-objects <file>` | Experimental: serves that entry's Page Objects; see [Page Objects on a page without Ayme](page-objects-without-ayme.md).                                                                                                                         |

For an agent with no other browser automation, such as Playwright MCP, Claude Code:

```sh
claude mcp add ayme -- npx --no -p @ayme-dev/mcp ayme mcp --browser-tools
```

`ayme mcp --help` prints the options and what each adds.

## Connect a tab

Run your dev server and ask the agent to connect to the page, giving it the URL, such as `http://localhost:5173/`. The agent calls `ayme_connect` and gets back that URL with `#ayme=...` appended, which carries the server's address and a token.

- The agent can open the link in its own browser tool, or give it to you to open in yours.
- Pasting the link into a tab that already shows the app changes only its hash, so the page does not reload and keeps its state. The page removes the fragment from the address bar once it has read it.
- On `localhost` or `127.0.0.1`, an open tab with no link pairs by itself when exactly one Ayme MCP server is running. It looks when the page loads and again each time the tab gains focus, so a tab opened before the agent started pairs once you switch back to it. With several servers running, it stays unpaired until you paste a link, so it never pairs with the wrong agent.
- A server already working with a tab ignores other tabs that look for a server; only its connect link moves it. The newest tab wins: opening the link in a second tab moves the agent there, and the first tab is no longer connected.

A duplicated tab keeps presenting the original tab's id, unlike a fresh second tab, and reopening a link with the same address and token does not give it a new id.

## What the agent sees

Once a tab is paired, the page's tools are the agent's MCP tools, under the names the page gives them: the Page Object Tools of every Page Object on the page, `page_objects`, and the Peek Tools of the page's [Peeks](../reference/ayme.md#aymepeek), `peek.<name>`. Each App Process paired beside the tab adds its own Peek Tools, `peek.node.<name>`. The agent clicks, types and reads the page with its own browser automation, such as Playwright MCP, Playwright CLI or agent-browser, and Ayme adds your Page Objects to it.

With `--browser-tools`, the agent also gets Ayme's own browser driving: `snapshot`, the [Browser Tools](../reference/browser-tools.md), your Custom Tools, and `goal` when the Goal Loop is configured. The page lists the same tools either way and your app's code does not change: the server decides which of them the agent sees.

A good first check is to ask the agent to call one of your Page Object Tools and confirm the effect in the app.

A Peek's values reach the agent, and its model provider, unchanged, so return only what you want it to see; see [What a Peek exposes](../reference/ayme.md#what-a-peek-exposes).

Page Object Tools appear and disappear as Page Objects come and go, Peek Tools as Peeks do, and the server tells the agent each time the list changes. A tool whose action cannot run now stays listed, and a call to it is refused with its reason. [`@ayme.action`](ayme-page-objects.md#aymeaction) shows one. When the page's tools changed since the agent's previous call, the result also says which ones appeared or disappeared, which changed their parameters, description or annotations, and which became available or unavailable, with the reason. A Page Object Tool's result says none of this. It is [its short answer](page-state.md#a-page-object-tools-answer-to-an-agent) alone, and the next result of another tool says what changed. A tool marked [destructive](../reference/ayme.md#destructive-actions) is listed with `annotations: { destructiveHint: true }`, and every other page tool without annotations.

`ayme_inspect` returns the URL of the [Inspector in a window of its own](inspector.md#in-a-window-of-its-own), which the same server serves, and `ayme inspect` prints it from a terminal. An Agent App that shows MCP Apps shows that Inspector in the chat. Both need the optional `@ayme-dev/inspector` package, and say to install it when it is missing.

Some agents read the tool list once, when they start, so they never see the page's tools, which arrive later. For them, `ayme_list_tools` lists the page's current tools with their input schemas, whether each is available and why not, and `ayme_call` runs any of them by name, with the tool's name as `tool` and its input as `input`. A failed tool call answers with an error result. Input that does not match a tool's input schema, the schema of `ayme_connect`, `ayme_list_tools`, `ayme_call` or `ayme_inspect` included, is refused before the tool runs, with a sentence for each problem: `ToolInputError: Input property name is not supported. Input property tool is required.` While neither a tab nor an App Process is paired, every page tool and fallback tool answers that no page is connected. Right after `ayme_connect`, though, a call of a page tool or `ayme_list_tools` waits up to 10 seconds for the page its link opens to pair, since the agent opens the link only once it has the answer.

## Reloads, navigation and closed tabs

The connection follows its tab through reloads and through navigation to other pages of the same origin: the new document pairs again by itself and the agent sees its tools. Every call gets an answer: when the page reloads, navigates or closes before a call finishes, the agent gets an error that says what happened and that the call's outcome is unknown.

A closed tab, or navigation to another origin, ends the connection. Ask the agent to call `ayme_connect` again and open the new link.

## Ports

The server listens on the loopback interface only, on the first free port from 9350 to 9365, the range an open tab looks through. To use another port, add `--port <port>` after `mcp` in the registration; the server then fails to start if that port is taken. The connect link carries the port, so the page needs no setting, but a tab pairs with a server outside the range only through its link.

## Limits

- A page whose app doesn't ship Ayme never pairs. With Playwright MCP, Playwright CLI or agent-browser, `ayme mcp` can serve your Page Objects to it; see [Page Objects on a page without Ayme](page-objects-without-ayme.md).
- The agent and the browser must run on the same machine. Remote agents, such as an agent on another machine driving a browser on your computer, are not supported.
- From an origin other than `localhost` or `127.0.0.1`, such as a deployed preview, a tab pairs only through a link, and Chrome may ask you to allow local network access before the page can reach the server. Allow it and reload.

[Troubleshooting](../troubleshooting.md#the-agent-cannot-reach-the-page) covers the common problems.
