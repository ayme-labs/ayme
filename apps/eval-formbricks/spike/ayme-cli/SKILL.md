---
name: ayme-cli
description: Use Ayme's Page Object Tools from the `ayme` command, beside the browser automation you already drive the browser with (Playwright CLI or agent-browser). Use when a project has Page Objects and the `ayme` command is on your PATH.
---

# Using Ayme's `ayme` command with browser automation tools

You keep driving the browser with the automation you already use. The `ayme`
command adds two things for the tab it is attached to: a Page Object Tool for
each action of the Page Objects on the screen, and the Page Object Tree, which
lists those Page Objects with the id (`po<n>`) each rooted Page Object Tool
takes.

On each new screen, starting with the first one, run `ayme tools` before you
take a snapshot. When a Page Object Tool does the next step, call it; take a
snapshot only when none does.

## The commands

Run them in the project folder. Each one prints its answer and exits.

- `ayme tools` prints each Page Object Tool: its name (`<Class>.<action>`),
  what it does, and its parameters as a JSON schema.
- `ayme page-objects` prints the Page Object Tree: each Page Object on the
  screen under its class name, its declared children with their values, and
  the id (`po<n>`) of each Page Object that has a root. Its last line says
  how many Page Object Tools the screen has.
- `ayme call <tool> '<json parameters>'` calls a Page Object Tool. Leave the
  parameters out when the tool takes none. A tool of a class with ids takes
  the id as `id` and the action's own arguments as `args`:
  `ayme call BasketItem.rename '{"id":"po3","args":{"name":"Milk"}}'`.

A call answers one line of JSON: `settled` (whether the page went quiet after
the action), `result` (what the action returned, if anything), `url` (only
when the action changed it), `loading` (a new document is loading), and
`changes` (the Page Objects that appeared or went away and the values that
changed, as a tree). A failed call prints the error and exits with 1.

- **After a Page Object Tool:** read the Page Object Tree, chained in the same
  command: `ayme call <tool> '<json>' && ayme page-objects`.
- **After a navigation:** the ids of the earlier screen are gone. Run
  `ayme page-objects` again, and `ayme tools` when the screen is a new one.
- **An id that is not on the page:** the call answers that the Page Object is
  not on the page. Read `ayme page-objects` and call again with the id it
  shows.

## Starting it

Ayme runs as one background process per project folder, attached to one tab
of the browser your automation owns. If `ayme page-objects` answers that no
Ayme process is running, start one:

1. Make your browser reachable over the Chrome DevTools Protocol (CDP), as
   your tool's section below says.
2. Name the tab: write a token of your choice into it with your automation's
   own eval command, as `window.__aymeMark`.
3. Run `ayme attach --cdp <endpoint> --mark <token>`. It takes the one tab
   that has the token, and refuses when no tab or more than one has it.

`ayme detach` stops the process. Ayme only attaches: it never opens, closes
or navigates the browser, and it leaves dialogs to your automation. Answer an
open dialog with your automation before the next `ayme` command, which
otherwise waits for it.

### Playwright CLI

- **CDP:** open the browser with a config file that sets
  `browser.launchOptions.args` to `["--remote-debugging-port=<port>"]`:
  `playwright-cli open <url> --config=<file>`. The endpoint is
  `http://127.0.0.1:<port>`.
- **Mark:** `playwright-cli eval '() => (window.__aymeMark = "<token>")'`.

### Playwright MCP

- **CDP:** start Playwright MCP with a config file that sets
  `browser.launchOptions.args` to `["--remote-debugging-port=<port>"]`:
  `--config=<file>`. The endpoint is `http://127.0.0.1:<port>`.
- **Mark:** call `browser_evaluate` with the function
  `() => (window.__aymeMark = "<token>")`.

### agent-browser

- **CDP:** `agent-browser get cdp-url` prints the endpoint.
- **Mark:** `agent-browser eval 'window.__aymeMark = "<token>"'`.
- Keep the tab Ayme is attached to as agent-browser's active tab: a Page
  Object Tool that clicks waits and fails on a tab in the background.
