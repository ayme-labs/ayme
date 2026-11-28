# Inspector fixture

The Inspector's end-to-end tests and the fixture app they run against. It is
private and never published.

The app is a set of plain pages that start the ayme runtime with a real Page
Object and mount the built Inspector. Its Page Objects are compiled by the ayme
Vite plugin, the way an app's are. The tests live here rather than in
`packages/inspector` because the plugin depends on the Inspector.

```
app/         the fixture pages, their startup code and the Vite config
ayme/pom/    the fixture app's Page Objects
tests/       Playwright fixtures (fixtures.ts) and the specs
```

The pages:

- `/`: a list app with its Page Object, and no host styles, so the browser's
  defaults show whether the Inspector's CSS leaks out of its shadow root.
- `/react.html`: the same list app in the host's own React under StrictMode,
  with aggressive global CSS that must not reach the Inspector.
- `/models.html`: a to-do list whose items are child Page Objects.
- `/unpublished.html`: the list app with WebMCP publication off.
- `/late.html`: the list app with the Inspector mounted in demo mode after the
  runtime started with its Page Object.
- `/session.html`: the list app whose runtime session mounts the Inspector
  through its `inspector` option; the tests stop and restart it. With `?demo`,
  the option turns demo mode on.
- `/dogfood.html`: the list app with the Inspector mounted for dogfooding: an
  open shadow root and the Inspector's own Page Object registered, so an agent
  drives the panel through Page Object Tools over WebMCP. The Structure lens's
  tree and the search results are kept out of the page state, since they
  render that state. `pnpm dev` serves it.

## Running

Run from this directory inside the repository's Devbox shell. `pnpm test:e2e`
tests the built packages, so build first; Turbo's `test:e2e` task does. It runs
Playwright on Chromium against the fixture pages, served on a free port
(`AYME_E2E_PORT_INSPECTOR` overrides it). A test that calls Page Object Tools
as an agent (`connected`) installs the recording WebMCP driver from
`@ayme-dev/webmcp/testing` before the page loads and calls the tools the page
publishes, as an agent in the browser does. The Browser Tools run on the
page's own runtime, as the app runs them. The tests drive the panel
through the Inspector's page objects from `@ayme-dev/inspector/testing`. A
fixture page that fails to start or a runtime that never lists its tools fails
before any test assertion, with its own message. Only the tests that call tools
as an agent, and the test of the Connections popover's WebMCP state, install
that driver.
