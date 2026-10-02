# Angular example

This example runs an Angular CLI app on the current Angular major with `@ayme-dev/angular` and the Angular entry of `@ayme-dev/unplugin-ayme`, built through `@angular-builders/custom-esbuild`. It imports only the public `@ayme-dev/angular`. It exercises the integration; it is not a consumer setup guide.

## Run

Inside a Devbox shell at the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@ayme-dev/example-angular...
pnpm --filter @ayme-dev/example-angular dev
```

Open http://127.0.0.1:4196. Increment normally or through `injectPageObject`. Remove and remount the counter, or navigate to the other page and back, to inspect its registration lifetime.

To serve the production build after building:

```sh
HOST=127.0.0.1 PORT=4196 pnpm --filter @ayme-dev/example-angular start
```

## Verify

After building, with no manually started server:

```sh
pnpm --filter @ayme-dev/example-angular exec playwright install chromium
pnpm --filter @ayme-dev/example-angular test:e2e
```

The same browser suite runs against `ng serve` and the production build. Through the recording WebMCP driver it checks that publication becomes active, that the published schema matches the Page Object Model source, that a published tool, a component button and the model constructed from Playwright all drive the page, and that `@if` removal and router navigation remove the tools and restore them with fresh state.
