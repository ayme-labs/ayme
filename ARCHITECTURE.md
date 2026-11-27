# Architecture

The system's boundary, the actors and external systems around it, the containers inside
it, how they communicate, and how each environment realizes them. ayme is a library
product: its runtime units run inside the host app's own page, bundler and Node processes,
and inside the coding agent's MCP client. The host app is therefore an external system, and
each ayme container names the host process it runs in as its deployment node. Every claim
carries its evidence, the file it was verified from or the signal it was inferred from,
linked relative to the repository root.

[ARCHITECTURE.html](ARCHITECTURE.html) draws this file as an interactive diagram, published
at https://claude.ai/artifact/5YFUfE3seAb7iu2ffbZMMG. Its data block mirrors this file, so
change both in the same pull request. After the pull request merges, republish the page from
`main` to that link, so the published diagram shows what `main` holds.

## Context

ayme turns the Page Object Models of an app's Playwright tests into tools that coding agents,
in-browser agents and the app's own code call on the running page.

### Actors

- **App developers**: the team integrating ayme into their app
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
- **Playground visitors**: developers evaluating ayme before integrating it
  - Goal: try the Inspector and the page's tools on a hosted demo
  - Evidence: verified: [apps/example-vue/README.md](apps/example-vue/README.md), [apps/example-vue/src/App.vue](apps/example-vue/src/App.vue)

### External systems

- **Host application**
  - Provides: the page ayme observes and acts on, the Page Object Models it compiles, the
    bundler that runs the build plugin, the backend that mounts the Decision Endpoint,
    the Node processes that pair as App Processes, the Playwright installation the
    Recorder loads, and the project folder a recording is saved in
  - Evidence: verified: [docs/guide/reference/ayme.md](docs/guide/reference/ayme.md), [docs/guide/guides/server-rendering.md](docs/guide/guides/server-rendering.md),
    [packages/browser/src/projectPlaywright.ts](packages/browser/src/projectPlaywright.ts)
- **Decision model provider**
  - Provides: Jev, the System One decision model the Goal Loop asks at each step, served by
    TypeSafe directly or through OpenRouter
  - Evidence: verified: [packages/ayme/src/goal-loop/infrastructure/decisionEndpointHandler.ts](packages/ayme/src/goal-loop/infrastructure/decisionEndpointHandler.ts)
- **WebMCP driver**
  - Provides: `document.modelContext`, the page's tool registry for in-browser agents, from
    Chrome's WebMCP flag or a polyfill the app loads
  - Evidence: verified: [packages/webmcp/src/driver.ts](packages/webmcp/src/driver.ts), [docs/guide/guides/publish-tools.md](docs/guide/guides/publish-tools.md)
- **Browser automation**
  - Provides: the tool that drives the browser, such as Playwright MCP, Playwright CLI or
    a Playwright script. It loads the init script `ayme mcp` writes into every page it
    opens
  - Evidence: verified: [packages/mcp/src/served-page-objects/domain/servedPageObjects.ts](packages/mcp/src/served-page-objects/domain/servedPageObjects.ts),
    [apps/mcp-fixture/tests/servedPageObjects.spec.ts](apps/mcp-fixture/tests/servedPageObjects.spec.ts)

## Containers

### Browser runtime

- Responsibility: the ayme session in the host app's page: the Page Object registry,
  Structural Page State and interaction history, the Browser, Custom, Page Object and Peek
  tools, the Goal Loop, and the optional modules it loads on demand: WebMCP publication,
  the Inspector panel and the page side of the Agent Connection. It captures the page and
  runs its actions through the document's In-page Module, which it installs unless another
  host already has
- Technology: TypeScript library (`@ayme-dev/ayme` with `@ayme-dev/webmcp`,
  `@ayme-dev/inspector` and `@ayme-dev/mcp/client`), started by a framework package
  (`@ayme-dev/vue`, `react`, `svelte`, `angular`), by `createAyme` or, with served Page
  Objects, by the init script; bundles Playwright Lite, the team's pinned fork of
  Playwright that runs Page Object Models against the live DOM
- Evidence: verified: [packages/ayme/src/runtime/runtime.ts](packages/ayme/src/runtime/runtime.ts), [packages/ayme/src/runtime/webMcp.ts](packages/ayme/src/runtime/webMcp.ts),
  [packages/ayme/src/runtime/inspector.ts](packages/ayme/src/runtime/inspector.ts), [packages/ayme/src/runtime/agentConnection.ts](packages/ayme/src/runtime/agentConnection.ts),
  [packages/ayme/src/page-objects/infrastructure/browserPage.ts](packages/ayme/src/page-objects/infrastructure/browserPage.ts), [packages/ayme/src/page-state/infrastructure/browserInPage.ts](packages/ayme/src/page-state/infrastructure/browserInPage.ts),
  [packages/ayme/src/in-page/](packages/ayme/src/in-page/), [packages/mcp/src/served-page-objects/domain/servedPageObjects.ts](packages/mcp/src/served-page-objects/domain/servedPageObjects.ts),
  [docs/adr/0021-pin-playwright-lite-to-immutable-fork-tags.md](docs/adr/0021-pin-playwright-lite-to-immutable-fork-tags.md)

### Build plugin

- Responsibility: compiles the marked Page Object Models and derives each action's input
  schema and each `Locator` member into POM metadata placed in the browser bundle; through
  its `include` option, off by default, also decides whether a build carries ayme at all
- Technology: Unplugin package (`@ayme-dev/unplugin-ayme`) with Vite, Angular CLI and
  Turbopack entries, over the Page Object compiler in `@ayme-dev/ayme`'s Node-only
  `compiler` entry
- Evidence: verified: [packages/unplugin-ayme/src/unplugin.ts](packages/unplugin-ayme/src/unplugin.ts),
  [packages/ayme/src/compiler/pomCompiler.ts](packages/ayme/src/compiler/pomCompiler.ts),
  [packages/ayme/src/compiler/derivePomManifests.ts](packages/ayme/src/compiler/derivePomManifests.ts),
  [docs/adr/0040-a-build-includes-ayme-only-when-its-configuration-says-so.md](docs/adr/0040-a-build-includes-ayme-only-when-its-configuration-says-so.md)

### ayme MCP server

