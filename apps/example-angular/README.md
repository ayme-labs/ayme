# Angular example

This example runs an Angular CLI app with server rendering and hydration on the current Angular major with `@ayme-dev/angular` and the Angular entry of `@ayme-dev/unplugin-ayme`, built through `@angular-builders/custom-esbuild`. It imports only the public `@ayme-dev/angular`. It exercises the integration; it is not a consumer setup guide.

## Run

Inside a Devbox shell at the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@ayme-dev/example-angular...
pnpm --filter @ayme-dev/example-angular dev
```

Open http://127.0.0.1:4196. `pnpm --filter @ayme-dev/example-angular dev:spa` serves the `spa` build configuration instead. Increment normally or through `injectPageObject`. Remove and remount the counter, or navigate to the other page and back, to inspect its registration lifetime.

To serve the production builds after building:

```sh
PORT=4196 pnpm --filter @ayme-dev/example-angular start
HOST=127.0.0.1 PORT=4196 pnpm --filter @ayme-dev/example-angular start:spa
```

## Build configurations

The default build renders on the server (`outputMode: "server"`, `RenderMode.Server`, `provideClientHydration()`). The `spa` configuration turns SSR off: it renders every route in the browser and replaces `hydration.ts` and `app.routes.server.ts` through `fileReplacements`. `pnpm build` builds both.

## SSR contract

`provideAyme` and the inject functions run during server rendering. On the server they never start Ayme, construct Page Objects, observe the DOM or publish tools. `injectPageObject` returns an unconstructed object with the model's prototype, so templates can reference its actions in event bindings. The plugin skips the server bundles, so they keep Angular's own emit. Each request bootstraps its own application and gets its own runtime session. The publication status starts as `waiting`, or `disabled` with publication off, on the server and in the browser alike, so hydration finds the same text; hydration then creates the real Page Objects.

## Verify

After building, with no manually started server:

```sh
pnpm --filter @ayme-dev/example-angular exec playwright install chromium
pnpm --filter @ayme-dev/example-angular test:e2e
```

The browser suite is the shared [example certification](../example-certification/README.md), run against `ng serve` and the production build, for the SSR build and the `spa` configuration (`AYME_E2E_SERVER=production`, `AYME_E2E_RENDER=spa`). The app renders the certification's counter contract: a second page, `/other`, reached by a full page load or the router, an undecorated subclass, `SubCounterPage`, and Page Object Models imported through the tsconfig `paths` alias `@pom/*`. Angular's own tests add, in development SSR, that hydration skipped no component, and that publication is off by default, carries a tool name prefix, and starts after a late driver through `retryPublication`; the app reads those settings from the page URL. Against `ng serve` only, a smoke test opens the Inspector, which the app turns on in dev mode, and an MCP client pairs with the page through a connect link and calls a tool, because the app turns the Agent Connection (`agentConnection`) on in dev mode too; the production build loads no Agent Connection code and opens no WebSocket.

The fixture imports only the public Angular integration. The setup files match
what `ng new` plus `ng add @ayme-dev/angular` produce, except for the
publication options, which the suite varies through the page URL.

## Limits

This fixture certifies standalone Angular applications from Angular 21.0 to the
current major, on Node.js 20.19 and later, client-rendered
and server-rendered with hydration. It does not
certify:

- NgModule-bootstrapped apps (should work, not tested)
- `provideAyme` in route-level providers
- `ng test` with compiled Page Object Models
- Nx workspaces
- a separate POM-only tsconfig watched during `ng serve`
- Page Object Models inside prebuilt packages
- `@defer` and incremental hydration
- a custom `RouteReuseStrategy`
- Angular 19 and 20, which the package supports but this example's APIs and
  `angular.json` do not
- Windows and Linux development hosts beyond CI
