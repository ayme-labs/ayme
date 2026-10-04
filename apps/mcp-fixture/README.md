# MCP fixture

The end-to-end tests of `@ayme-dev/mcp` and the fixture app they run against.
It is private and never published.

```
app/         the fixture page, its startup code and the Vite config
tests/       the shared fixtures (fixtures.ts) and one spec per concern
```

The page starts the Ayme runtime with `agentConnection: true` and a Custom Tool,
`read_text`. Its Show basket and Hide basket buttons register and unregister
the `Basket` Page Object, so a Page Object Tool comes and goes on demand.
WebMCP publication is off unless the URL has `?webmcp`, so the tests show the
Agent Connection works without it.

Each test starts the built `ayme mcp` command as a child process and talks to
it through an MCP SDK client over stdio, as a coding agent does. The `connect`
fixture calls `ayme_connect`, opens the link in the Playwright page and waits
until the page's tools are MCP tools. Assertions go through the MCP client, and
through the page only for what the page itself shows, such as its address bar.
Add a spec file for a new concern and reuse `fixtures.ts`.

## Running

Run from this directory inside the repository's Devbox shell. `pnpm test:e2e`
tests the built packages, so build first; Turbo's `test:e2e` task does. The
fixture page is served on a free port (`AYME_E2E_PORT_MCP` overrides it). Each
test's server takes the first free port from 9350 to 9365; the suite runs two
workers, so it needs at most two of them.