- Responsibility: one server per coding agent: speaks MCP over stdio to the agent, pairs
  with one page and with the app's App Processes over a loopback WebSocket, and exposes
  their tools as MCP tools beside its own. It serves the external Inspector, to a browser
  window and, as an MCP App, to an Agent App that shows it in its chat, and relays
  between its windows and the paired page. Experimentally, when the project has a Page
  Objects entry, it also builds and serves that entry with the project's runtime, and
  writes the init script the browser automation loads. The init script starts no runtime
  on a page whose app has already started ayme. Known gap: an app that starts ayme late
  still gets a second runtime
  ([issue #1238](https://github.com/ayme-labs/ayme/issues/1238))
- Technology: Node CLI (`ayme mcp` from `@ayme-dev/mcp`), MCP SDK over stdio with the
  MCP Apps extension (`@modelcontextprotocol/ext-apps`), tRPC over WebSocket on
  `127.0.0.1`, ports 9350 to 9365; esbuild and `@ayme-dev/ayme/compiler` for served Page
  Objects
- Evidence: verified: [packages/mcp/src/server/index.ts](packages/mcp/src/server/index.ts),
  [packages/mcp/src/pairing/domain/pairing.ts](packages/mcp/src/pairing/domain/pairing.ts), [packages/mcp/src/inspector/application/inspectorRelay.ts](packages/mcp/src/inspector/application/inspectorRelay.ts),
  [packages/mcp/src/inspector/infrastructure/externalInspectorServer.ts](packages/mcp/src/inspector/infrastructure/externalInspectorServer.ts), [docs/adr/0066-each-coding-agents-ayme-mcp-server-pairs-with-one-page-and-the-apps-processes-and-its-fallback-tools-reach-every-tool-it-lists.md](docs/adr/0066-each-coding-agents-ayme-mcp-server-pairs-with-one-page-and-the-apps-processes-and-its-fallback-tools-reach-every-tool-it-lists.md),
  [packages/mcp/src/served-page-objects/infrastructure/pageObjectsBuild.ts](packages/mcp/src/served-page-objects/infrastructure/pageObjectsBuild.ts), [packages/mcp/src/served-page-objects/infrastructure/servedPageObjectsServer.ts](packages/mcp/src/served-page-objects/infrastructure/servedPageObjectsServer.ts),
  [packages/mcp/src/served-page-objects/domain/servedPageObjects.ts](packages/mcp/src/served-page-objects/domain/servedPageObjects.ts), [packages/mcp/src/served-page-objects/infrastructure/initScriptFiles.ts](packages/mcp/src/served-page-objects/infrastructure/initScriptFiles.ts),
  [docs/adr/0051-ayme-mcp-builds-and-serves-page-objects-kept-outside-the-app.md](docs/adr/0051-ayme-mcp-builds-and-serves-page-objects-kept-outside-the-app.md)

### App Process runtime

- Responsibility: the ayme session inside a Node process of the host app (its dev server or
  backend): pairs with the agent's MCP server beside the page and offers the process's
  Peek Tools, `peek.node.<name>`
- Technology: `createAyme` from `@ayme-dev/ayme` in Node, loading `@ayme-dev/mcp/process`
- Evidence: verified: [packages/ayme/src/runtime/agentConnection.ts](packages/ayme/src/runtime/agentConnection.ts), [packages/mcp/src/process/](packages/mcp/src/process/),
  [packages/mcp/README.md](packages/mcp/README.md)

### Node host runtime

- Responsibility: the ayme session in a Node process that drives a browser `Page` it is
  handed, such as a Playwright script or test: it runs the session code the browser runtime
  shares over that Page, through the In-page Module installed in the document, and carries
  no browser runtime of its own
- Technology: `createAyme({ page })` from `@ayme-dev/ayme/playwright`, over a real
  Playwright `Page` (`@playwright/test`)
- Evidence: verified: [packages/ayme/src/playwright.ts](packages/ayme/src/playwright.ts), [packages/ayme/src/runtime/playwrightRuntime.ts](packages/ayme/src/runtime/playwrightRuntime.ts),
  [docs/adr/0049-one-in-page-module-per-document.md](docs/adr/0049-one-in-page-module-per-document.md)

### Decision Endpoint

- Responsibility: the one route in the host app's backend that gates each Goal Loop decision
  request, adds the provider key and Jev model, forwards it to the provider and relays the
  answer; ayme ships the handler, the app mounts and gates it
- Technology: Fetch-API request handler from `@ayme-dev/ayme/server`
- Evidence: verified: [packages/ayme/src/goal-loop/infrastructure/decisionEndpointHandler.ts](packages/ayme/src/goal-loop/infrastructure/decisionEndpointHandler.ts), [docs/guide/reference/decision-endpoint.md](docs/guide/reference/decision-endpoint.md),
  [docs/adr/0022-build-decision-requests-in-the-browser.md](docs/adr/0022-build-decision-requests-in-the-browser.md)

### Playground

- Responsibility: the hosted demo app with the Inspector in demo mode, plus the rendered
  documentation beside it. An agent reaches it through WebMCP publication only
- Technology: Vue single-page app built from [apps/example-vue](apps/example-vue), with the docs rendered by
  Jekyll from [docs/guide](docs/guide)
- Evidence: verified: [apps/example-vue/src/App.vue](apps/example-vue/src/App.vue), [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml)

### Recorder

- Responsibility: one process per recording: opens a URL in a Chromium it launches with
  the Playwright the developer's project has installed, or attaches to a running Chromium,
  and records the input given on the page as Interactions with what each changed. It
  serves the recorder window at a local address it prints, which shows the recording live
  and holds Record, Stop, Continue, Assert visibility, Clear and Finish, discard and
  restore of an entry while it records or is paused, and a highlight on the page of an entry's element
  while its target is hovered, or of a change row's element while the row's element is
  hovered; when it launched the browser, it opens the window there as a second window,
  apart from what it records. Every recorded page also gets an in-page toolbar with
  Record, Stop and Continue in one control, and Assert visibility, kept out of the page's
  structure. It ends when Finish is
  pressed, the last page is closed or it is stopped from the terminal. A recording that
  was started ends by writing a Recording Package, with its trace beside it, into the
  project's `ayme/recordings`; without one it ends with "empty"
- Technology: Node CLI (`ayme capture <url>` and `ayme capture --cdp=<url>`, of the `ayme`
  command from `@ayme-dev/cli`), over the engine `@ayme-dev/recorder`, whose
  flows are written with Effect; `@ayme-dev/cli` is published and bundles the engine and
  `@ayme-dev/recorder-window`, which stay private. The engine gets its browser through the private
  `@ayme-dev/browser`, bundled into it, which loads Playwright from the project's folder and bundles
  none, and runs the project's own `playwright trace` as a separate process. It keeps
  Visits and element identity and compares page structures with `@ayme-dev/core`, which
  also runs its wait for a Settled Page. `@ayme-dev/recorder-window` is the window, React
  with the design system, built to one page and one script that the engine serves on plain
  Node `http` and `ws`; the window talks to the engine over tRPC on a WebSocket, and knows
  it only through the engine's plain-data contract. The same package builds the toolbar,
  one script with React and the design system in a closed shadow root, which the engine
  runs in every recorded document; the toolbar sends commands and pulls the state through
  one page function the engine exposes in the page
- Evidence: verified: [packages/cli/src/cli.ts](packages/cli/src/cli.ts), [packages/cli/src/capture.ts](packages/cli/src/capture.ts), [packages/recorder/src/engine/startRecorder.ts](packages/recorder/src/engine/startRecorder.ts), [packages/recorder/src/session/application/recorderSession.ts](packages/recorder/src/session/application/recorderSession.ts), [packages/recorder/src/playwright/infrastructure/live/stockBrowser.ts](packages/recorder/src/playwright/infrastructure/live/stockBrowser.ts), [packages/recorder/src/playwright/infrastructure/traceTool.ts](packages/recorder/src/playwright/infrastructure/traceTool.ts), [packages/recorder/src/timeline/domain/timeline.ts](packages/recorder/src/timeline/domain/timeline.ts), [packages/recorder/src/timeline/infrastructure/recordingStore.ts](packages/recorder/src/timeline/infrastructure/recordingStore.ts), [packages/recorder/src/server/infrastructure/windowServer.ts](packages/recorder/src/server/infrastructure/windowServer.ts), [packages/recorder-window/src/app/main.tsx](packages/recorder-window/src/app/main.tsx), [packages/recorder/src/server/infrastructure/toolbarBridge.ts](packages/recorder/src/server/infrastructure/toolbarBridge.ts), [packages/recorder-window/src/app/toolbar.tsx](packages/recorder-window/src/app/toolbar.tsx), [docs/adr/0052-the-recorder-runs-on-stock-playwright-and-uses-its-private-parts-only-under-test.md](docs/adr/0052-the-recorder-runs-on-stock-playwright-and-uses-its-private-parts-only-under-test.md)

### Session

- Responsibility: one running ayme connected to one browser; a project folder can have
  several, each with a name, chosen with `-s=<name>` or `AYME_SESSION`, and `default`
  without either. It starts with `ayme open`, which opens Chromium with the Playwright the
  developer's project has installed and prints the address the developer's browser
  automation connects to, or with `ayme attach --cdp=<url>`, which joins a Chromium the
  browser automation already started, without Playwright's defaults. A name already in use
  is refused, also when two starts arrive at once, and `ayme list` shows the folder's
  Sessions, a start still under way as starting. It lives in a background process that the
  `ayme` commands reach, and ends with `ayme close`, which closes the browser only when ayme
  opened it, with `ayme detach`, which leaves a joined browser running and is refused on one
  ayme opened, or when the browser goes away. A command sent while it starts waits for the
  start, every command gets an answer, and a command still waiting when the Session ends is
  told how it ended. It keeps a dialog listener that does nothing, so every dialog stays open
  for the browser automation to answer, except one that opens while a join is still under
  way, which Playwright dismisses. At its start it builds the Page Objects of the project's
  ayme folder for Node while it gets the browser; when that build fails, no Session starts
  and a browser ayme opened closes. It runs them as the Host of each Tab it works on, through
  the Node host runtime of the project's own `@ayme-dev/ayme`, and turns focus emulation on
  for that Tab, the one setting it changes in a browser it joined. It works on the most
  recently active Tab, in the order of the browser's own tab list, unless `--tab` names
  another by its URL or, for a tool of a class with a Page Object Root, the Page Object Id
  chooses the Tab whose Host gave it; it lists that Tab's Page Object Tree and Page Object
  Tools, and runs a Page Object Tool on it as a Run, one Run per Tab at a time and with no
  time limit of its own. A Tab is gone only when Playwright says its page closed; its Host
  stops then, and a command still waiting on it is told so.
  An error Page Object code throws, or leaves for nobody to catch, ends only its Run. `ayme inspect` opens the Session's Inspector window in the developer's default browser, outside the Session's browser: the background process serves it, and it shows the Tab the Session works on, follows it to another Tab, runs a Page Object Tool there as a Run of the Inspector in that Tab's turn, and says so when the Session ends. A Tab that shows the window is never one the Session works on
- Technology: the `ayme` command from `@ayme-dev/cli` (`ayme open [url]`,
  `ayme attach --cdp=<url>`, `ayme call`, `ayme inspect`, `ayme mcp`, `ayme detach`, `ayme close` and
  `ayme list`), over
  the private `@ayme-dev/session`, bundled into it, whose flows are written with Effect. A
  command finds the background process of its folder's Session of its name through that
  name's claim in the user's cache folder and sends it one JSON line over a local socket;
  the background process is the same command, started detached. The Session gets its
  browser through `@ayme-dev/browser`: one it opens on a profile of its own so that every
  Tab is in one context and one window, with the DevTools protocol on a port Chromium
  picks, or one it joins at the DevTools protocol address it is given. It reads the
  browser's tab list over HTTP, at `json/list` under the path of that address, follows no
  redirect, and gives up on a read after a deadline of its own. It builds the Page
  Objects with esbuild and the project's own Page Object compiler,
  `@ayme-dev/ayme/compiler`, and leaves every package they import to the project's install,
  so the compiled classes and the Node host runtime share the project's one copy of
  `@ayme-dev/ayme`. The background process also serves the Inspector window on a port of the loopback address: its page, the Inspector's external build, which the command ships beside itself, and a WebSocket per window, which admits only a client that brings the Session's token. `ayme mcp` is an MCP server over stdio that an Agent App starts: its one tool, `ayme_inspect`, points the Agent App to a page that holds the Inspector's external build and that WebSocket's address with the token
- Evidence: verified: [packages/cli/src/session.ts](packages/cli/src/session.ts), [packages/session/src/session/application/session.ts](packages/session/src/session/application/session.ts), [packages/session/src/process/infrastructure/background.ts](packages/session/src/process/infrastructure/background.ts), [packages/session/src/process/infrastructure/commands.ts](packages/session/src/process/infrastructure/commands.ts), [packages/session/src/process/infrastructure/record.ts](packages/session/src/process/infrastructure/record.ts), [packages/session/src/playwright/infrastructure/live/stockBrowser.ts](packages/session/src/playwright/infrastructure/live/stockBrowser.ts), [packages/session/src/page-objects/infrastructure/nodeBuild.ts](packages/session/src/page-objects/infrastructure/nodeBuild.ts), [packages/session/src/playwright/infrastructure/live/tabHost.ts](packages/session/src/playwright/infrastructure/live/tabHost.ts), [packages/session/src/process/infrastructure/inspectorWindow.ts](packages/session/src/process/infrastructure/inspectorWindow.ts), [docs/adr/0069-a-projects-page-objects-run-in-node-in-a-session-beside-the-developers-browser-automation.md](docs/adr/0069-a-projects-page-objects-run-in-node-in-a-session-beside-the-developers-browser-automation.md)

## Communication

- **App developers → Browser runtime**
  - Flows:
    - → tool runs and lens navigation in the Inspector panel
    - ← Page Objects, Structural Page State, tools and run results
  - Evidence: verified: [packages/inspector/src/panel/](packages/inspector/src/panel/), [docs/guide/guides/inspector.md](docs/guide/guides/inspector.md)
- **Coding agents → ayme MCP server**
  - Flows:
    - → `ayme_connect`, `ayme_list_tools`, `ayme_call`, `ayme_inspect` and the page's
      tools, over stdio; an Agent App that shows MCP Apps also reads the Inspector's page
      that `ayme_inspect` points to
    - ← connect links, the external Inspector's URL, tool lists and `tools/list_changed` notifications, tool results and
      change notes; the Inspector's page with its script inside, its socket's address and
      the token that admits it
  - Evidence: verified: [packages/mcp/src/server/index.ts](packages/mcp/src/server/index.ts), [packages/mcp/src/server/serverTools.ts](packages/mcp/src/server/serverTools.ts),
    [packages/mcp/src/tools/infrastructure/mcpToolServer.ts](packages/mcp/src/tools/infrastructure/mcpToolServer.ts)
- **Coding agents → Session**
  - Flows:
    - → `ayme open [url]`, `ayme attach --cdp=<url>`, `ayme page-objects`, `ayme tools`,
      `ayme call <tool> --params`, `ayme detach`, `ayme close` and `ayme list`, run as
      commands in the project's folder, with the global `--json`, `-s=<name>` or
      `AYME_SESSION` naming the Session, and `--tab=<url>` naming a Tab
    - ← each answer's text, or the answer as JSON for `--json`, on stdout, or on stderr with
      exit code 1 when it is a failure; the address of the browser `ayme open` started or
      `ayme attach` joined; the Page Object Tree and the Page Object Tools of the Tab, each
      listing headed by a line that names the Tab; a Run's short answer, or why it was
      refused or failed; the folder's Sessions by name
    - → `ayme mcp`, which the agent's Agent App starts: `ayme_inspect` over stdio, and the
      read of the Inspector's page it points to
    - ← the Inspector's page, with the Inspector's script, the address of the Session's
      Inspector WebSocket and the token that admits it inside
  - Evidence: verified: [packages/cli/src/readCommand.ts](packages/cli/src/readCommand.ts), [packages/cli/src/answer.ts](packages/cli/src/answer.ts), [packages/session/src/process/infrastructure/wire.ts](packages/session/src/process/infrastructure/wire.ts), [packages/cli/src/mcp.ts](packages/cli/src/mcp.ts), [packages/session/src/process/infrastructure/agentAppPage.ts](packages/session/src/process/infrastructure/agentAppPage.ts)
- **In-browser agents → WebMCP driver**
  - Flows:
    - → calls to the published tools
    - ← tool results
  - Evidence: inferred: the driver is the browser's or a polyfill's; ayme only registers
    tools with it ([packages/webmcp/src/publication.ts](packages/webmcp/src/publication.ts))
- **Host app code → Browser runtime**
  - Flows:
    - → Page Object registrations through the `pageObjects` setup option and
      `usePageObject`, `ayme.tools.list()` and `ayme.tools.run()` calls,
      Custom Tool and Peek registrations
    - ← tool definitions, results and Change Records
  - Evidence: verified: [docs/guide/guides/in-app-assistant.md](docs/guide/guides/in-app-assistant.md), [packages/ayme/src/runtime/runtime.ts](packages/ayme/src/runtime/runtime.ts)
- **App developers → ayme MCP server**
  - Flows:
    - → opening the external Inspector at `/inspector`, then its window's requests over a
      WebSocket at `/inspector/ws`; from the Inspector an Agent App shows in its chat, the
      same requests over the same WebSocket, admitted by its token from the Agent App's
      origin
    - ← the Inspector page and script, and the answers and events relayed from the paired page
  - Evidence: verified: [packages/mcp/src/inspector/infrastructure/externalInspectorServer.ts](packages/mcp/src/inspector/infrastructure/externalInspectorServer.ts), [packages/mcp/src/inspector/application/inspectorRelay.ts](packages/mcp/src/inspector/application/inspectorRelay.ts),
    [packages/inspector/README.md](packages/inspector/README.md)
- **App developers → Session**
  - Flows:
    - → `ayme inspect`, run in the project's folder, which opens the Inspector window; then the window's requests over a WebSocket at `/inspector/ws`, admitted by the Session's token, which `ayme inspect` puts in the window's address after `#`; from the Inspector an Agent App shows in its chat, the same requests over the same WebSocket, admitted by the same token from the Agent App's origin
    - ← the window's address; the Inspector page and script; the answers and events of the Inspector contract of the Tab the Session works on, a new page when that Tab changes, and how the Session ended
  - Evidence: verified: [packages/session/src/process/infrastructure/inspect.ts](packages/session/src/process/infrastructure/inspect.ts), [packages/session/src/process/infrastructure/inspectorWindow.ts](packages/session/src/process/infrastructure/inspectorWindow.ts), [packages/inspector/src/shared/infrastructure/webSocketInspectorContract.ts](packages/inspector/src/shared/infrastructure/webSocketInspectorContract.ts)
- **App developers → Recorder**
  - Flows:
    - → `ayme capture <url>` or `ayme capture --cdp=<url>`, started in their project's
      folder, and the terminal's stop
    - → in the recorder window, Record, Stop, Continue, Assert visibility, Clear, Finish,
      discard and restore of an entry, and the highlight of a hovered entry's or change
      row's element, sent over tRPC on a WebSocket at `/channel`; Record, Stop, Continue
      and Assert visibility in the in-page toolbar, sent through the page function the
      engine exposes there
    - ← the window's address, where the Recording Package was saved, that nothing was
      recorded, or the reason the recorder could not start or failed
    - ← in the recorder window and the toolbar, the recorder's state as it changes: its
      phase, the commands that apply now, the address of the page that is open, and the
      Visits with their entries
  - Evidence: verified: [packages/cli/src/readCommand.ts](packages/cli/src/readCommand.ts), [packages/cli/src/capture.ts](packages/cli/src/capture.ts), [packages/recorder/src/server/infrastructure/windowChannelRouter.ts](packages/recorder/src/server/infrastructure/windowChannelRouter.ts),
    [packages/recorder-window/src/channel/infrastructure/webSocketRecorderChannel.ts](packages/recorder-window/src/channel/infrastructure/webSocketRecorderChannel.ts), [packages/recorder/src/server/infrastructure/toolbarBridge.ts](packages/recorder/src/server/infrastructure/toolbarBridge.ts)
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
- **Browser runtime → ayme MCP server**
  - Flows:
    - → the tab's pairing (link token or loopback auto-pair), tool list and its changes,
      tool results, navigation and reload notices
    - ← tool calls from the agent, the server's token, the App Processes' tools for the
      Inspector
    - → with the external Inspector, the Inspector contract's answers and events, as plain data
    - ← with the external Inspector, a window's requests, in the order they arrived
    - ← with served Page Objects, the runtime and the Page Objects as ES modules over
      HTTP, and a stamp of each rebuild over a WebSocket at `/page-objects/events`
  - Evidence: verified: [packages/mcp/src/client/](packages/mcp/src/client/), [packages/mcp/src/connection/](packages/mcp/src/connection/),
    [packages/mcp/README.md](packages/mcp/README.md), [packages/ayme/src/runtime/inspectorChannelPort.ts](packages/ayme/src/runtime/inspectorChannelPort.ts),
    [packages/mcp/src/served-page-objects/infrastructure/servedPageObjectsServer.ts](packages/mcp/src/served-page-objects/infrastructure/servedPageObjectsServer.ts)
- **Browser runtime → Decision Endpoint**
  - Flows:
    - → `POST { state, questions }` per Goal Loop step
    - ← the provider's decision, or an `{ error }` body
  - Evidence: verified: [packages/ayme/src/goal-loop/infrastructure/decisionEndpoint.ts](packages/ayme/src/goal-loop/infrastructure/decisionEndpoint.ts), [packages/ayme/src/goal-loop/application/goalLoop.ts](packages/ayme/src/goal-loop/application/goalLoop.ts)
- **Browser runtime → WebMCP driver**
  - Flows:
    - → `registerTool` for each active tool, kept in step with the registry
  - Evidence: verified: [packages/webmcp/src/publication.ts](packages/webmcp/src/publication.ts), [packages/webmcp/src/synchronize.ts](packages/webmcp/src/synchronize.ts)
- **Browser automation → Host application**
  - Flows:
    - → the init script, loaded into each page before the page's own scripts
  - Evidence: verified: [packages/mcp/src/served-page-objects/domain/servedPageObjects.ts](packages/mcp/src/served-page-objects/domain/servedPageObjects.ts)
- **Browser runtime → Host application**
  - Flows:
    - → DOM reads, clicks, fills and key presses
    - ← the page structure captured into Structural Page State
  - Evidence: verified: [packages/ayme/src/page-objects/infrastructure/browserPage.ts](packages/ayme/src/page-objects/infrastructure/browserPage.ts), [packages/ayme/src/page-state/infrastructure/browserInPage.ts](packages/ayme/src/page-state/infrastructure/browserInPage.ts),
    [packages/ayme/src/in-page/page/capture.ts](packages/ayme/src/in-page/page/capture.ts)
- **Node host runtime → Host application**
  - Flows:
    - → the In-page Module's install and calls, evaluated in the document through the `Page`,
      and clicks, fills and key presses through Playwright
    - ← the page structure captured into Structural Page State, and action results
  - Evidence: verified: [packages/ayme/src/playwright.ts](packages/ayme/src/playwright.ts), [packages/ayme/src/in-page/host/](packages/ayme/src/in-page/host/)
- **Recorder → Host application**
  - Flows:
    - → loading the Playwright installed in the project's folder, launching Chromium with
      it and opening the URL, or attaching to a running Chromium at its DevTools protocol
      address; in the page, holding a click or key press back and sending it on, and
      reading the page's structure; running the toolbar's script and its page function in
      every document, switching Playwright's own recorder into picking for Assert
      visibility, and drawing a highlight through a DevTools session of the page; tracing
      the recording, and writing the Recording Package with its trace into the project's
      `ayme/recordings`; running the project's own `playwright trace` as a separate
      process
    - ← the opening, navigating and closing of a page, and the closing of the browser; a
      click or key press the page held back, the page's activity, the Interactions and
      assertions Playwright's own recorder reports, the toolbar's commands and requests
      for the state, and the trace's position numbers
  - Evidence: verified: [packages/browser/src/projectPlaywright.ts](packages/browser/src/projectPlaywright.ts), [packages/recorder/src/playwright/infrastructure/live/stockBrowser.ts](packages/recorder/src/playwright/infrastructure/live/stockBrowser.ts), [packages/recorder/src/playwright/infrastructure/in-page/gate.ts](packages/recorder/src/playwright/infrastructure/in-page/gate.ts), [packages/recorder/src/playwright/infrastructure/in-page/watches.ts](packages/recorder/src/playwright/infrastructure/in-page/watches.ts), [packages/recorder/src/playwright/infrastructure/traceTool.ts](packages/recorder/src/playwright/infrastructure/traceTool.ts), [packages/recorder/src/timeline/infrastructure/recordingStore.ts](packages/recorder/src/timeline/infrastructure/recordingStore.ts)
- **Session → Host application**
  - Flows:
    - → loading the Playwright installed in the project's folder, launching Chromium with it
      on a profile of its own and opening the URL, or joining a running Chromium at its
      DevTools protocol address without Playwright's defaults, and listening for dialogs
      without answering them; reading the browser's tab list over HTTP; turning focus
      emulation on for each Tab it works on, through a DevTools session of its own on that Tab
    - ← the browser going away; the tab list, the most recently active tab first; a Tab's
      page closing
  - Evidence: verified: [packages/session/src/playwright/infrastructure/live/stockBrowser.ts](packages/session/src/playwright/infrastructure/live/stockBrowser.ts), [packages/browser/src/infrastructure/live/browser.ts](packages/browser/src/infrastructure/live/browser.ts), [packages/session/src/playwright/infrastructure/live/tabHost.ts](packages/session/src/playwright/infrastructure/live/tabHost.ts), [packages/session/src/playwright/infrastructure/tabList.ts](packages/session/src/playwright/infrastructure/tabList.ts)
- **Session → Node host runtime**
  - Flows:
    - → the built Page Object classes and the Tab's Playwright `Page`, to the Node host runtime
      of the project's own `@ayme-dev/ayme`, through its `./internal` entry, loaded in the
      Session's process, with the selector engine registered on the project's Playwright;
      listings, each in one turn of the Tab, and Runs of Page Object Tools, as the
      `ayme-command` Caller; the Inspector window's calls on the Tab's Inspector contract, served through `inspectorPortOf`, a tool run among them as the `inspector` Caller
    - ← the Page Object Tree as text, each Page Object Tool with its availability, and a Run's
      short answer or its error; the Inspector contract's answers and events
    - ← each Page Object Id the Tab's Host gives, with the class of its Page Object, and each
      it forgets
  - Evidence: verified: [packages/session/src/playwright/infrastructure/live/tabHost.ts](packages/session/src/playwright/infrastructure/live/tabHost.ts), [packages/session/src/page-objects/infrastructure/projectAyme.ts](packages/session/src/page-objects/infrastructure/projectAyme.ts)
- **App Process runtime → ayme MCP server**
  - Flows:
    - → pairing without a token, the process's Peek Tools and their changes, read results
    - ← Peek Tool calls, the names of its tools the agent does not see, the server's token
  - Evidence: verified: [packages/mcp/src/process/](packages/mcp/src/process/), [packages/mcp/README.md](packages/mcp/README.md)
- **Decision Endpoint → Decision model provider**
  - Flows:
    - → the decision request with the bearer key and the pinned Jev model
    - ← the provider's status and body
  - Evidence: verified: [packages/ayme/src/goal-loop/infrastructure/decisionEndpointHandler.ts](packages/ayme/src/goal-loop/infrastructure/decisionEndpointHandler.ts)

## Environments

The host app environments are a developer using ayme in their own app and that app
serving its users. The ayme environments are ayme's own: developing it, checking it and
hosting its playground.

### Host app

#### development

- Purpose: a developer's app running on their machine with a coding agent attached
- Evidence: verified: [docs/guide/guides/connect-an-agent.md](docs/guide/guides/connect-an-agent.md)
- Containers:
  - **Browser runtime**: the app's development build, with `inspector` and
    `agentConnection` on under the framework's development flag; or, with served Page
    Objects, the runtime the init script starts in a page the browser automation opened,
    whose app need not ship ayme
    - Deployment node: the host app's page in the developer's browser
    - Evidence: verified: [docs/guide/guides/connect-an-agent.md](docs/guide/guides/connect-an-agent.md)
  - **Build plugin**: runs inside the dev server's bundler on every transform, when its
    configuration has `include: true`
    - Deployment node: the host app's dev server process
    - Evidence: verified: [packages/unplugin-ayme/src/vite.ts](packages/unplugin-ayme/src/vite.ts), [docs/guide/reference/build-plugin.md](docs/guide/reference/build-plugin.md)
  - **ayme MCP server**: `npx -y @ayme-dev/mcp@<version> mcp`, one child process per agent
    - Deployment node: the coding agent's process on the developer's machine
    - Evidence: verified: [docs/guide/guides/connect-an-agent.md](docs/guide/guides/connect-an-agent.md), [packages/mcp/src/cli.ts](packages/mcp/src/cli.ts)
  - **App Process runtime**: `createAyme({ agentConnection })` started once in the dev
    server's or backend's entry point
    - Deployment node: the host app's dev server process
    - Evidence: verified: [docs/guide/guides/server-rendering.md](docs/guide/guides/server-rendering.md), [packages/mcp/README.md](packages/mcp/README.md)
  - **Node host runtime**: a script or test the developer runs, calling `createAyme({ page })`
    over the Playwright `Page` it launched; optional
    - Deployment node: a Node process on the developer's machine
    - Evidence: verified: [packages/ayme/src/playwright.ts](packages/ayme/src/playwright.ts)
  - **Decision Endpoint**: mounted in the dev server with the developer's own key, so the
    Goal Loop needs no backend while the app is developed
    - Deployment node: the host app's dev server process
    - Evidence: verified: [docs/guide/guides/goals-with-jev.md](docs/guide/guides/goals-with-jev.md)
  - **Playground**: does not run here; it is ayme's own app
    - Evidence: verified: [apps/example-vue/README.md](apps/example-vue/README.md)
  - **Recorder**: `npx ayme capture <url>` from `@ayme-dev/cli`, run by the
    developer or their coding agent in the project's folder, with the project's own
    Playwright; optional
    - Deployment node: a Node process on the developer's machine
    - Evidence: verified: [packages/cli/README.md](packages/cli/README.md)
  - **Session**: `npx ayme open [url]`, or `npx ayme attach --cdp=<url>` on the browser the
    coding agent's automation started, from `@ayme-dev/cli`, run by the coding agent in the
    project's folder, with the project's own Playwright; optional
    - Deployment node: a background Node process on the developer's machine, and the
      Chromium it launches or joins
    - Evidence: verified: [packages/session/src/process/infrastructure/commands.ts](packages/session/src/process/infrastructure/commands.ts)
- External systems:
  - **Host application**: the developer's own app, served by its dev server
    - Evidence: verified: [docs/guide/start/install.md](docs/guide/start/install.md)
  - **Decision model provider**: the live TypeSafe or OpenRouter API, with the developer's key
    - Evidence: verified: [docs/guide/reference/decision-endpoint.md](docs/guide/reference/decision-endpoint.md)
  - **WebMCP driver**: Chrome's flag or a polyfill the app loads before its entry module
    - Evidence: verified: [docs/guide/guides/publish-tools.md](docs/guide/guides/publish-tools.md)
  - **Browser automation**: Playwright MCP, Playwright CLI or a Playwright script pointed at
    `ayme/init-script.js`; optional, present only with served Page Objects
    - Evidence: verified: [packages/mcp/src/served-page-objects/domain/servedPageObjects.ts](packages/mcp/src/served-page-objects/domain/servedPageObjects.ts)

#### production

- Purpose: the host app serving its users, with ayme's agent surface limited to what the
  app's setup publishes
- Evidence: verified: [docs/adr/0030-application-setup-owns-the-runtime-and-decides-publication.md](docs/adr/0030-application-setup-owns-the-runtime-and-decides-publication.md)
- Containers:
  - **Browser runtime**: the production bundle, only when it was built with
    `include: true`, otherwise it is a build without ayme and none of it runs; WebMCP
    publication as the app's setup decides, the Inspector and Agent Connection off, Peeks
    inert
    - Deployment node: the host app's page in its users' browsers
    - Evidence: verified: [docs/adr/0034-peek-tools-reach-coding-agents-only-in-development.md](docs/adr/0034-peek-tools-reach-coding-agents-only-in-development.md),
      [docs/guide/guides/connect-an-agent.md](docs/guide/guides/connect-an-agent.md), [docs/guide/reference/build-plugin.md](docs/guide/reference/build-plugin.md)
  - **Build plugin**: ran once at build time; nothing of it runs in production
    - Evidence: verified: [docs/guide/guides/server-rendering.md](docs/guide/guides/server-rendering.md)
  - **ayme MCP server**: does not run here; coding agents are a development tool
    - Evidence: verified: [docs/guide/guides/connect-an-agent.md](docs/guide/guides/connect-an-agent.md)
  - **App Process runtime**: does not pair here; the docs gate `agentConnection` behind the
    development flag
    - Evidence: inferred: nothing prevents it, the docs only advise the gate
  - **Node host runtime**: does not run here; a Node host drives a browser it launches, as a
    development and test tool
    - Evidence: inferred: nothing in the app's production build reaches `@ayme-dev/ayme/playwright`
  - **Decision Endpoint**: the handler mounted on a route of the app's backend, gated by the
    app's `authorize`
    - Deployment node: the host app's backend
    - Evidence: verified: [docs/guide/reference/decision-endpoint.md](docs/guide/reference/decision-endpoint.md)
  - **Playground**: does not run here
    - Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml)
  - **Recorder**: does not run here; recording is a development tool
    - Evidence: inferred: nothing of the recorder is part of an app's build
  - **Session**: does not run here; a Session is a development tool
    - Evidence: inferred: nothing of a Session is part of an app's build
- External systems:
  - **Host application**: the app itself, in production
    - Evidence: verified: [docs/guide/guides/server-rendering.md](docs/guide/guides/server-rendering.md)
  - **Decision model provider**: the live API, reached only through the Decision Endpoint
    - Evidence: verified: [packages/ayme/src/goal-loop/infrastructure/decisionEndpointHandler.ts](packages/ayme/src/goal-loop/infrastructure/decisionEndpointHandler.ts)
  - **WebMCP driver**: whatever the user's browser or the app's polyfill supplies
    - Evidence: verified: [docs/guide/guides/publish-tools.md](docs/guide/guides/publish-tools.md)
  - **Browser automation**: not used; served Page Objects are served by `ayme mcp`, which
    does not run here
    - Evidence: verified: [docs/guide/guides/connect-an-agent.md](docs/guide/guides/connect-an-agent.md)

### ayme

#### development

- Purpose: a contributor's machine working in this monorepo: the playground and the framework
  examples run from the workspace packages, with a coding agent attached
- Evidence: verified: [apps/example-vue/README.md](apps/example-vue/README.md), [.agents/skills/inspector-dogfood/SKILL.md](.agents/skills/inspector-dogfood/SKILL.md)
- Containers:
  - **Browser runtime**: the playground's and the examples' development builds; the
    playground has WebMCP publication and the Inspector in demo mode, and a `goal` only
    when its dev server has a model key
    - Deployment node: the example's page in the contributor's browser
    - Evidence: verified: [apps/example-vue/src/App.vue](apps/example-vue/src/App.vue), [apps/example-vue/vite.config.ts](apps/example-vue/vite.config.ts)
  - **Build plugin**: the workspace's `@ayme-dev/unplugin-ayme`, consumed from its built
    `dist`, inside each example's dev server
    - Deployment node: each example's dev server process
    - Evidence: verified: [packages/unplugin-ayme/package.json](packages/unplugin-ayme/package.json), [apps/example-vue/vite.config.ts](apps/example-vue/vite.config.ts)
  - **ayme MCP server**: the workspace build, `node packages/mcp/dist/cli.mjs mcp`, registered
    with the contributor's coding agent
    - Deployment node: the coding agent's process on the contributor's machine
    - Evidence: verified: [.agents/skills/inspector-dogfood/SKILL.md](.agents/skills/inspector-dogfood/SKILL.md), [packages/mcp/src/cli.ts](packages/mcp/src/cli.ts)
  - **App Process runtime**: does not run here; no example starts one
    - Evidence: verified: [apps/example-next/README.md](apps/example-next/README.md), [apps/example-nuxt/README.md](apps/example-nuxt/README.md)
  - **Node host runtime**: does not run here outside the unit tests; the playground and the
    examples run the browser runtime
    - Evidence: verified: [packages/ayme/src/playwright.node.test.ts](packages/ayme/src/playwright.node.test.ts)
  - **Decision Endpoint**: the playground's Vite plugin, mounted only when `.env.local` holds
    a TypeSafe or OpenRouter key
    - Deployment node: the playground's Vite dev server
    - Evidence: verified: [apps/example-vue/vite/decisionEndpoint.dev.ts](apps/example-vue/vite/decisionEndpoint.dev.ts), [apps/example-vue/scripts/appEnvironment.ts](apps/example-vue/scripts/appEnvironment.ts),
      [apps/example-vue/.env.example](apps/example-vue/.env.example)
  - **Playground**: a Vite dev server on port 4190
    - Deployment node: the playground's Vite dev server
    - Evidence: verified: [apps/example-vue/package.json](apps/example-vue/package.json), [apps/example-vue/src/App.vue](apps/example-vue/src/App.vue)
  - **Recorder**: the workspace build, `node packages/cli/dist/cli.mjs capture <url>`,
    started in a folder with Playwright installed, such as `apps/recorder-fixture`
    - Deployment node: a Node process on the contributor's machine, and the Chromium it
      launches
    - Evidence: verified: [packages/cli/package.json](packages/cli/package.json), [apps/recorder-fixture/README.md](apps/recorder-fixture/README.md)
  - **Session**: the workspace build, `node packages/cli/dist/cli.mjs open [url]` or
    `attach --cdp=<url>`, started in a folder with Playwright installed, such as `apps/mcp-fixture`
    - Deployment node: a background Node process on the contributor's machine, and the
      Chromium it launches or joins
    - Evidence: verified: [packages/cli/package.json](packages/cli/package.json), [apps/mcp-fixture/README.md](apps/mcp-fixture/README.md)
- External systems:
  - **Host application**: the playground's list app on 4190, and the React, Next.js, Nuxt,
    SvelteKit and Angular examples on 4191, 4192, 4193, 4194 and 4196
    - Evidence: verified: the `dev` scripts in [apps/example-vue/package.json](apps/example-vue/package.json), [apps/example-react/package.json](apps/example-react/package.json),
      [apps/example-next/package.json](apps/example-next/package.json), [apps/example-nuxt/package.json](apps/example-nuxt/package.json),
      [apps/example-sveltekit/package.json](apps/example-sveltekit/package.json), [apps/example-angular/package.json](apps/example-angular/package.json)
  - **Decision model provider**: the live TypeSafe or OpenRouter API, with the contributor's
    key; not reached without one
    - Evidence: verified: [apps/example-vue/scripts/appEnvironment.ts](apps/example-vue/scripts/appEnvironment.ts)
  - **WebMCP driver**: the `@mcp-b/webmcp-polyfill` the playground initializes before the
    Vue app
    - Evidence: verified: [apps/example-vue/src/main.ts](apps/example-vue/src/main.ts)
  - **Browser automation**: not part of the playground and example setup
    - Evidence: verified: [apps/example-vue/README.md](apps/example-vue/README.md)

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
  - **ayme MCP server**: started over stdio by the test's MCP client
    - Deployment node: a Playwright container on a GitHub Actions runner
    - Evidence: verified: [packages/mcp/testing/](packages/mcp/testing/), [apps/mcp-fixture/](apps/mcp-fixture/)
  - **App Process runtime**: the MCP fixture's stand-in App Process in its end-to-end tests
    - Deployment node: a Playwright container on a GitHub Actions runner
    - Evidence: verified: [apps/mcp-fixture/README.md](apps/mcp-fixture/README.md)
  - **Node host runtime**: the unit lane drives real Playwright Chromium against the built
    package: the in-page module's contract suite and the Playwright entry's tests
    - Deployment node: a Playwright container on a GitHub Actions runner
    - Evidence: verified: [packages/ayme/src/playwright.node.test.ts](packages/ayme/src/playwright.node.test.ts), [packages/ayme/src/in-page/host/inPage.node.test.ts](packages/ayme/src/in-page/host/inPage.node.test.ts)
  - **Decision Endpoint**: the playground's dev-server mount, only in the live goal lane
    with a repository secret
    - Deployment node: a Playwright container on a GitHub Actions runner
    - Evidence: verified: [.github/workflows/ci.yml](.github/workflows/ci.yml)
  - **Playground**: built on pull requests that change it, not deployed; its build also
    builds it without ayme and checks that output carries none of ayme
    - Deployment node: a GitHub Actions runner
    - Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml), [apps/example-vue/package.json](apps/example-vue/package.json),
      [apps/example-vue/scripts/verify-browser-output.mjs](apps/example-vue/scripts/verify-browser-output.mjs)
  - **Recorder**: started by the recorder fixture's end-to-end tests, as a child process
    and, to record, in the test's own process, with a headless Chromium
    - Deployment node: a Playwright container on a GitHub Actions runner
    - Evidence: verified: [apps/recorder-fixture/tests/fixtures.ts](apps/recorder-fixture/tests/fixtures.ts), [.github/workflows/ci.yml](.github/workflows/ci.yml)
  - **Session**: started by the MCP fixture's end-to-end tests of the `ayme` command, as a
    child process, with a headless Chromium it launches, or one the test started for it to
    join, through its own Playwright or as a bare Chromium
    - Deployment node: a Playwright container on a GitHub Actions runner
    - Evidence: verified: [apps/mcp-fixture/tests/aymeCommand.ts](apps/mcp-fixture/tests/aymeCommand.ts), [.github/workflows/ci.yml](.github/workflows/ci.yml)
