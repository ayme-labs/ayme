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

Page Object Tools appear and disappear as Page Objects come and go, Peek Tools as Peeks do, and the server tells the agent each time the list changes. A tool whose action cannot run now, because a click would not reach its Page Object Root or its [availability predicate](ayme-page-objects.md#aymeaction) says so, stays listed, and calling it is refused with its reason before anything runs. When the page's tools changed since the agent's previous call, the result also says which ones appeared or disappeared, which changed their parameters or description, and which became available or unavailable, with the reason.

`ayme_inspect` returns the URL of the [Inspector in a window of its own](inspector.md#in-a-window-of-its-own), which the same server serves, and `ayme inspect` prints it from a terminal. Both need the optional `@ayme-dev/inspector` package, and say to install it when it is missing.

Some agents read the tool list once, when they start, so they never see the page's tools, which arrive later. For them, `ayme_list_tools` lists the page's current tools with their input schemas, whether each is available and why not, and `ayme_call` runs any of them by name, with the tool's name as `tool` and its input as `input`. A failed tool call answers with an error result. Input that does not match a tool's input schema, the schema of `ayme_connect`, `ayme_list_tools`, `ayme_call` or `ayme_inspect` included, is refused before the tool runs, with a sentence for each problem: `ToolInputError: Input property name is not supported. Input property tool is required.` While neither a tab nor an App Process is paired, every page tool and fallback tool answers that no page is connected.

## Reloads, navigation and closed tabs

The connection follows its tab through reloads and through navigation to other pages of the same origin: the new document pairs again by itself and the agent sees its tools. Every call gets an answer: when the page reloads, navigates or closes before a call finishes, the agent gets an error that says what happened and that the call's outcome is unknown.

A closed tab, or navigation to another origin, ends the connection. Ask the agent to call `ayme_connect` again and open the new link.

## Ports

The server listens on the loopback interface only, on the first free port from 9350 to 9365, the range an open tab looks through. To use another port, add `--port <port>` after `mcp` in the registration; the server then fails to start if that port is taken. The connect link carries the port, so the page needs no setting, but a tab pairs with a server outside the range only through its link.

## A page that doesn't ship Ayme

> **Experimental:** this may change in any release. See [Experimental APIs](../reference/experimental-apis.md).

When your agent drives the browser with Playwright MCP or Playwright CLI, it can get your Page Objects' tools on a page whose app doesn't ship Ayme, such as a staging site or an app you can't change. `ayme mcp` builds the Page Objects and serves them from its own loopback port, and the browser loads them into each page through an init script that `ayme mcp` writes.

### Keep the Page Objects in `.ayme/`

In the folder your agent starts `ayme mcp` in, usually the project's root:

- `.ayme/page-objects.ts` is the entry. Its default export lists the Page Object classes to register, in the shape of `createAyme`'s `pageObjects` option.
- `.ayme/pom/` is the suggested home for the Page Object files, written as [Page Object Models](ayme-page-objects.md) describes.

```ts
// .ayme/page-objects.ts
import type { AymeOptions } from "@ayme-dev/ayme";

import { SignInPage } from "./pom/SignInPage";

export default [SignInPage] satisfies AymeOptions["pageObjects"];
```

The entry resolves its imports from its own folder, so install `@ayme-dev/ayme`, `@ayme-dev/mcp` and TypeScript in the project that holds `.ayme/`, and `@playwright/test` for the `Page` and `Locator` types; [Install](../start/install.md) lists the supported versions. You need no build plugin: `ayme mcp` compiles the Page Objects with the project's own `@ayme-dev/ayme`. To serve another entry, add `--page-objects <file>` after `mcp` in the [registration](#register-the-server-in-your-agent), with a path relative to the folder `ayme mcp` starts in.

When it starts and finds the entry, `ayme mcp`:

- builds the entry and serves it, and serves it again after each edit to a file the entry imports. An open page swaps in the edited Page Objects without reloading; an update of `@ayme-dev/ayme` itself reloads it.
- logs a build that fails to its standard error, with each error's file, line and column, and keeps serving the last good build. Before any build succeeds, the page logs `The Page Objects ayme mcp serves at … did not load.` to its console.
- writes `.ayme/init-script.js`, which names the server's port, and adds it to `.ayme/.gitignore`, keeping the lines already there. Commit the entry, `.ayme/pom/` and `.ayme/.gitignore`, but not the init script: each start writes it again.
- adds a line to each `ayme_connect` answer that names the init script: `This server serves Page Objects to pages that load <folder>/.ayme/init-script.js.`

Without the entry, `ayme mcp` starts as before.

### Load them with Playwright MCP

Write Playwright MCP's config file, such as `playwright-mcp.config.json` in the project's root:

```json
{
  "browser": {
    "initScript": [".ayme/init-script.js"],
    "contextOptions": {
      "bypassCSP": true,
      "permissions": ["local-network-access"]
    }
  }
}
```

and register Playwright MCP with it, such as in Claude Code:

```sh
claude mcp add playwright -- npx @playwright/mcp@latest --config playwright-mcp.config.json
```

A path in the config file is relative to the config file's folder.

### Load them with Playwright CLI

Playwright CLI takes the same config file: `playwright-cli open --config playwright-cli.config.json <url>`. Without `--config` it reads `.playwright/cli.config.json`, and there the init script's path is `../.ayme/init-script.js`.

### What each setting does

- `initScript` loads the served Page Objects into each top-level page before the page's own scripts run. Frames and pages that aren't `http` or `https` get nothing.
- `bypassCSP` lets the page connect to `ayme mcp` on `127.0.0.1`. Without it, a page whose Content Security Policy limits its connections blocks that connection: the page never pairs, and the page's tools answer that no page is connected.
- The `local-network-access` permission lets a page on a public site reach `127.0.0.1`. Without it, Chrome's local network check blocks the connection in a headless browser and waits on a permission prompt in a headed one.

### Start order and `--port`

Playwright MCP and Playwright CLI refuse to start while the init script is missing, with `Init script file does not exist: …`. The init script is ignored by git, so in a fresh clone it exists only once `ayme mcp` has started in that folder; start it first, or restart the browser tool after it.

The browser reads the init script once, when it starts, so it keeps looking for the port `ayme mcp` had then. When the browser starts before `ayme mcp`, or keeps running while `ayme mcp` restarts on another free port, pin the port: add `--port <port>` after `mcp` in the registration, as in [Ports](#ports). Every start then writes the same init script, and an open page loads the Page Objects once `ayme mcp` is up, since the init script keeps trying to reach it.

### Connect

Ask the agent to call `ayme_connect` with the page's URL and open the link in its browser tool, as in [Connect a tab](#connect-a-tab). The page's tools, with your Page Objects' tools among them, then become the agent's MCP tools.

### Limits of served Page Objects

- Chromium-based browsers only.
- Navigating to another origin ends the connection, as for any page: call `ayme_connect` with a URL on the new origin and open its link.
- On a page whose app already ships Ayme, the app's own Ayme pairs too and wins: the agent gets the app's tools, not the served Page Objects' tools.

## Limits

- The agent and the browser must run on the same machine. Remote agents, such as an agent on another machine driving a browser on your computer, are not supported.
- From an origin other than `localhost` or `127.0.0.1`, such as a deployed preview, a tab pairs only through a link, and Chrome may ask you to allow local network access before the page can reach the server. Allow it and reload.

[Troubleshooting](../troubleshooting.md#the-agent-cannot-reach-the-page) covers the common problems.
