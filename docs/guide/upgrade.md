# Upgrade

What to change in your project when you move to a new release of ayme.

## From 0.3 to 0.4

In 0.4, one package, `@ayme-dev/cli`, provides one command, `ayme`. A coding agent reaches your Page Objects through a Session: one running ayme connected to the browser that the agent's browser automation drives, such as Playwright CLI, Playwright MCP or agent-browser. The Session runs your Page Objects in Node, on your project's own Playwright, so nothing of ayme has to be in your app. [Connect an agent](guides/connect-an-agent.md) shows the setup.

`@ayme-dev/mcp` is retired, and with it everything its `ayme mcp` did: the Agent Connection, pairing, the init script, served Page Objects and App Processes.

### 1. Change the packages

1. Uninstall the retired package, and its global install if you have one. It also provides a command named `ayme`, so while it is installed, `npx ayme` can run the old one:

   ```sh
   npm uninstall @ayme-dev/mcp
   npm uninstall -g @ayme-dev/mcp
   ```

2. Install `@ayme-dev/cli`, Playwright and, if your project has none, TypeScript, as [Set up your project](guides/connect-an-agent.md#set-up-your-project) shows.
3. Bring every `@ayme-dev/*` package your project has to the version of `@ayme-dev/cli`, at once: `@ayme-dev/ayme`, your framework package (`@ayme-dev/react`, `@ayme-dev/vue`, `@ayme-dev/svelte` or `@ayme-dev/angular`), `@ayme-dev/unplugin-ayme`, `@ayme-dev/inspector` and `@ayme-dev/webmcp`. Keep each in the dependency section it is in: `npm install <package>@<version>`, without `-D`. `npm ls` lists the packages you have. Then rebuild and restart your app.

   npm does not warn about a package you leave at 0.3. The framework packages, the build plugin and the Inspector each depend on `@ayme-dev/ayme` at exactly their own version, so one left at 0.3 brings its own `@ayme-dev/ayme` 0.3, and your page runs that. A Session refuses such a page: `This document runs ayme's in-page module 0.3.0; this host is 0.4.0.`

4. Install the skills again. The recorder's skill is now called `ayme-capture`, so delete the `ayme-recorder` skill from your project too:

   ```sh
   npx skills add ayme-labs/ayme --skill ayme
   npx skills add ayme-labs/ayme --skill ayme-capture
   ```

### 2. Delete what no longer works

From your app's code:

- **`agentConnection`**, wherever ayme starts: `createAyme`, `AymeProvider`, `useAyme` or `provideAyme`.
- **`placement`** in the `inspector` option. `inspector: true` turns on the panel in the page, and `inspector: { demo: true }` turns on Demo Mode. Where you used `{ placement: "external" }`, use the panel, or [`ayme inspect`](guides/inspector.md#on-a-session-ayme-inspect) on a Session. Left in code that TypeScript does not check, `{ placement: "external" }` now turns on the panel in the page.
- **ayme on your server, for Peeks**: a `createAyme({ agentConnection: true }).start()` in Next.js's `instrumentation.ts` or in a Nuxt server plugin, and every module that adds a Peek on the server. On the server, `createAyme().start()` from `@ayme-dev/ayme` now starts nothing, and `ayme.peek` adds nothing. Peeks you add in components stay, and so does `@ayme-dev/ayme/playwright` in your tests.
- **`callers.aymeMcp`**, if your code compares a Run's Caller with it. No Run has that Caller now, and `"ayme-mcp"` is no longer a `BuiltInCaller`.
- **Imports from `@ayme-dev/mcp/client` and `@ayme-dev/mcp/process`**, and the `startAgentConnection` calls they provided.
- **`AgentConnectionOptions`**, a type `@ayme-dev/ayme` no longer exports.

From your project's files and your agent's settings:

- **The old `ayme mcp` in your agent's MCP configuration**: the server that runs `npx --no -p @ayme-dev/mcp ayme mcp`, or `npx -y @ayme-dev/mcp@<version> mcp`, in `.mcp.json`, `.codex/config.toml`, `.cursor/mcp.json` or wherever you registered it. To see a Session's Inspector in your Agent App's chat, register the new [`ayme mcp`](guides/inspector.md#in-your-agent-apps-chat-ayme-mcp) instead. Remove the old one before the init script: it writes the script again each time it starts.
- **The init script**: delete `ayme/init-script.js`. In `ayme/.gitignore`, delete the line `init-script.js`, and the comment above it that starts `# ayme mcp writes`. Delete the file if nothing else is left in it.
- **The browser automation's settings for the init script**: `initScript`, `bypassCSP` and the `local-network-access` permission in a Playwright MCP or Playwright CLI config file, such as `.playwright/cli.config.json`, and agent-browser's `--init-script` flag. Playwright MCP needs a fixed debugging port instead, as [Connect an agent](guides/connect-an-agent.md#playwright-mcp) shows.

### 3. Use the new commands

| Before                                                                                                                                         | Now                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ayme mcp`, then `ayme_connect` and a link that pairs the page                                                                                 | `ayme open [url]` or `ayme attach --cdp=<url>`, which start a Session                                                                                                                                                                                                                                                      |
| The tools `page_objects`, `ayme_list_tools` and `ayme_call`                                                                                    | `ayme page-objects`, `ayme tools` and `ayme call <tool> --params '<json>'`                                                                                                                                                                                                                                                 |
| `ayme inspect` and `ayme_inspect`, which gave the address of the paired page's Inspector; `ayme_inspect` also showed it in an Agent App's chat | `ayme inspect`, which opens a Session's Inspector in a browser window, and `ayme mcp`, which shows it in an Agent App's chat. For a window you open by hand, `BROWSER=none ayme inspect` prints an address that opens one window, within five minutes; see [`ayme inspect`](guides/inspector.md#on-a-session-ayme-inspect) |
| `ayme mcp --page-objects <file>`                                                                                                               | Nothing: a Session runs the classes `ayme/page-objects.ts` lists. Make its default export the classes your file listed. A Session builds it for Node, so everything it imports must load in Node                                                                                                                           |
| `ayme mcp --port <port>`, `ayme inspect --port <port>`                                                                                         | Nothing: nothing pairs any more. To run several Sessions side by side, name each with `-s=<name>`                                                                                                                                                                                                                          |
| `ayme-recorder codegen <url>`                                                                                                                  | `ayme capture <url>`                                                                                                                                                                                                                                                                                                       |
| `ayme-recorder codegen --cdp-endpoint <address>`                                                                                               | `ayme capture --cdp=<url>`                                                                                                                                                                                                                                                                                                 |
| `ayme-recorder trace latest` or `ayme-recorder trace <recording-id>`                                                                           | `npx playwright trace open ayme/recordings/<recording-id>/trace.zip`                                                                                                                                                                                                                                                       |
| `ayme-recorder trace <path>`, and other `trace` commands such as `trace actions`                                                               | `npx playwright trace` with the same arguments, such as `npx playwright trace open <path>`                                                                                                                                                                                                                                 |
| `ayme-recorder install [browser]`, with any flags                                                                                              | `npx playwright install` with the same arguments, or `npx playwright install chromium` without any                                                                                                                                                                                                                         |
| `ayme-recorder --version`                                                                                                                      | `ayme --version`                                                                                                                                                                                                                                                                                                           |

To start, open a Session as [Connect an agent](guides/connect-an-agent.md#connect-ayme-and-the-browser-automation-to-one-browser) shows for your browser automation, then run `ayme tools` to see what your Page Objects offer.

### 4. What has no replacement

- **Pairing with a page that ships ayme.** No coding agent reaches the ayme inside your app. It reaches your Page Objects through a Session, which runs them itself. An agent that runs in the page reaches the page's tools through [WebMCP publication](guides/publish-tools.md).
- **Peeks for an agent.** A Peek exists only while `inspector` is on where ayme starts: you run it in the Inspector, and your app's code can run it through `ayme.tools`. ayme gives it to no agent.
- **Reading your server's state.** App Processes are gone: no Node process of your app offers anything to an agent.

### 5. What works differently

- **In a Session, your Page Object Actions run on your project's Playwright library**, not on ayme's own in-page version of it. The Session does not load your Playwright Test config or fixtures: see [Limits](guides/connect-an-agent.md#limits).
- **ayme never answers a dialog.** When a dialog opens during a Run and stays open for 100 ms, the action stops there. An action that answers its own dialog within that time goes on. [Dialogs](guides/connect-an-agent.md#dialogs) gives the details.
- **A Run can answer later.** When an action returns a Page Object whose model declares or inherits `present`, the Run answers once that predicate holds, or at the Settled Page deadline. [The Page Object an action returns](guides/page-state.md#the-page-object-an-action-returns) says when the wait starts and when there is none.
- **`@ayme-dev/inspector/external` shows a Session's Inspector**, as `ayme inspect` and `ayme mcp` serve it, and no longer a paired page's. If you hosted the old external Inspector yourself, use `ayme inspect` or `ayme mcp` instead.
- **An edit to your Page Objects takes effect without a restart.** The Session rebuilds them and swaps them in between Runs. See the Edits item in [Sessions](guides/connect-an-agent.md#sessions).
