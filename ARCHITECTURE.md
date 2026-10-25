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
  - Goal: try the Inspector and the page's tools on a hosted demo
  - Evidence: verified: [apps/example-vue/README.md](apps/example-vue/README.md), [apps/example-vue/src/App.vue](apps/example-vue/src/App.vue)

### External systems

- **Host application**
  - Provides: the page Ayme observes and acts on, the Page Object Models it compiles, the
    bundler that runs the build plugin, the backend that mounts the Decision Endpoint, and
    the Node processes that pair as App Processes
  - Evidence: verified: [docs/guide/reference/ayme.md](docs/guide/reference/ayme.md), [docs/guide/guides/server-rendering.md](docs/guide/guides/server-rendering.md)
- **Decision model provider**
  - Provides: Jev, the System One decision model the Goal Loop asks at each step, served by
    TypeSafe directly or through OpenRouter
  - Evidence: verified: [packages/ayme/src/goal-loop/infrastructure/decisionEndpointHandler.ts](packages/ayme/src/goal-loop/infrastructure/decisionEndpointHandler.ts)
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
- Evidence: verified: [packages/ayme/src/runtime/runtime.ts](packages/ayme/src/runtime/runtime.ts), [packages/ayme/src/runtime/webMcp.ts](packages/ayme/src/runtime/webMcp.ts),
  [packages/ayme/src/runtime/inspector.ts](packages/ayme/src/runtime/inspector.ts), [packages/ayme/src/runtime/agentConnection.ts](packages/ayme/src/runtime/agentConnection.ts),
  [packages/ayme/src/page-objects/infrastructure/browserPage.ts](packages/ayme/src/page-objects/infrastructure/browserPage.ts), [docs/adr/0021-pin-playwright-lite-to-immutable-fork-tags.md](docs/adr/0021-pin-playwright-lite-to-immutable-fork-tags.md)

### Build plugin

- Responsibility: compiles the marked Page Object Models and derives each action's input
  schema and each `Locator` member into POM metadata placed in the browser bundle; through
  its `include` option, off by default, also decides whether a build carries Ayme at all.
  Without it, the runtime's root and internal entries and the framework packages resolve
  to absent entries and each Page Object Model compiles to a stand-in. A build prints one
  line saying which it is, except a Next.js build that compiles no Page Object Model
- Technology: Unplugin package (`@ayme-dev/unplugin-ayme`) with Vite, Angular CLI and
  Turbopack entries, running the TypeScript compiler
- Evidence: verified: [packages/unplugin-ayme/src/unplugin.ts](packages/unplugin-ayme/src/unplugin.ts),
  [packages/unplugin-ayme/src/derivePomManifests.ts](packages/unplugin-ayme/src/derivePomManifests.ts),
  [packages/unplugin-ayme/src/transformPomModule.ts](packages/unplugin-ayme/src/transformPomModule.ts),
  [docs/adr/0040-a-build-includes-ayme-only-when-its-configuration-says-so.md](docs/adr/0040-a-build-includes-ayme-only-when-its-configuration-says-so.md)

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
- Evidence: verified: [packages/ayme/src/runtime/agentConnection.ts](packages/ayme/src/runtime/agentConnection.ts), [packages/mcp/src/process/](packages/mcp/src/process/),
  [packages/mcp/README.md](packages/mcp/README.md)

### Decision Endpoint

- Responsibility: the one route in the host app's backend that gates each Goal Loop decision
  request, adds the provider key and Jev model, forwards it to the provider and relays the
  answer; Ayme ships the handler, the app mounts and gates it
- Technology: Fetch-API request handler from `@ayme-dev/ayme/server`
- Evidence: verified: [packages/ayme/src/goal-loop/infrastructure/decisionEndpointHandler.ts](packages/ayme/src/goal-loop/infrastructure/decisionEndpointHandler.ts), [docs/guide/reference/decision-endpoint.md](docs/guide/reference/decision-endpoint.md),
  [docs/adr/0022-build-decision-requests-in-the-browser.md](docs/adr/0022-build-decision-requests-in-the-browser.md)

### Playground

- Responsibility: the hosted demo app with the Inspector in demo mode, plus the rendered
  documentation beside it. The "Try with your own coding agent" wizard and the Agent
  Connection are left out of the hosted builds
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
    - → Page Object registrations through the `pageObjects` setup option and
      `usePageObject`, `ayme.tools.list()` and `ayme.tools.run()` calls,
      Custom Tool and Peek registrations
    - ← tool definitions, results and Change Records
  - Evidence: verified: [docs/guide/guides/in-app-assistant.md](docs/guide/guides/in-app-assistant.md), [packages/ayme/src/runtime/runtime.ts](packages/ayme/src/runtime/runtime.ts)
