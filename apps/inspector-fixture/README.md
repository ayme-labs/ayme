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
tests/            Playwright fixtures (fixtures.ts) and the specs
tests/e2e/        the e2e port's fixtures and Page Objects
tests/e2e/tools/  the Page Object study's third arm: its tool entry and its check
tests/goals/      the goal-driven twins of the *.e2e.ts tests
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
  open shadow root, the Agent Connection on, and the Inspector's own Page
  Object registered, so an agent drives the panel through Page Object Tools.
  The Structure lens's tree and the search results are kept out of the page
  state, since they render that state. `pnpm dev` serves it for a coding agent connected
  through `ayme mcp`.

## Two placements

The specs run as two Playwright projects. `inline` mounts the Inspector in the
fixture page. `external` runs the specs about what the Inspector shows and
does (the list is `externalSpecs` in `playwright.config.ts`) with the
`external` placement: each test starts an `ayme mcp` on a port of its own,
opens the fixture page with `?external` (its session has
`inspector: { placement: "external" }`) through the server's connect link,
and drives the Inspector in a second window, the one `ayme_inspect` names.
`page` is still the app's page there, so highlights and picking are checked
across the window boundary. The specs about the panel in the page (its
layout, host CSS, stacking, mounting, motion and dogfooding) run inline only.

## Running

Run from this directory inside the repository's Devbox shell. The tests run
the built packages, so build first; Turbo's tasks do. `pnpm test:e2e` runs
the Playwright suite on Chromium against the fixture pages, served on a free
port (`AYME_E2E_PORT_INSPECTOR` overrides it), and drives the panel through
the Inspector's page objects from `@ayme-dev/inspector/testing`. `pnpm e2e`
runs its port to [e2e](https://e2e.com), the `*.e2e.ts` files, which serve
the pages on a port e2e picks and drive the panel through the copies of
those page objects in `tests/e2e/pom/`. Turbo's `test:e2e` task runs both. A
test that calls Page Object Tools as a coding agent (`connected`) starts an
`ayme mcp` server and opens the page through its connect link. The Browser
Tools, which the server doesn't list, run on the page's own runtime, as the
app runs them. A fixture page that fails to start or a runtime that never
lists its tools fails before any test assertion, with its own message.
WebMCP is experimental, so only the test of the Connections popover's WebMCP
state installs a WebMCP driver, the recording one from
`@ayme-dev/webmcp/testing`.

`pnpm test:goals` runs the goal-driven tests (`tests/goals/**/*.goal.ts`,
with `e2e.goals.config.ts`), e2e's telemetry off. Each is the `*.e2e.ts` test
of the same name with every action on the panel written as an `agent.act`
goal, which Claude Code carries out on this machine's own login. CI has no
model, so `pnpm e2e` and Turbo's tasks leave them out. In the external
placement, switching to the Inspector's tab is part of the goal: the agent
does it as it sees fit. A first run records each goal into
`.e2e/goals-cache/`, and later runs replay it without the model, except for
a step that changes no control, such as dragging the panel's edge: e2e saves
nothing for it, so it calls the model on every run, and a warm run needs the
login too. The external placement's `ayme mcp` gets a port of this
checkout's own, which `AYME_E2E_MCP_PORT` overrides. `pnpm lint` also runs
the mirror check (alone: `pnpm check:goal-mirror`), which fails when a goal file drifts from its
`*.e2e.ts` twin; `scripts/check-goal-mirror.mjs` says what it compares.

The same goal files are the Page Object study's third arm, with the e2e
suite's Page Objects as tools: `pnpm test:goals:tools`, with its model-free
runs and what keeps the arms apart in
[`@ayme-dev/e2e-tools`](../../packages/e2e-tools/README.md).

Known costs of keeping the goal files line for line with their twins:

- A long test costs more in the agent arms: each tool's page (toolsLens)
  runs 24 goals in one agent session, and the header's menus and switches
  (inspector) 13.
- The Model lens hover goal runs inside its twin's `expect.poll`, so on a
  slow turn the poll's time limit can cut it off.
