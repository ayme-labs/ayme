# Architecture

The system's boundary, the actors and external systems around it, the containers inside
it, how they communicate, and how each environment realizes them. Ayme is a library
product: its runtime units run inside the host app's own page, bundler and Node processes,
and inside the coding agent's MCP client. The host app is therefore an external system, and
each Ayme container names the host process it runs in as its deployment node. Every claim
carries its evidence, the file it was verified from or the signal it was inferred from,
linked relative to the repository root.

## Context

Ayme turns the Page Object Models of an app's Playwright tests into tools that coding agents,
in-browser agents and the app's own code call on the running page.

### Actors

- **App developers**: the team integrating Ayme into their app
  - Goal: expose their Page Object Actions as tools, inspect what agents see, and read app
    state through Peeks while developing
  - Evidence: verified: [docs/guide/start/install.md](docs/guide/start/install.md), [packages/inspector/README.md](packages/inspector/README.md)
- **Coding agents**: Claude Code, Codex, Cursor or any MCP client the developer runs
  - Goal: drive and read the developer's running app through its Page Object, Browser,
    Custom, Peek and goal tools
  - Evidence: verified: [docs/guide/guides/connect-an-agent.md](docs/guide/guides/connect-an-agent.md), [packages/mcp/src/cli.ts](packages/mcp/src/cli.ts)
- **In-browser agents**: agents that read the page's `document.modelContext`, such as a
  browser-side assistant or Chrome's own agent
  - Goal: call the tools the page publishes through WebMCP
  - Evidence: verified: [packages/webmcp/src/driver.ts](packages/webmcp/src/driver.ts), [docs/guide/guides/publish-tools.md](docs/guide/guides/publish-tools.md)
- **Host app code**: the app's own features, such as an in-app assistant or a checklist's
  "Show me how" button
  - Goal: run Page Object Actions and read the page state from inside the app
  - Evidence: verified: [docs/guide/guides/in-app-assistant.md](docs/guide/guides/in-app-assistant.md)
- **Playground visitors**: developers evaluating Ayme before integrating it
  - Goal: try the Inspector and connect their own coding agent to a hosted demo
  - Evidence: verified: [apps/example-vue/README.md](apps/example-vue/README.md), [apps/example-vue/src/agentPrompts.ts](apps/example-vue/src/agentPrompts.ts)

### External systems

- **Host application**
  - Provides: the page Ayme observes and acts on, the Page Object Models it compiles, the
    bundler that runs the build plugin, the backend that mounts the Decision Endpoint, and
    the Node processes that pair as App Processes
  - Evidence: verified: [docs/guide/reference/ayme.md](docs/guide/reference/ayme.md), [docs/guide/guides/server-rendering.md](docs/guide/guides/server-rendering.md)
- **Decision model provider**
  - Provides: Jev, the System One decision model the Goal Loop asks at each step, served by
    TypeSafe directly or through OpenRouter
  - Evidence: verified: [packages/ayme/src/server.ts](packages/ayme/src/server.ts)
- **WebMCP driver**
  - Provides: `document.modelContext`, the page's tool registry for in-browser agents, from
    Chrome's WebMCP flag or a polyfill the app loads
  - Evidence: verified: [packages/webmcp/src/driver.ts](packages/webmcp/src/driver.ts), [docs/guide/guides/publish-tools.md](docs/guide/guides/publish-tools.md)

## Containers

### Browser runtime

- Responsibility: the Ayme session in the host app's page: the Page Object registry,
  Structural Page State and interaction history, the Browser, Custom, Page Object and Peek
  tools, the Goal Loop, and the optional modules it loads on demand: WebMCP publication,
  the Inspector panel and the page side of the Agent Connection
- Technology: TypeScript library (`@ayme-dev/ayme` with `@ayme-dev/webmcp`,
  `@ayme-dev/inspector` and `@ayme-dev/mcp/client`), started by a framework package
  (`@ayme-dev/vue`, `react`, `svelte`, `angular`) or `createAyme`; bundles Playwright
  Lite, the team's pinned fork of Playwright that runs Page Object Models against the
  live DOM