- **Playground visitors → Playground**
  - Flows:
    - → list edits and Inspector runs
    - ← the demo page, its tools and their run results
  - Evidence: verified: [apps/example-vue/src/App.vue](apps/example-vue/src/App.vue), [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml)
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
  - Evidence: verified: [packages/ayme/src/goal-loop/infrastructure/decisionEndpoint.ts](packages/ayme/src/goal-loop/infrastructure/decisionEndpoint.ts), [packages/ayme/src/goal-loop/application/goalLoop.ts](packages/ayme/src/goal-loop/application/goalLoop.ts)
- **Browser runtime → WebMCP driver**
  - Flows:
    - → `registerTool` for each active tool, kept in step with the registry
  - Evidence: verified: [packages/webmcp/src/publication.ts](packages/webmcp/src/publication.ts), [packages/webmcp/src/synchronize.ts](packages/webmcp/src/synchronize.ts)
- **Browser runtime → Host application**
  - Flows:
    - → DOM reads, clicks, fills and key presses
    - ← the page structure captured into Structural Page State
  - Evidence: verified: [packages/ayme/src/page-objects/infrastructure/browserPage.ts](packages/ayme/src/page-objects/infrastructure/browserPage.ts), [packages/core/src/capture/](packages/core/src/capture/)
- **App Process runtime → Ayme MCP server**
  - Flows:
    - → pairing without a token, the process's Peek Tools and their changes, read results
    - ← Peek Tool calls, the server's token
  - Evidence: verified: [packages/mcp/src/process/](packages/mcp/src/process/), [packages/mcp/README.md](packages/mcp/README.md)
- **Decision Endpoint → Decision model provider**
  - Flows:
    - → the decision request with the bearer key and the pinned Jev model
    - ← the provider's status and body
  - Evidence: verified: [packages/ayme/src/goal-loop/infrastructure/decisionEndpointHandler.ts](packages/ayme/src/goal-loop/infrastructure/decisionEndpointHandler.ts)

## Environments

The host app environments are a developer using Ayme in their own app and that app
serving its users. The Ayme environments are Ayme's own: developing it, checking it and
hosting its playground.

### Host app

#### development

- Purpose: a developer's app running on their machine with a coding agent attached
- Evidence: verified: [docs/guide/guides/connect-an-agent.md](docs/guide/guides/connect-an-agent.md)
- Containers:
  - **Browser runtime**: the app's development build, with `inspector` and
    `agentConnection` on under the framework's development flag
    - Deployment node: the host app's page in the developer's browser
    - Evidence: verified: [docs/guide/guides/connect-an-agent.md](docs/guide/guides/connect-an-agent.md)
  - **Build plugin**: runs inside the dev server's bundler on every transform; the dev
    server needs `include: true` too, or the page gets a build without Ayme
    - Deployment node: the host app's dev server process
    - Evidence: verified: [packages/unplugin-ayme/src/vite.ts](packages/unplugin-ayme/src/vite.ts), [docs/guide/reference/build-plugin.md](docs/guide/reference/build-plugin.md)
  - **Ayme MCP server**: `npx -y @ayme-dev/mcp@<version> mcp`, one child process per agent
    - Deployment node: the coding agent's process on the developer's machine
    - Evidence: verified: [docs/guide/guides/connect-an-agent.md](docs/guide/guides/connect-an-agent.md), [packages/mcp/src/cli.ts](packages/mcp/src/cli.ts)
  - **App Process runtime**: `createAyme({ agentConnection })` started once in the dev
    server's or backend's entry point
    - Deployment node: the host app's dev server process
    - Evidence: verified: [docs/guide/guides/server-rendering.md](docs/guide/guides/server-rendering.md), [packages/mcp/README.md](packages/mcp/README.md)
  - **Decision Endpoint**: mounted in the dev server with the developer's own key, so the
    Goal Loop needs no backend while the app is developed
    - Deployment node: the host app's dev server process
    - Evidence: verified: [docs/guide/guides/goals-with-jev.md](docs/guide/guides/goals-with-jev.md)
  - **Playground**: does not run here; it is Ayme's own app
    - Evidence: verified: [apps/example-vue/README.md](apps/example-vue/README.md)
