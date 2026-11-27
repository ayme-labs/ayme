# Connect an agent

How to let Claude Code, Codex, Cursor or another coding agent call your Page Object Tools with the `ayme` command, beside the browser automation it already uses.

## How it works

The agent starts a Session, with `ayme open` or `ayme attach`, on the browser its own browser automation drives, such as Playwright CLI, Playwright MCP or agent-browser. The Session runs your project's Page Objects in Node, on your project's own Playwright, so nothing of ayme has to be in your app.

The agent then reads the screen and acts through your Page Objects:

- `ayme page-objects` prints the Page Object Tree of the screen, with the id each rooted Page Object Tool takes.
- `ayme tools` lists the screen's Page Object Tools with their parameters.
- `ayme call <tool>` runs one, and prints what the action returned and how the Page Object Tree changed.

The agent's browser automation keeps doing everything else: snapshots, clicks outside your Page Objects, navigation, and answering dialogs.

## Set up your project

1. Install the `ayme` command, `@ayme-dev/cli`, and Playwright as dev dependencies. The command supports Playwright 1.62 to 1.64, and the quotes keep npm to that range:

   ```sh
   npm install -D @ayme-dev/cli "@playwright/test@>=1.62 <1.65"
   ```

   The command runs your Page Objects with your project's own `@ayme-dev/ayme` and Playwright, and needs `@ayme-dev/ayme` at exactly its own version. When a version does not fit, it does not start, and says which version to install. `<version>` below is the version of `@ayme-dev/cli`, which `npm ls @ayme-dev/cli` prints.

   - If your app already ships ayme, bring every `@ayme-dev/*` package it has to `<version>` at once: `@ayme-dev/ayme`, your framework package such as `@ayme-dev/react`, `@ayme-dev/unplugin-ayme`, and `@ayme-dev/inspector` and `@ayme-dev/webmcp` if you have them. Install each with `npm install <package>@<version>`, without `-D`: `-D` would move `@ayme-dev/ayme` to `devDependencies`, which an install of production dependencies leaves out. Then rebuild and restart your app.

     npm does not warn about a package you leave at another version. The framework packages, the build plugin and the Inspector each depend on `@ayme-dev/ayme` at exactly their own version, so one left behind brings its own copy, and your page runs that copy. A Session refuses such a page with `This document runs ayme's in-page module <old version>; this host is <version>.`

   - Otherwise, add it as a dev dependency: `npm install -D @ayme-dev/ayme@<version>`.

   The command compiles your Page Object Models with your project's own TypeScript, at a version [Install](../start/install.md#supported-versions) lists. If your project has none, install it: `npm install -D typescript`. With TypeScript 7, also install `@typescript/typescript6`.

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

`ayme attach` reads the browser's list of tabs over HTTP, at `json/list` under the address it joins, so a DevTools proxy has to serve that path too. A WebSocket address works only when it ends in `/devtools/browser/<id>`.

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

- **The Tab.** A Tab is one tab of the Session's browser. ayme works on the most recently active Tab, and follows the Tab the agent's automation switches to or opens. The first line of `ayme page-objects` and `ayme tools` names that Tab. `--tab=<url>` works on another Tab: the most recently active one at exactly the URL that line shows. A Page Object Id is unique across a Session's Tabs, so a call of a tool that takes one runs on the Tab its Page Object is on; leave `--tab` out of that call, since ayme refuses one that names another Tab. The last line of `ayme page-objects --tab=<url>` carries the same `--tab` into the `ayme tools` command it suggests.
- **Names.** A project folder can have several Sessions, each with a name: `-s=<name>`, or the `AYME_SESSION` environment variable, as in Playwright CLI. Without either, the name is `default`. `ayme list` lists the Sessions of the folder. Two agents in one folder each use a name of their own. A Session's name does not reach the browser automation, so each agent also needs an automation session of its own: `playwright-cli -s=<name>`, `agent-browser --session <name>`, or a debugging port of its own for Playwright MCP. Each agent passes the same one to every command, from opening the browser to closing it.
- **The end.** `ayme detach` ends a Session started with `ayme attach` and leaves the browser running. `ayme close` ends any Session, and closes the browser only when `ayme open` opened it. A Session also ends when its browser goes away.
- **Edits.** A Session builds your Page Objects when it starts, and again a moment after you save an edit to them, so a save and a formatter's write right after it make one build. It swaps the rebuilt ones in between Runs, never during one, so there is no need to start it again. A Page Object keeps its id across an edit when its class name and its element are unchanged. When the first build fails, the Session does not start, and the command prints the build error. When a later build fails, the Session keeps the Page Objects it has, and `ayme page-objects` and `ayme tools` say so on the line after the Tab line, with the first error, until a build succeeds. The same line tells when a Tab could not take a rebuild, or when ayme cannot watch the source; [Troubleshooting](../troubleshooting.md#the-agent-cannot-reach-the-page) gives each message. Every rebuild stays in the Session's memory until the Session ends. A module that, when it loads, changes a file the build reads, such as one it imports, makes each load an edit, so the Session rebuilds in a loop.

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