- Evidence: verified: [packages/ayme/src/runtime.ts](packages/ayme/src/runtime.ts), [packages/ayme/src/webMcp.ts](packages/ayme/src/webMcp.ts),
  [packages/ayme/src/inspector.ts](packages/ayme/src/inspector.ts), [packages/ayme/src/agentConnection.ts](packages/ayme/src/agentConnection.ts),
  [packages/ayme/src/browserPage.ts](packages/ayme/src/browserPage.ts), [docs/adr/0021-pin-playwright-lite-to-immutable-fork-tags.md](docs/adr/0021-pin-playwright-lite-to-immutable-fork-tags.md)

### Build plugin

- Responsibility: compiles the marked Page Object Models and derives each action's input
  schema and each `Locator` member into POM metadata placed in the browser bundle
- Technology: Unplugin package (`@ayme-dev/unplugin-ayme`) with Vite, Angular CLI and
  Turbopack entries, running the TypeScript compiler
- Evidence: verified: [packages/unplugin-ayme/src/unplugin.ts](packages/unplugin-ayme/src/unplugin.ts),
  [packages/unplugin-ayme/src/derivePomManifests.ts](packages/unplugin-ayme/src/derivePomManifests.ts)

### Ayme MCP server

- Responsibility: one server per coding agent: speaks MCP over stdio to the agent, pairs
  with one page and with the app's App Processes over a loopback WebSocket, and exposes
  their tools as MCP tools, with `ayme_connect`, `ayme_list_tools` and `ayme_call` as its
  own tools
- Technology: Node CLI (`ayme mcp` from `@ayme-dev/mcp`), MCP SDK over stdio, tRPC over
  WebSocket on `127.0.0.1`, ports 9350 to 9365
- Evidence: verified: [packages/mcp/src/server/index.ts](packages/mcp/src/server/index.ts),
  [packages/mcp/src/pairing/domain/pairing.ts](packages/mcp/src/pairing/domain/pairing.ts), [docs/adr/0033-the-agent-connection-pairs-one-page-and-the-apps-processes.md](docs/adr/0033-the-agent-connection-pairs-one-page-and-the-apps-processes.md)

### App Process runtime

- Responsibility: the Ayme session inside a Node process of the host app (its dev server or
  backend): pairs with the agent's MCP server beside the page and offers the process's
  Peek Tools, `peek.node.<name>`
- Technology: `createAyme` from `@ayme-dev/ayme` in Node, loading `@ayme-dev/mcp/process`
- Evidence: verified: [packages/ayme/src/agentConnection.ts](packages/ayme/src/agentConnection.ts), [packages/mcp/src/process/](packages/mcp/src/process/),
  [packages/mcp/README.md](packages/mcp/README.md)

### Decision Endpoint

- Responsibility: the one route in the host app's backend that gates each Goal Loop decision
  request, adds the provider key and Jev model, forwards it to the provider and relays the
  answer; Ayme ships the handler, the app mounts and gates it
- Technology: Fetch-API request handler from `@ayme-dev/ayme/server`
- Evidence: verified: [packages/ayme/src/server.ts](packages/ayme/src/server.ts), [docs/guide/reference/decision-endpoint.md](docs/guide/reference/decision-endpoint.md),
  [docs/adr/0022-build-decision-requests-in-the-browser.md](docs/adr/0022-build-decision-requests-in-the-browser.md)

### Playground

- Responsibility: the hosted demo app with the Inspector in demo mode and the "Try with your
  own coding agent" wizard, plus the rendered documentation beside it
- Technology: Vue single-page app built from [apps/example-vue](apps/example-vue), with the docs rendered by
  Jekyll from [docs/guide](docs/guide)
- Evidence: verified: [apps/example-vue/src/App.vue](apps/example-vue/src/App.vue), [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml)

## Communication

- **App developers → Browser runtime**
  - Flows:
    - → tool runs and lens navigation in the Inspector panel
    - ← Page Objects, Structural Page State, tools and run results
  - Evidence: verified: [packages/inspector/src/panel/](packages/inspector/src/panel/), [docs/guide/guides/inspector.md](docs/guide/guides/inspector.md)
- **Coding agents → Ayme MCP server**
  - Flows:
    - → `ayme_connect`, `ayme_list_tools`, `ayme_call` and the page's tools, over stdio
    - ← connect links, tool lists and `tools/list_changed` notifications, tool results and
      change notes
  - Evidence: verified: [packages/mcp/src/server/index.ts](packages/mcp/src/server/index.ts), [packages/mcp/src/server/serverTools.ts](packages/mcp/src/server/serverTools.ts)