- External systems:
  - **Host application**: the fixture and example apps in [apps/](apps/)
    - Evidence: verified: [docs/testing.md](docs/testing.md)
  - **Decision model provider**: the live API in the live goal lane, skipped without a key
    - Evidence: verified: [.github/workflows/ci.yml](.github/workflows/ci.yml)
  - **WebMCP driver**: a recording driver from `@ayme-dev/webmcp/testing`
    - Evidence: verified: [packages/webmcp/testing/index.ts](packages/webmcp/testing/index.ts)
  - **Browser automation**: the Playwright context of the served Page Objects specs, which
    loads the `ayme/init-script.js` the test's `ayme mcp` wrote
    - Evidence: verified: [apps/mcp-fixture/README.md](apps/mcp-fixture/README.md), [apps/mcp-fixture/tests/servedPageObjects.spec.ts](apps/mcp-fixture/tests/servedPageObjects.spec.ts)

#### playground

- Purpose: the public demo and docs at ayme-labs.github.io/ayme, and the same demo at
  ayme.dev/playground/
- Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml)
- Containers:
  - **Browser runtime**: the playground's production build with `webMCP` and `inspector`
    in demo mode, and no `goal` since no Decision Endpoint exists
    - Deployment nodes: the ayme-labs.github.io/ayme GitHub Pages site, and its
      `/playground/` copy that ayme.dev/playground/ proxies to
    - Evidence: verified: [apps/example-vue/src/App.vue](apps/example-vue/src/App.vue), [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml)
  - **Build plugin**: ran in the Pages build; nothing of it runs on the site
    - Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml)
  - **ayme MCP server**: does not run here; the hosted builds leave out the Agent
    Connection
    - Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml), [apps/example-vue/src/App.vue](apps/example-vue/src/App.vue)
  - **App Process runtime**: does not run here; the site is static
    - Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml)
  - **Node host runtime**: does not run here; the site is static
    - Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml)
  - **Decision Endpoint**: does not run here; the deployed build publishes no `goal`
    - Evidence: verified: [apps/example-vue/README.md](apps/example-vue/README.md)
  - **Playground**: the static Vite build plus the Jekyll-rendered docs under `/docs`,
    built once for each base path
    - Deployment nodes: the ayme-labs.github.io/ayme GitHub Pages site, and its
      `/playground/` copy that ayme.dev/playground/ proxies to
    - Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml), [docs/guide/_config.yml](docs/guide/_config.yml)
  - **Recorder**: does not run here; the site is static
    - Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml)
  - **Session**: does not run here; the site is static
    - Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml)
- External systems:
  - **Host application**: the playground's own list app
    - Evidence: verified: [apps/example-vue/README.md](apps/example-vue/README.md)
  - **Decision model provider**: not reached
    - Evidence: verified: [apps/example-vue/README.md](apps/example-vue/README.md)
  - **WebMCP driver**: the `@mcp-b/webmcp-polyfill` initialized before the Vue app
    - Evidence: verified: [apps/example-vue/src/main.ts](apps/example-vue/src/main.ts)
  - **Browser automation**: not used; the site is static and `ayme mcp` does not run
    - Evidence: verified: [.github/workflows/deploy-example-vue.yml](.github/workflows/deploy-example-vue.yml)
