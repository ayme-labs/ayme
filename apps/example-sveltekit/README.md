# SvelteKit certification example

This example runs SvelteKit 2 with Svelte 5, Vite 8 and adapter-node, using `@ayme-dev/svelte` and the Vite compiler plugin. The root `+layout.svelte` owns the runtime with `useAyme`, the home page renders a counter whose Page Object comes from `usePageObject`, and a second page has no Page Object. It certifies the integration; the [package README](../../packages/svelte/README.md) is the setup guide.

## Run

Inside a Devbox shell at the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@ayme-dev/example-sveltekit...
pnpm --filter @ayme-dev/example-sveltekit dev
```

Open http://127.0.0.1:4194. Increment normally or through the Page Object, remove and remount the counter, and navigate to the other page and back to see the registration follow the page.

To run the production server after building:

```sh
HOST=127.0.0.1 PORT=4194 pnpm --filter @ayme-dev/example-sveltekit start
```

## Setup

- `vite.config.ts` adds `ayme()` next to `sveltekit()` and sets `oxc: { decorator: { legacy: true } }`. SvelteKit 2's generated tsconfig does not reach Vite 8's oxc transform, so without it the server fails on the untransformed decorators. #279 tracks having the plugin set it.
- `tsconfig.json` extends SvelteKit's generated config and enables `experimentalDecorators`. The compiler follows that chain, so the POM in `src/lib/pom` needs no separate tsconfig.
- Publication is enabled in the root layout. The initial status is `waiting` on the server and in the browser. A browser with a WebMCP driver activates publication; without one it becomes unavailable and local Page Object calls still work.

## Verify

After building, with no manually started server:

```sh
pnpm --filter @ayme-dev/example-sveltekit exec playwright install chromium
pnpm --filter @ayme-dev/example-sveltekit test:e2e
```

The same suite runs against `vite dev` and the adapter-node server. It checks JavaScript-disabled server HTML on repeated requests, hydration without errors, that a descendant's `onMount` sees a started runtime, the published schema against the POM source, a tool call, the Page Object called from the page and through real Playwright, unmount and remount, and client navigation removing and restoring the page's tool while the root layout keeps the owner. In development only, it also edits a type the POM imports and checks the published schema rebuilds without restarting `vite dev`.

The tests observe tools through the recording WebMCP driver from `@ayme-dev/ayme/testing`, not through Ayme's internal registry. They do not certify a particular browser's WebMCP API.

## Limits

- The owner must be in the root `+layout.svelte`. SvelteKit creates the next layout before it destroys the previous one, so an owner in a route-group layout fails with "already has an active owner" on navigation.
- POMs must be `.ts` modules. Decorators inside `.svelte` scripts are not compiled.
- This example runs on Vite 8, where a type edit rebuilds the schema. Below Vite 6, the plugin cannot invalidate dependants, so a type edit needs a dev-server restart.
- It certifies the current SvelteKit 2, Svelte 5 and Vite 8 on Node with adapter-node. It does not certify SvelteKit 1 or 3, other adapters, edge deployment, prerendering, streaming, form actions, or server-side Page Object execution. Older Svelte versions are covered by the package's unit tests only.
- The Inspector is not wired into this example.