- **In-browser agents → WebMCP driver**
  - Flows:
    - → calls to the published tools
    - ← tool results
  - Evidence: inferred: the driver is the browser's or a polyfill's; Ayme only registers
    tools with it ([packages/webmcp/src/publication.ts](packages/webmcp/src/publication.ts))
- **Host app code → Browser runtime**
  - Flows:
    - → `usePageObject` registrations, `ayme.tools.list()` and `ayme.tools.run()` calls,
      Custom Tool and Peek registrations
    - ← tool definitions, results and Change Records
  - Evidence: verified: [docs/guide/guides/in-app-assistant.md](docs/guide/guides/in-app-assistant.md), [packages/ayme/src/runtime.ts](packages/ayme/src/runtime.ts)
- **Playground visitors → Playground**
  - Flows:
    - → list edits, Inspector runs, the agent prompt copied from the wizard
    - ← the demo page, the prompt and the connect link flow
  - Evidence: verified: [apps/example-vue/src/App.vue](apps/example-vue/src/App.vue), [apps/example-vue/src/agentPrompts.ts](apps/example-vue/src/agentPrompts.ts)
- **Host application → Build plugin**
  - Flows:
    - → Page Object Model sources through the bundler's transform hooks
    - ← transformed modules carrying POM metadata
  - Evidence: verified: [packages/unplugin-ayme/src/unplugin.ts](packages/unplugin-ayme/src/unplugin.ts), [packages/unplugin-ayme/src/vite.ts](packages/unplugin-ayme/src/vite.ts)
- **WebMCP driver → Browser runtime**
  - Flows:
    - → `execute` of a published tool
    - ← the tool's result or error
  - Evidence: verified: [packages/webmcp/src/publication.ts](packages/webmcp/src/publication.ts)
- **Browser runtime → Ayme MCP server**
  - Flows:
    - → the tab's pairing (link token or loopback auto-pair), tool list and its changes,
      tool results, navigation and reload notices
    - ← tool calls from the agent, the server's token, the App Processes' tools for the
      Inspector
  - Evidence: verified: [packages/mcp/src/client/](packages/mcp/src/client/), [packages/mcp/src/connection/](packages/mcp/src/connection/),
    [packages/mcp/README.md](packages/mcp/README.md)
- **Browser runtime → Decision Endpoint**
  - Flows:
    - → `POST { state, questions }` per Goal Loop step
    - ← the provider's decision, or an `{ error }` body
  - Evidence: verified: [packages/ayme/src/decisionEndpoint.ts](packages/ayme/src/decisionEndpoint.ts), [packages/ayme/src/goalLoop.ts](packages/ayme/src/goalLoop.ts)
- **Browser runtime → WebMCP driver**
  - Flows:
    - → `registerTool` for each active tool, kept in step with the registry
  - Evidence: verified: [packages/webmcp/src/publication.ts](packages/webmcp/src/publication.ts), [packages/webmcp/src/synchronize.ts](packages/webmcp/src/synchronize.ts)
- **Browser runtime → Host application**
  - Flows:
    - → DOM reads, clicks, fills and key presses
    - ← the page structure captured into Structural Page State
  - Evidence: verified: [packages/ayme/src/browserPage.ts](packages/ayme/src/browserPage.ts), [packages/core/src/capture/](packages/core/src/capture/)
- **App Process runtime → Ayme MCP server**
  - Flows:
    - → pairing without a token, the process's Peek Tools and their changes, read results
    - ← Peek Tool calls, the server's token
  - Evidence: verified: [packages/mcp/src/process/](packages/mcp/src/process/), [packages/mcp/README.md](packages/mcp/README.md)
- **Decision Endpoint → Decision model provider**
  - Flows:
    - → the decision request with the bearer key and the pinned Jev model
    - ← the provider's status and body
  - Evidence: verified: [packages/ayme/src/server.ts](packages/ayme/src/server.ts)

## Environments

### local development