- External systems:
  - **Host application**: the developer's own app, served by its dev server
    - Evidence: verified: [docs/guide/start/install.md](docs/guide/start/install.md)
  - **Decision model provider**: the live TypeSafe or OpenRouter API, with the developer's key
    - Evidence: verified: [docs/guide/reference/decision-endpoint.md](docs/guide/reference/decision-endpoint.md)
  - **WebMCP driver**: Chrome's flag or a polyfill the app loads before its entry module
    - Evidence: verified: [docs/guide/guides/publish-tools.md](docs/guide/guides/publish-tools.md)

#### production

- Purpose: the host app serving its users, with Ayme's agent surface limited to what the
  app's setup publishes
- Evidence: verified: [docs/adr/0030-application-setup-owns-the-runtime-and-decides-publication.md](docs/adr/0030-application-setup-owns-the-runtime-and-decides-publication.md)
- Containers:
  - **Browser runtime**: the production bundle, only when it was built with
    `include: true`, otherwise it is a build without Ayme and none of it runs; WebMCP
    publication as the app's setup decides, the Inspector and Agent Connection off, Peeks
    inert
    - Deployment node: the host app's page in its users' browsers
    - Evidence: verified: [docs/adr/0034-peek-tools-reach-coding-agents-only-in-development.md](docs/adr/0034-peek-tools-reach-coding-agents-only-in-development.md),
      [docs/guide/guides/connect-an-agent.md](docs/guide/guides/connect-an-agent.md), [docs/guide/reference/build-plugin.md](docs/guide/reference/build-plugin.md)
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
    - Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml)
- External systems:
  - **Host application**: the app itself, in production
    - Evidence: verified: [docs/guide/guides/server-rendering.md](docs/guide/guides/server-rendering.md)
  - **Decision model provider**: the live API, reached only through the Decision Endpoint
    - Evidence: verified: [packages/ayme/src/goal-loop/infrastructure/decisionEndpointHandler.ts](packages/ayme/src/goal-loop/infrastructure/decisionEndpointHandler.ts)
  - **WebMCP driver**: whatever the user's browser or the app's polyfill supplies
    - Evidence: verified: [docs/guide/guides/publish-tools.md](docs/guide/guides/publish-tools.md)

### Ayme

#### development

- Purpose: a contributor's machine working in this monorepo: the playground and the framework
  examples run from the workspace packages, with a coding agent attached
- Evidence: verified: [apps/example-vue/README.md](apps/example-vue/README.md), [.agents/skills/inspector-dogfood/SKILL.md](.agents/skills/inspector-dogfood/SKILL.md)
- Containers:
  - **Browser runtime**: the playground's and the examples' development builds; the
    playground has WebMCP publication, the Inspector in demo mode and the Agent Connection
    on, and a `goal` only when its dev server has a model key
    - Deployment node: the example's page in the contributor's browser
    - Evidence: verified: [apps/example-vue/src/App.vue](apps/example-vue/src/App.vue), [apps/example-vue/vite.config.ts](apps/example-vue/vite.config.ts)
  - **Build plugin**: the workspace's `@ayme-dev/unplugin-ayme`, consumed from its built
    `dist`, inside each example's dev server
    - Deployment node: each example's dev server process
    - Evidence: verified: [packages/unplugin-ayme/package.json](packages/unplugin-ayme/package.json), [apps/example-vue/vite.config.ts](apps/example-vue/vite.config.ts)
  - **Ayme MCP server**: the workspace build, `node packages/mcp/dist/cli.mjs mcp`, registered
    with the contributor's coding agent
    - Deployment node: the coding agent's process on the contributor's machine
    - Evidence: verified: [.agents/skills/inspector-dogfood/SKILL.md](.agents/skills/inspector-dogfood/SKILL.md), [packages/mcp/src/cli.ts](packages/mcp/src/cli.ts)
  - **App Process runtime**: started by the Next.js example's `instrumentation.ts` and the
    Nuxt example's Nitro plugin
    - Deployment node: the Next.js or Nuxt example's dev server process
    - Evidence: verified: [apps/example-next/instrumentation.ts](apps/example-next/instrumentation.ts), [apps/example-nuxt/server/plugins/ayme.ts](apps/example-nuxt/server/plugins/ayme.ts)
  - **Decision Endpoint**: the playground's Vite plugin, mounted only when `.env.local` holds
    a TypeSafe or OpenRouter key
    - Deployment node: the playground's Vite dev server
    - Evidence: verified: [apps/example-vue/vite/decisionEndpoint.dev.ts](apps/example-vue/vite/decisionEndpoint.dev.ts), [apps/example-vue/scripts/appEnvironment.ts](apps/example-vue/scripts/appEnvironment.ts),
      [apps/example-vue/.env.example](apps/example-vue/.env.example)
  - **Playground**: a Vite dev server on port 4190, with the "Try with your own coding agent"
    wizard unless `VITE_AGENT_CONNECTION=false`
    - Deployment node: the playground's Vite dev server
    - Evidence: verified: [apps/example-vue/package.json](apps/example-vue/package.json), [apps/example-vue/src/App.vue](apps/example-vue/src/App.vue)
