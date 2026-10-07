# Node-side live Page Object Tools: prototype

Prototype, 2026-10-06, on `origin/main` 25efaa5. It continues the research in PR #525 ("Research: tester-army/e2e and Ayme", draft): can Node, driving a real Playwright `Page`, offer the same live Page Object Tools the browser runtime publishes, from one implementation? The research said yes and proposed a seam; this branch builds the seam into `packages/ayme` and proves it against the live example-react app. It is a prototype PR, to be closed unmerged once its decisions are taken.

## What landed

- `src/pageDriver.ts`: the port, `PageDriver`. Five operations: `isLocator`, `observeRoot`, `watch`, `run`, and the optional `locatorElements` and `resolveRef` for element identity. The registry needs nothing else from a runtime.
- `src/pomRegistry.ts`: `createPomRegistry(driver)`, the registry as an instance. Registrations, probe coalescing and lifetime, change-only notification, the activation rule, tool construction and naming, member reading and input validation moved here unchanged from `registry.ts`. It imports no browser module and no Playwright Lite.
- `src/litePageDriver.ts`: the browser adapter. Lite's brand check, synchronous element resolution with the two-sided identity check, the `MutationObserver` and layout events, `runAction` (Settled Page, Change Record), and Structural Ref resolution through the page state.
- `src/playwrightPageDriver.ts`: the Node adapter. Duck-typed locators, `probePomRootState` unchanged, a watcher installed in every document the page loads (`addInitScript` plus `exposeFunction`), plain method results. The watcher is shipped as a string, so no loader helper can leak into it.
- `src/registry.ts`: now the browser façade. One module-level registry on the Lite driver; the same exports as before for the runtime session, WebMCP publication, page-state capture, the Goal Loop and the Inspector's read model. 1,189 lines became 150.
- `src/playwright.ts`, exported as `@ayme-dev/ayme/playwright`: `observePageObjects(page)` with `register(PomClass, manifest, instance?)`, `probe()`, `tools()`, `subscribe()`, `dispose()`. The built entry imports only the registry chunk and the errors chunk.
- `apps/example-react/tests/nodeLiveTools.spec.ts`: the pilot as an E2E spec against the live example-react app, in the repo's Playwright lane.

## What was measured

Browser runtime on the refactor, in the cloud container (Chromium 1194 aliased as Playwright 1.62's revision 1234): the `chromium` project of `packages/ayme`'s browser lane passes, 283 tests in 24 files, the same count as before the change. The unit lane passes, 220 tests in 26 files. The `native-webmcp` project cannot run there; the container's Chromium has no WebMCP flag. Typecheck, lint, `turbo boundaries`, the docs check and Prettier pass.

Node against the live example-react app on Vite (`--mode inspector-disabled`), real Playwright 1.62.1, every check passed:

1. counter mounted: `AppPage.toggleCounter` and `AppPage.counter.increment` live;
2. running the live tool increments the output, result `{ result: null }`;
3. unmounting through the rootless tool withdraws the child's tool;
4. mounting again through the app brings it back;
5. a `<dialog>.showModal()` over the page: root present, not available, tool withdrawn; `probePomRootState` called directly agrees (`{ present: true, available: false }`), which shows the production callback ran in the page rather than being swallowed as absent;
6. closing the modal makes it live again;
7. unmounting from the page with no explicit probe wakes the subscription through the in-page watcher;
8. a full reload re-installs the watcher: the set comes back live and the next unmount wakes it again.

Probe cost on the live page: about 7.5 ms per probe for one rooted child and three locators (`count` on each locator, `count` plus one `evaluate` on the root).

## Where the seam sits against the Peek work (#497, #511)

The Peek spec gives `ayme mcp` a second tool source: an App Process, which is Ayme started in Node with `createAyme({ agentConnection })` and `start()`, pairing beside the tab and offering `peek.node.<name>` tools. That is the natural home for Node-side Page Object Tools too: an App Process that holds a Playwright `Page` could register Page Objects on the Playwright driver and offer their live tools through the same connection, named apart from the tab's. This prototype stops before that: the `/playwright` entry returns the live tool set to its caller and does not touch the runtime session, `start()`, or the Agent Connection. Folding it into the App Process is a decision for after #511 lands, and the registry instance built here is what that fold needs.

## Decisions left open, for Abel

1. Entry point: `@ayme-dev/ayme/playwright` as here, or `/internal` (ADR-0025 and ADR-0031 call `/internal` transitional), or no entry until the App Process fold.
2. Rootless top-level classes in Node: live while registered, as in the browser (what this prototype does, since Node has a registration call too), or refused, since Node has no component mount behind the registration.
3. Node tool results: the plain method result (`{ result }`, as here), or a Settled Page wait and Change Record. The second needs a Node activity source and a structural capture in Node.
4. Collection tools in Node: the port leaves `resolveRef` and `locatorElements` optional, and the Node driver has neither, so a collection tool in Node throws a `RefResolutionError` saying the runtime has no Structural Refs. Which ref space, if any, comes later.
5. Whether the registry-as-instance refactor stays. It changes no browser behaviour and the browser lane agrees, but it is the one part of this branch that touches production code.
6. Whether the example apps' top-level Page Objects get roots (PR #500's rule), so a Node consumer need not root a copy as the spec does.