- Purpose: a developer's app running on their machine with a coding agent attached
- Evidence: verified: [docs/guide/guides/connect-an-agent.md](docs/guide/guides/connect-an-agent.md)
- Containers:
  - **Browser runtime**: the app's development build, with `inspector` and
    `agentConnection` on under the framework's development flag
    - Deployment node: the host app's page in the developer's browser
    - Evidence: verified: [docs/guide/guides/connect-an-agent.md](docs/guide/guides/connect-an-agent.md)
  - **Build plugin**: runs inside the dev server's bundler on every transform
    - Deployment node: the host app's dev server process
    - Evidence: verified: [packages/unplugin-ayme/src/vite.ts](packages/unplugin-ayme/src/vite.ts)
  - **Ayme MCP server**: `npx -y @ayme-dev/mcp@<version> mcp`, one child process per agent
    - Deployment node: the coding agent's process on the developer's machine
    - Evidence: verified: [docs/guide/guides/connect-an-agent.md](docs/guide/guides/connect-an-agent.md), [packages/mcp/src/cli.ts](packages/mcp/src/cli.ts)
  - **App Process runtime**: `createAyme({ agentConnection })` started once in the dev
    server's or backend's entry point
    - Deployment node: the host app's dev server process
    - Evidence: verified: [docs/guide/guides/server-rendering.md](docs/guide/guides/server-rendering.md), [packages/mcp/README.md](packages/mcp/README.md)
  - **Decision Endpoint**: mounted in the dev server with the developer's own key; the
    playground's Vite plugin is the reference setup
    - Deployment node: the host app's dev server process
    - Evidence: verified for the playground: [apps/example-vue/vite/decisionEndpoint.dev.ts](apps/example-vue/vite/decisionEndpoint.dev.ts);
      inferred for other apps: the docs show the handler, not a dev-server mount
  - **Playground**: the same app as the hosted site, run as a local Vite dev server on
    port 4190
    - Deployment node: a local Vite process
    - Evidence: verified: [apps/example-vue/package.json](apps/example-vue/package.json)
- External systems:
  - **Host application**: the developer's own app, served by its dev server
    - Evidence: verified: [docs/guide/start/install.md](docs/guide/start/install.md)
  - **Decision model provider**: the live TypeSafe or OpenRouter API, with the developer's key
    - Evidence: verified: [apps/example-vue/README.md](apps/example-vue/README.md)
  - **WebMCP driver**: Chrome's flag or a polyfill the app loads before its entry module
    - Evidence: verified: [docs/guide/guides/publish-tools.md](docs/guide/guides/publish-tools.md), [apps/example-vue/src/main.ts](apps/example-vue/src/main.ts)

### host app production

- Purpose: the host app serving its users, with Ayme's agent surface limited to what the
  app's setup publishes
- Evidence: verified: [docs/adr/0030-application-setup-owns-the-runtime-and-decides-publication.md](docs/adr/0030-application-setup-owns-the-runtime-and-decides-publication.md)
- Containers:
  - **Browser runtime**: the production bundle; WebMCP publication as the app's setup
    decides, the Inspector and Agent Connection off, Peeks inert
    - Deployment node: the host app's page in its users' browsers
    - Evidence: verified: [docs/adr/0034-peek-tools-reach-coding-agents-only-in-development.md](docs/adr/0034-peek-tools-reach-coding-agents-only-in-development.md),
      [docs/guide/guides/connect-an-agent.md](docs/guide/guides/connect-an-agent.md)
  - **Build plugin**: ran once at build time; nothing of it runs in production
    - Evidence: verified: [docs/guide/guides/server-rendering.md](docs/guide/guides/server-rendering.md)
  - **Ayme MCP server**: does not run here; coding agents are a development tool
    - Evidence: verified: [docs/guide/guides/connect-an-agent.md](docs/guide/guides/connect-an-agent.md)
  - **App Process runtime**: does not pair here; the docs gate `agentConnection` behind the
    development flag
    - Evidence: inferred: nothing prevents it, the docs only advise the gate
  - **Decision Endpoint**: the handler mounted on a route of the app's backend, gated by the
    app's `authorize`
    - Deployment node: the host app's backend
    - Evidence: verified: [docs/guide/reference/decision-endpoint.md](docs/guide/reference/decision-endpoint.md)
  - **Playground**: does not run here