`ayme call` takes the tool's input as one JSON object, `--params '<json>'`, or `--params @<file>` to read it from a regular file of at most 1 MiB (1,048,576 bytes). A relative path starts at the project's folder. A tool of a Page Object with an id takes the id as `id` and the action's own arguments under `args`:

```sh
ayme call ProjectRow.rename --params '{"id": "po1", "args": {"name": "Launch plan v2"}}'
```

It answers with whether the page settled, what the action returned, the URL when the action changed it, and how the Page Object Tree changed: [a Page Object Tool's answer to an agent](page-state.md#a-page-object-tools-answer-to-an-agent).

A Session's answers are plain text, or JSON with `--json`. In JSON, an answer is `{"ok": true, "text": …, "data": …}` on standard output, where `data`, when present, holds its fields, such as a call's `settled`, `result`, `url` and `changes`; a failure is `{"ok": false, "text": …}` on standard error. The command's own errors, such as an option it does not know, and `--help` are plain text, also with `--json`, and `ayme mcp` refuses `--json`. An error goes to standard error, with exit code 1. A tool that cannot run now is listed as unavailable, with its reason when the app gives one, and a call to it is refused.

`ayme --help` lists every command and option.

## Dialogs

ayme never answers a dialog: the agent answers it with its browser automation, which has to be [connected before the action that opens it](#connect-ayme-and-the-browser-automation-to-one-browser).

A dialog counts as open once it has stayed open for 100 ms. While one is open on a Tab, every command that needs that Tab's page fails at once with the dialog's text and did nothing, so the agent runs it again once the dialog is answered. `ayme page-objects` and `ayme tools` still print the Tab line first, and the build line after it when there is one:

```text
Tab: http://localhost:5173/projects
A confirm dialog is open on the tab: "Delete Launch plan?". Answer it with your browser automation, then run this command again.
```

A dialog affects only its own Tab.

An action stops at a dialog it did not answer itself. When a dialog opens during a Run and stays open for 100 ms, `ayme call` fails at once:

```text
A confirm dialog is open on the tab: "Delete Launch plan?". Answer it with your browser automation. The action stopped there: ayme refuses its further calls on the page, however the dialog is answered. Check the page before you choose the next step.
```

ayme refuses each later Playwright call of the action, whether the agent accepts or dismisses the dialog. A call already sent to the browser when the dialog opened, and work inside one `page.evaluate`, still finish once the dialog is answered. No later command tells what the stopped action returned or threw, and the Inspector shows the Run as failed with the dialog's text. The next Run on that Tab starts once the stopped action has ended.

A dialog closed within the 100 ms does not stop the Run. That covers an `alert` some automations accept by themselves, and an action that answers its own dialog, as a Playwright test does:

```ts
this.page.once("dialog", (dialog) => dialog.accept());
```

ayme cannot stop everything at the dialog:

- An action that takes longer than 100 ms to answer its own dialog is stopped like any other.
- ayme checks the calls an action makes through its page and through what the page hands out: locators, frames, element handles, the browser context, other pages, and what Playwright hands a listener, such as a dialog. A Playwright object the action reaches another way, or one handed over inside plain data, such as the source `exposeBinding` passes its function, is not checked, and neither is `page.coverage`.
- A listener the action adds through its page runs as part of the action. A function the action hands to other code that calls it later, such as a list of callbacks a timer from before the action works through, does not, and its calls are not checked.
- A dialog listener an earlier Run added and never used answers a later dialog.
- Playwright dismisses a dialog that opens while ayme joins the browser.

## Limits

- Chromium only, on the Playwright versions [Set up your project](#set-up-your-project) names.
- A Session runs your actions on your project's Playwright library, without your Playwright Test config or fixtures: an action gets no `baseURL`, test id attribute or login from them. Navigate with absolute URLs, and set up the browser state an action needs, such as a login, with your browser automation.
- A Session turns focus emulation on for each Tab it works on, so that an action works the same on a Tab in the background. While a Session is connected, an app that reacts to being hidden does not react.
- A Session offers your Page Object Tools only. It has no Browser Tools, Custom Tools or Goal Loop: the agent's browser automation does the rest.

[Troubleshooting](../troubleshooting.md#the-agent-cannot-reach-the-page) covers the common problems.
