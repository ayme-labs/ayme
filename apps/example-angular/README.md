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

`provideAyme` and the inject functions run during server rendering. On the server they never start Ayme, construct Page Objects, observe the DOM or publish tools. `injectPageObject` returns an unconstructed object with the model's prototype, so templates can reference its actions in event bindings. The plugin skips the server bundles, so they keep Angular's own emit. Each request bootstraps its own application and gets its own runtime session. The publication status starts as `waiting` on the server and in the browser, so hydration finds the same text; hydration then creates the real Page Objects.

## Verify

After building, with no manually started server:

```sh
pnpm --filter @ayme-dev/example-angular exec playwright install chromium
pnpm --filter @ayme-dev/example-angular test:e2e
```

The same browser suite runs against `ng serve` and the production build, for the SSR build and the `spa` configuration. With JavaScript disabled, it checks that two server requests each return the rendered UI and the initial publication status. In development SSR it checks that hydration skipped no component. Through the recording WebMCP driver it checks that publication becomes active, that the published schema matches the Page Object Model source, that a published tool, a component button and the model constructed from Playwright all drive the page, and that `@if` removal and router navigation remove the tools and restore them with fresh state.
