# Using ayme with browser automation tools

You keep driving the browser with the automation you already use: Playwright
CLI, Playwright MCP or agent-browser. The `ayme` command adds the project's
Page Object Tools to it. A Session is one running ayme connected to one
browser: it runs the project's Page Objects in Node, on the browser your
automation drives. Your automation keeps doing everything else: snapshots,
clicks outside Page Objects, navigation, and answering dialogs.

Run each command in the project's folder. Write it `npx ayme <command>` when
the project has `@ayme-dev/cli` in its `package.json`. Below, the commands
are written `ayme <command>` for short. When the project has no
`@ayme-dev/cli`, read [Browser setup](browser-setup.md) first.

## Connect ayme and your automation to one browser

Connect both before you act on the page. Chrome does not answer a DevTools
client that connects while a dialog is open, so an automation that connects
after an action opened a dialog cannot answer it.

### Playwright CLI

ayme opens the browser, and Playwright CLI attaches to it:

1. `ayme open <url>` starts a Session on a new Chromium, without a window,
   at `<url>`. It prints the browser's address, such as
   `http://127.0.0.1:49370`. Add `--headed` for a visible window.
2. `playwright-cli attach --cdp=<address>`, with the address `ayme open`
   printed.

End with `playwright-cli close`, which leaves the attached browser running,
then `ayme close`, which closes the browser ayme opened.

### agent-browser

agent-browser opens the browser, and ayme attaches to it:

1. Open the page with agent-browser, such as `agent-browser open <url>`.
2. `ayme attach --cdp="$(agent-browser get cdp-url)"`. `agent-browser get cdp-url`
   prints the browser's address.

End with `ayme detach`, which leaves the browser running, then
`agent-browser close`.

### Playwright MCP

Playwright MCP opens the browser, on a debugging port fixed in the project's
MCP configuration, and ayme attaches to it:

1. Give Playwright MCP a config file that opens the browser on a fixed port,
   such as `9222`, and pass the file in its registration with
   `--config=<file>`:

   ```json
   {
     "browser": {
       "launchOptions": { "args": ["--remote-debugging-port=9222"] }
     }
   }
   ```

   A new registration reaches you only after your client restarts. When you
   cannot register it or restart yourself, give the user the registration and
   ask them to restart you.

2. Open the page with a Playwright MCP tool, such as `browser_navigate`:
   Playwright MCP starts the browser on its first call.
3. `ayme attach --cdp=http://127.0.0.1:9222`.

End with `ayme detach`, which leaves the browser running.

## The Session

- When a command answers that no Session is open, start one as above.
  `ayme list` lists the Sessions of the project's folder.
- `-s=<name>`, or `AYME_SESSION`, names a Session, so that two agents in one
  folder each have their own. Every command of that Session takes the same
  name, and your automation needs a session of its own too.
- [Sessions](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md#sessions)
  says how to name your automation's session, which Tab ayme works on, and
  how a Session ends.
