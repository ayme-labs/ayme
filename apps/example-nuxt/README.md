# Nuxt / Vue SSR certification fixture

This certification fixture runs Nuxt with the existing Vue adapter and
Vite compiler plugin. It renders the counter on the server and hydrates it in
the browser. It exercises the integration; it is not a consumer setup guide.

CI runs it on the locked Nuxt 4.5 (Vite 8) and on Nuxt 4.0.1 (Vite 7) with
Node.js 20.19, so the integration supports Nuxt 4.0.1 and later. Nuxt itself
needs Node.js 22.12 from 4.4.6 and 22.19 from 4.5, so a current Nuxt release
needs Node.js 22. Nuxt 3 is not supported.
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
Playwright build settings. The example transpiles the Ayme
runtime packages in both graphs so those settings reach server-rendered code.
It uses built package exports, not workspace source aliases. A separate
`tsconfig.pom.json` gives the compiler explicit POM and test roots instead of
relying on Nuxt's generated TypeScript project references.

Publication is enabled. The initial status is `waiting` on both the server and
browser. A browser with a WebMCP driver activates publication. Without a driver,
publication becomes unavailable; local POM actions remain usable.

## Peeks

The counter adds the Peek `counter` with `usePeek`, read as `peek.counter`.
In development, the Nitro server plugin `server/plugins/ayme.ts` starts an
App Process: the server pairs with the agent's Ayme MCP server beside the tab
and offers the Peek `renders`, how many pages it rendered, read as
`peek.node.renders`. The plugin does nothing in a production build. It looks
for the agent's server on the port range, or only on the port in
`AYME_EXAMPLE_AGENT_PORT` when set, which the e2e tests set; Ayme itself
reads no environment variable. `usePeek` registers after mount, in the
browser, so server rendering adds no `counter` instance to the App Process.

## Verify

After building, with no manually started server:

```sh
pnpm --filter @ayme-dev/example-nuxt exec playwright install chromium
pnpm --filter @ayme-dev/vue test
pnpm --filter @ayme-dev/unplugin-ayme test
pnpm --filter @ayme-dev/example-nuxt test:e2e
pnpm --filter @ayme-dev/example-vue test:e2e
```

The browser suite is the shared [example certification](../example-certification/README.md), run against `nuxt dev` and the built Nitro server (`AYME_E2E_SERVER=production`). The app renders the certification's counter contract: a second page, `/other`, reached by a full page load, and an undecorated `SubCounterPage`. Against `nuxt dev` only, where the app turns the Inspector on, a smoke test opens it and runs a tool from it, and the Agent Connection (`agentConnection`) is on too: an MCP client pairs with the page through a connect link calls a tool and reads the counter's Peek, while the built server loads no Agent Connection code and opens no WebSocket. Against `nuxt dev`, with the App Process paired, a server-rendered page load leaves `peek.counter` with exactly one instance, from the browser, and the server offers `peek.node.renders` but no `peek.node.counter`; against the built server no App Process pairs. The certification supplies a driver fixture; it does not certify a particular browser's WebMCP API.

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
