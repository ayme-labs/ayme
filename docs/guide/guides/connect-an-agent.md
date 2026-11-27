# Connect an agent

How to let Claude Code, Codex, Cursor or another coding agent call your Page Object Tools with the `ayme` command, beside the browser automation it already uses.

## How it works

A coding agent drives the browser with its own browser automation, such as Playwright CLI, Playwright MCP or agent-browser. The `ayme` command adds your Page Object Tools to it.

The agent starts a Session with `ayme open` or `ayme attach`. A Session is one running ayme connected to one browser: the same browser the agent's automation drives. It runs your project's Page Objects in Node, on your project's own Playwright. Nothing of ayme has to be in your app, so it works on any page, whether your app ships ayme or not.

The agent then reads the screen and acts through your Page Objects:

- `ayme page-objects` prints the Page Object Tree of the screen, with the id each rooted Page Object Tool takes.
- `ayme tools` lists the screen's Page Object Tools with their parameters.
- `ayme call <tool>` runs one, and prints what the action returned and how the Page Object Tree changed.

The agent's browser automation keeps doing everything else: snapshots, clicks outside your Page Objects, navigation, and answering dialogs.

## Set up your project

1. Install the `ayme` command, `@ayme-dev/cli`, as a dev dependency. It needs `@ayme-dev/ayme` at exactly the same version, and Playwright 1.62 or newer:

   ```sh
   npm install -D @ayme-dev/cli @ayme-dev/ayme @playwright/test
   ```

   The command runs your Page Objects with your project's own `@ayme-dev/ayme` and Playwright. When a version does not fit, it does not start, and says which version to install.

   If your project has `@ayme-dev/mcp`, uninstall it with `npm uninstall @ayme-dev/mcp`. It is retired, and its command is also called `ayme`, so `npx ayme`, and even `npx @ayme-dev/cli`, can run it instead of this one.

2. Keep your [Page Object Models](ayme-page-objects.md) in the [`ayme` folder](ayme-folder.md), and list them in `ayme/page-objects.ts`. Its default export is an array of your Page Object classes, as the `pageObjects` option of [`createAyme`](../reference/ayme.md#createayme) takes them:

   ```ts
   // ayme/page-objects.ts
   import type { AymeOptions } from "@ayme-dev/ayme";

   import { ProjectsPage } from "./pom/ProjectsPage";

   export default [ProjectsPage] satisfies AymeOptions["pageObjects"];
   ```

   If your app ships ayme, list the same classes it registers.

3. For `ayme open`, which starts its own browser, install Chromium for your project's Playwright once:

   ```sh
   npx playwright install chromium
   ```

4. Install the [`ayme` skill](coding-agent-skill.md#ayme) in your project. It tells your agent how to connect ayme and its browser automation to one browser, and when to read the screen:

   ```sh
   npx skills add ayme-labs/ayme --skill ayme
   ```

Then ask your agent to call one of your Page Object Tools, and to confirm the effect in your app.

## Connect ayme and the browser automation to one browser

The agent runs the commands in your project's folder, as `npx ayme <command>`. The commands below are written `ayme <command>` for short.

Connect both before the agent acts on the page. Chrome answers no new DevTools connection while a dialog is open, so an automation that connects after an action opened a dialog cannot answer it.

### Playwright CLI

ayme opens the browser, and Playwright CLI attaches to it:

```sh
ayme open http://localhost:5173/
playwright-cli attach --cdp=http://127.0.0.1:49370
```

`ayme open` starts Chromium without a window, and prints the address Playwright CLI attaches to; `http://127.0.0.1:49370` stands for it. `--headed` opens a visible window.

### agent-browser

agent-browser opens the browser, and ayme attaches to it:

```sh
agent-browser open http://localhost:5173/
ayme attach --cdp="$(agent-browser get cdp-url)"
```

`agent-browser get cdp-url` prints the browser's address.

### Playwright MCP

Playwright MCP opens the browser on a debugging port you fix in its configuration, and ayme attaches to it. Give Playwright MCP a config file that opens the browser on a free port, such as `9222`:

```json
{
  "browser": {
    "launchOptions": { "args": ["--remote-debugging-port=9222"] }
  }
}
```

Pass the file in Playwright MCP's registration in your project's MCP configuration, such as `.mcp.json` for Claude Code:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--config=playwright-mcp.json"]
    }
  }
}
```

Playwright MCP starts the browser at its first tool call, such as `browser_navigate`. The agent then attaches:

```sh
ayme attach --cdp=http://127.0.0.1:9222
```

## Sessions

- **The tab.** ayme works on the browser's most recently active tab, and follows the tab the agent's automation switches to or opens. The first line of `ayme page-objects` and `ayme tools` names that tab. `--tab=<url>` reads another tab, by the URL that line shows. A Page Object Id is unique across a Session's tabs, so a call runs on the tab its Page Object is on.
- **Names.** A project folder can have several Sessions, each with a name: `-s=<name>`, or the `AYME_SESSION` environment variable, as in Playwright CLI. Without either, the name is `default`. `ayme list` lists the Sessions of the folder. Two agents in one folder each use a name of their own.
- **The end.** `ayme detach` ends a Session started with `ayme attach` and leaves the browser running. `ayme close` ends any Session, and closes the browser only when `ayme open` opened it. A Session also ends when its browser goes away.
- **Edits.** A Session builds your Page Objects when it starts. After you edit them, end the Session and start it again. When the build fails, the Session does not start, and the command prints the build error.

## What the agent sees

`ayme page-objects` on a page with a `ProjectsPage` that holds a collection of `ProjectRow`:

```text
Tab: Projects (http://localhost:5173/projects)
ProjectsPage
  projects:
    - ProjectRow po1
        name: text: Launch plan
    - ProjectRow po2
        name: text: Q4 survey
This screen has 3 Page Object Tools: ayme -s=default tools lists them with their parameters.
```

`ayme call` takes the tool's input as one JSON object, `--params '<json>'`, or `--params @<file>` to read it from a file. A tool of a Page Object with an id takes the id as `id` and the action's own arguments under `args`:

```sh
ayme call ProjectRow.rename --params '{"id": "po1", "args": {"name": "Launch plan v2"}}'
```

It answers with whether the page settled, what the action returned, the URL when the action changed it, and how the Page Object Tree changed: [a Page Object Tool's answer to an agent](page-state.md#a-page-object-tools-answer-to-an-agent).

Each command prints plain text, or JSON with `--json`. An error goes to standard error, with exit code 1. A tool that cannot run now is listed with its reason, and a call to it is refused with that reason.

`ayme --help` lists every command and option.

## Limits

- Chromium only, on Playwright 1.62 or newer.
- A Session turns focus emulation on for each tab it works on, so that an action works the same on a tab in the background. While a Session is connected, an app that reacts to being hidden does not react.
- A Session offers your Page Object Tools only. It has no Browser Tools, Custom Tools or Goal Loop: the agent's browser automation does the rest.

[Troubleshooting](../troubleshooting.md#the-agent-cannot-reach-the-page) covers the common problems.