- External systems:
  - **Host application**: the app itself, in production
    - Evidence: verified: [docs/guide/guides/server-rendering.md](docs/guide/guides/server-rendering.md)
  - **Decision model provider**: the live API, reached only through the Decision Endpoint
    - Evidence: verified: [packages/ayme/src/server.ts](packages/ayme/src/server.ts)
  - **WebMCP driver**: whatever the user's browser or the app's polyfill supplies
    - Evidence: verified: [docs/guide/guides/publish-tools.md](docs/guide/guides/publish-tools.md)

### playground

- Purpose: the public demo and docs at ayme-labs.github.io/ayme
- Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml)
- Containers:
  - **Browser runtime**: the playground's production build with `webMCP`, `inspector`
    in demo mode and `agentConnection` on, and no `goal` since no Decision Endpoint exists
    - Deployment node: the ayme-labs.github.io/ayme GitHub Pages site
    - Evidence: verified: [apps/example-vue/src/App.vue](apps/example-vue/src/App.vue)
  - **Build plugin**: ran in the Pages build; nothing of it runs on the site
    - Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml)
  - **Ayme MCP server**: the visitor's own, started by their coding agent from the wizard's
    prompt and paired through a connect link
    - Deployment node: the visitor's machine
    - Evidence: verified: [apps/example-vue/src/agentPrompts.ts](apps/example-vue/src/agentPrompts.ts)
  - **App Process runtime**: does not run here; the site is static
    - Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml)
  - **Decision Endpoint**: does not run here; the deployed build publishes no `goal`
    - Evidence: verified: [apps/example-vue/README.md](apps/example-vue/README.md)
  - **Playground**: the static Vite build plus the Jekyll-rendered docs under `/docs`
    - Deployment node: the ayme-labs.github.io/ayme GitHub Pages site
    - Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml), [docs/guide/_config.yml](docs/guide/_config.yml)
- External systems:
  - **Host application**: the playground's own list app
    - Evidence: verified: [apps/example-vue/README.md](apps/example-vue/README.md)
  - **Decision model provider**: not reached
    - Evidence: verified: [apps/example-vue/README.md](apps/example-vue/README.md)
  - **WebMCP driver**: the `@mcp-b/webmcp-polyfill` initialized before the Vue app
    - Evidence: verified: [apps/example-vue/src/main.ts](apps/example-vue/src/main.ts)

### ci

- Purpose: the checks on every pull request and on `main`, including the live goal lane
- Evidence: verified: [.github/workflows/ci.yml](.github/workflows/ci.yml)
- Containers:
  - **Browser runtime**: the fixtures and example apps under test in Chromium
    - Deployment node: a Playwright container on a GitHub Actions runner
    - Evidence: verified: [.github/workflows/ci.yml](.github/workflows/ci.yml), [docs/testing.md](docs/testing.md)
  - **Build plugin**: runs in each example's build and dev server under test
    - Deployment node: a Playwright container on a GitHub Actions runner
    - Evidence: verified: [.github/workflows/ci.yml](.github/workflows/ci.yml)
  - **Ayme MCP server**: started over stdio by the test's MCP client
    - Deployment node: a Playwright container on a GitHub Actions runner
    - Evidence: verified: [packages/mcp/src/testing/](packages/mcp/src/testing/), [apps/mcp-fixture/](apps/mcp-fixture/)
  - **App Process runtime**: the example dev servers paired in the certification tests
    - Deployment node: a Playwright container on a GitHub Actions runner
    - Evidence: verified: [apps/example-vue/README.md](apps/example-vue/README.md)
  - **Decision Endpoint**: the playground's dev-server mount, only in the live goal lane
    with a repository secret
    - Deployment node: a Playwright container on a GitHub Actions runner
    - Evidence: verified: [.github/workflows/ci.yml](.github/workflows/ci.yml)
  - **Playground**: built on pull requests that change it, not deployed
    - Deployment node: a GitHub Actions runner
    - Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml)
- External systems:
  - **Host application**: the fixture and example apps in [apps/](apps/)
    - Evidence: verified: [docs/testing.md](docs/testing.md)
  - **Decision model provider**: the live API in the live goal lane, skipped without a key
    - Evidence: verified: [.github/workflows/ci.yml](.github/workflows/ci.yml)
  - **WebMCP driver**: a recording driver from `@ayme-dev/webmcp/testing`
    - Evidence: verified: [packages/webmcp/src/testing.ts](packages/webmcp/src/testing.ts)
