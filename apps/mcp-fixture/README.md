# MCP fixture

The end-to-end tests of the `ayme` command's Sessions, and the fixture app
they run against. It is private and never published. Its name is older than
its job: it held the tests of `@ayme-dev/mcp`, which is gone.

```
app/         the fixture pages, the stand-in Agent App and the Vite config
ayme/pom/    the app page's own Page Objects, which `app/main.ts` registers
command/     the ayme folder of the `ayme` command's projects: the entry and
             the Page Objects of its pages, written as for a Playwright test
tests/       the `ayme` fixture (aymeCommand.ts) and one spec per concern
```

Every spec runs the built `ayme` command of `@ayme-dev/cli` as a child
process, through the `ayme` fixture of `aymeCommand.ts`. Each test gets a project folder and a cache folder of its own
in its output folder, so the command uses the fixture's Playwright and
`@ayme-dev/ayme` and never finds another test's Session, and a temporary folder
of its own, which every process its commands start names, so each is ended with
the test, even one that never got as far as its record. The build of the Page
Objects writes there too, and the three folders are removed after the test.
The project folder holds a copy of `command/ayme`, whose Page Objects a Session
builds and runs in Node: they use Playwright only, since nothing of them runs
in the page. `shop.html` is a page without ayme that they describe:
`ShopPage`, and `Basket`, which has a Page Object Root and whose `clear` is
unavailable while the basket is empty. `sign-in.html` and `account.html`,
also without ayme, each have a Page Object present there alone:
`SignInPage`, whose `signIn` submits its form, a full page load, and returns
`AccountPage`, whose actions wait until the test sets `released` on the
page's window, throw, or leave an error and a rejection nothing catches.
`tabs.html`, without ayme, has `TabsPage`, whose action opens a tab, which
hides its own, and then clicks there. `dialogs.html`, without ayme, has
`DialogPage`, whose action clicks a button that asks a confirm and then clicks
Mark, leaving the confirm to the browser automation; its link opens
`alert-at-once.html`, which shows an alert as it loads. `GroceryList` is a
Session's Page Object on the app page, `/`, which ships ayme, so the page has
two Hosts: the page's own runtime registers `GroceriesPage`, and `Basket`
while Show basket has shown it, and publishes through WebMCP with `?webmcp`.
`plain.html` is a document of the same origin without ayme. The test's own Playwright
connection, at the address `ayme open` printed, plays the developer's browser
automation. `inspectSession.spec.ts` opens the address `ayme inspect` prints in the
test's own browser, which stands in for the browser a person opens it in, and
drives it through `@ayme-dev/inspector/testing`. `aymeMcp.spec.ts` starts
the command's `ayme mcp` as an Agent App does and talks to it through an MCP SDK
client over stdio; it shows the page `ayme_inspect` points to in the stand-in
Agent App, `agent-app.html` with `agentApp.ts`.

## Running

Run from this directory inside the repository's Devbox shell. `pnpm test:e2e`
tests the built packages, so build first; Turbo's `test:e2e` task does. The
fixture pages are served on a free port (`AYME_E2E_PORT_MCP` overrides it).