- External systems:
  - **Host application**: the playground's list app on 4190 and the React, Next.js, Nuxt,
    SvelteKit and Angular examples on 4191 to 4196
    - Evidence: verified: the `dev` scripts in [apps/example-vue/package.json](apps/example-vue/package.json), [apps/example-react/package.json](apps/example-react/package.json),
      [apps/example-next/package.json](apps/example-next/package.json), [apps/example-nuxt/package.json](apps/example-nuxt/package.json),
      [apps/example-sveltekit/package.json](apps/example-sveltekit/package.json), [apps/example-angular/package.json](apps/example-angular/package.json)
  - **Decision model provider**: the live TypeSafe or OpenRouter API, with the contributor's
    key; not reached without one
    - Evidence: verified: [apps/example-vue/scripts/appEnvironment.ts](apps/example-vue/scripts/appEnvironment.ts)
  - **WebMCP driver**: the `@mcp-b/webmcp-polyfill` the playground initializes before the
    Vue app
    - Evidence: verified: [apps/example-vue/src/main.ts](apps/example-vue/src/main.ts)

#### ci

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
  - **Playground**: built on pull requests that change it, not deployed; its build also
    builds it without Ayme and checks that output carries none of Ayme
    - Deployment node: a GitHub Actions runner
    - Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml), [apps/example-vue/package.json](apps/example-vue/package.json),
      [apps/example-vue/scripts/verify-browser-output.mjs](apps/example-vue/scripts/verify-browser-output.mjs)
- External systems:
  - **Host application**: the fixture and example apps in [apps/](apps/)
    - Evidence: verified: [docs/testing.md](docs/testing.md)
  - **Decision model provider**: the live API in the live goal lane, skipped without a key
    - Evidence: verified: [.github/workflows/ci.yml](.github/workflows/ci.yml)
  - **WebMCP driver**: a recording driver from `@ayme-dev/webmcp/testing`
    - Evidence: verified: [packages/webmcp/src/testing.ts](packages/webmcp/src/testing.ts)

#### playground

- Purpose: the public demo and docs at ayme-labs.github.io/ayme, and the same demo at
  ayme.dev/playground/
- Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml)
- Containers:
  - **Browser runtime**: the playground's production build with `webMCP` and `inspector`
    in demo mode, `agentConnection` off (`VITE_AGENT_CONNECTION=false`), and no `goal`
    since no Decision Endpoint exists
    - Deployment nodes: the ayme-labs.github.io/ayme GitHub Pages site, and its
      `/playground/` copy that ayme.dev/playground/ proxies to
    - Evidence: verified: [apps/example-vue/src/App.vue](apps/example-vue/src/App.vue), [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml)
  - **Build plugin**: ran in the Pages build; nothing of it runs on the site
    - Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml)
  - **Ayme MCP server**: does not run here; the hosted builds leave out the Agent
    Connection and the coding-agent wizard, and the workflow fails if the wizard is in the
    output
    - Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml), [apps/example-vue/src/App.vue](apps/example-vue/src/App.vue)
  - **App Process runtime**: does not run here; the site is static
    - Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml)
  - **Decision Endpoint**: does not run here; the deployed build publishes no `goal`
    - Evidence: verified: [apps/example-vue/README.md](apps/example-vue/README.md)
  - **Playground**: the static Vite build plus the Jekyll-rendered docs under `/docs`;
    the build is made twice, once for each base path, and only the `/playground/` copy
    loads the landing's Google Tag Manager container
    - Deployment nodes: the ayme-labs.github.io/ayme GitHub Pages site, and its
      `/playground/` copy that ayme.dev/playground/ proxies to
    - Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml), [docs/guide/_config.yml](docs/guide/_config.yml)
- External systems:
  - **Host application**: the playground's own list app
    - Evidence: verified: [apps/example-vue/README.md](apps/example-vue/README.md)
  - **Decision model provider**: not reached
    - Evidence: verified: [apps/example-vue/README.md](apps/example-vue/README.md)
  - **WebMCP driver**: the `@mcp-b/webmcp-polyfill` initialized before the Vue app
    - Evidence: verified: [apps/example-vue/src/main.ts](apps/example-vue/src/main.ts)
