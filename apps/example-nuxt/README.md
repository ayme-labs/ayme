# Nuxt / Vue SSR certification fixture

This certification fixture runs Nuxt 4.5.2 with the existing Vue adapter and
Vite compiler plugin. It renders the counter on the server and hydrates it in
the browser. It exercises the integration; it is not a consumer setup guide.
It does not establish general Nuxt support or a compatibility policy.
There is no Nuxt-specific runtime package and no client-only wrapper.

## Run

Inside a Devbox shell at the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@ayme-dev/example-nuxt...
pnpm --filter @ayme-dev/example-nuxt dev
```

Open http://127.0.0.1:4193. Increment normally or through `usePageObject`.
Remove and remount the counter to inspect its registration lifetime.

To run the production server after building:

```sh
HOST=127.0.0.1 PORT=4193 pnpm --filter @ayme-dev/example-nuxt start
```

## SSR contract

The provider and composables may run during server rendering. They do not
construct Page Objects, activate the browser runtime, observe the DOM, or
publish tools on the server. `usePageObject` returns an unconstructed object
with the model's prototype so rendering can reference actions in event closures.
Do not read locator fields, constructor-initialized fields, or execute actions
while rendering on the server. Real instances are constructed in browser setup.
Custom browser Pages must also be created only in the browser.

The Vite plugin skips the POM source transform for SSR, while retaining shared
publication and Playwright build settings. The example transpiles the Ayme
runtime packages in both graphs so those settings reach server-rendered code.
It uses built package exports, not workspace source aliases. A separate
`tsconfig.pom.json` gives the compiler explicit POM and test roots instead of
relying on Nuxt's generated TypeScript project references.

Publication is enabled. The initial status is `waiting` on both the server and
browser. A browser with a WebMCP driver activates publication. Without a driver,
publication becomes unavailable; local POM actions remain usable.

## Verify

After building, with no manually started server:

```sh
pnpm --filter @ayme-dev/example-nuxt exec playwright install chromium
pnpm --filter @ayme-dev/webmcp-vue test
pnpm --filter @ayme-dev/unplugin-webmcp test
pnpm --filter @ayme-dev/example-nuxt test:e2e
pnpm --filter @ayme-dev/example-vue test:e2e
```

The same browser suite runs against `nuxt dev` and the built Nitro server.
It checks JavaScript-disabled server HTML, repeated requests, hydration with
publication enabled, compiled POM metadata, browser and real Playwright actions,
and registration cleanup across removal and remounting. The publication test
supplies a driver fixture; it does not certify a particular browser's WebMCP API.

The Vue package has DOM-free SSR tests for provider and standalone ownership,
with publication enabled and disabled. The existing Vue/Vite example remains
the CSR regression test.

The fixture imports only the public Vue integration. The E2E tests observe the
compiled POM metadata and the registration lifetime through the tool schemas a
WebMCP driver fixture receives, not through Ayme's internal registry.

## Limits

This fixture covers ordinary Vue SSR and browser hydration on Node. It does
not certify Nuxt islands, server-only components, edge deployment, prerendering,
webpack, packaged-consumer installation, or POM hot replacement. Reload after
editing POM code. No server-side Playwright execution is provided.
