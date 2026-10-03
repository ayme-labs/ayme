# @ayme-dev/svelte

Svelte and SvelteKit integration for Ayme. Call `useAyme(options)` once in the root component and `usePageObject(Model)` in the components that own a Page Object Model. It supports Svelte 3.54 and later, 4 and 5, with legacy syntax or runes.

## Install

```sh
npm install @ayme-dev/ayme @ayme-dev/svelte
npm install -D @ayme-dev/unplugin-ayme @playwright/test@~1.62.1
```

Packages are not published yet; use supplied tarballs before release. The [Vite plugin](https://github.com/ayme-labs/ayme/blob/main/packages/unplugin-ayme/README.md) compiles decorated Page Object Models; annotate them as shown in the [main library README](https://github.com/ayme-labs/ayme/blob/main/packages/ayme/README.md). The [SvelteKit example](https://github.com/ayme-labs/ayme/tree/main/apps/example-sveltekit) is a complete SvelteKit 2 app.

## SvelteKit 2 setup

```ts
// vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // Vite 8 only: SvelteKit 2's tsconfig does not reach oxc.
  oxc: { decorator: { legacy: true } },
  plugins: [sveltekit(), ayme()],
});
```

```jsonc
// tsconfig.json: keep SvelteKit's generated base and enable decorators
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": { "experimentalDecorators": true },
}
```

Keep `svelte.config.js` and its adapter as they are. A Page Object Model is a `.ts` module, for example `src/lib/pom/CounterPage.ts`:

```ts
import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

@ayme
export class CounterPage {
  readonly incrementButton: Locator;

  constructor(page: Page) {
    this.incrementButton = page.getByRole("button", {
      name: "Increment",
      exact: true,
    });
  }

  @ayme.action({ description: "Increment the counter." })
  async increment() {
    await this.incrementButton.click();
  }
}
```

The root `src/routes/+layout.svelte` owns the runtime ([Root setup](#root-setup) shows Svelte 3 and 4 markup):

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";
  import { useAyme } from "@ayme-dev/svelte";

  let { children }: { children: Snippet } = $props();
  useAyme({ webMCP: { enabled: true } });
</script>

{@render children()}
```

A page or component uses the Page Object:

```svelte
<!-- src/routes/+page.svelte -->
<script lang="ts">
  import { usePageObject } from "@ayme-dev/svelte";
  import { CounterPage } from "$lib/pom/CounterPage";

  let count = $state(0);
  const pom = usePageObject(CounterPage);
</script>

<p>Count: <output>{count}</output></p>
<button onclick={() => (count += 1)}>Increment</button>
<button onclick={() => pom.increment()}>Call Page Object</button>
```

Svelte 4 on SvelteKit 2 uses the same files with legacy markup: `let count = 0` and `on:click`. SvelteKit's SPA mode (`export const ssr = false` in the root `+layout.ts`) needs no other change.

## SvelteKit 3 setup

SvelteKit 3 reads its configuration from the `sveltekit()` call and needs no `oxc` option.

```ts
// vite.config.ts
import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit({ adapter: adapter() }), ayme()],
});
```

```jsonc
// tsconfig.json
{
  "extends": "$app/tsconfig",
  "include": ["src", "test", "*"],
  "exclude": ["src/service-worker"],
  "compilerOptions": { "experimentalDecorators": true },
}
```

The POM, root layout and page are the SvelteKit 2 files above, with `#lib/pom/CounterPage.ts` in place of `$lib/pom/CounterPage`. SvelteKit 3 needs the explicit `.ts` extension.

## Svelte app setup (without SvelteKit)

```ts
// vite.config.ts
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [svelte(), ayme()] });
```

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "strict": true
  },
  "include": ["src"]
}
```

```ts
// src/main.ts (Svelte 5)
import { mount } from "svelte";
import App from "./App.svelte";

mount(App, { target: document.getElementById("app")! });
```

Svelte 3 and 4 start the app with `new App({ target: document.getElementById("app")! })`.

`src/App.svelte` owns the runtime and renders the page:

```svelte
<script lang="ts">
  import { useAyme } from "@ayme-dev/svelte";
  import Counter from "./Counter.svelte";

  useAyme({ webMCP: { enabled: true } });
</script>

<Counter />
```

`src/Counter.svelte` uses the POM above, saved as `src/pom/CounterPage.ts`:

```svelte
<script lang="ts">
  import { usePageObject } from "@ayme-dev/svelte";
  import { CounterPage } from "./pom/CounterPage";

  let count = $state(0);
  const pom = usePageObject(CounterPage);
</script>

<p>Count: <output>{count}</output></p>
<button onclick={() => (count += 1)}>Increment</button>
<button onclick={() => pom.increment()}>Call Page Object</button>
```

Svelte 3 and 4 write `let count = 0` and `on:click` instead.

## Root setup

Call `useAyme(options)` in the root `+layout.svelte` (SvelteKit) or `App.svelte` (a Svelte app without SvelteKit):

```svelte
<!-- Svelte 3 and 4, or Svelte 5 without runes -->
<script lang="ts">
  import { useAyme } from "@ayme-dev/svelte";

  useAyme({ webMCP: { enabled: true } });
</script>

<slot />
```

With runes, the layout declares `let { children } = $props()` and renders `{@render children()}` instead of `<slot />`, as in the setup above. The `useAyme` call is the same.

The options are those of `createRuntimeSession` from `@ayme-dev/ayme`, passed to it unchanged: `pageFactory`, `ignore`, `customTools`, `goalLoop` and `webMCP: { enabled, toolNamePrefix }`. Publication is off unless `webMCP.enabled` is `true`; see the [main library README](https://github.com/ayme-labs/ayme/blob/main/packages/ayme/README.md#webmcp-publication). The options are read once. To change them, remount the owner.

| Call                                              | Behavior                                                                                                                                                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useAyme(options)` or `useAyme()`, no owner above | Creates the runtime session and makes it available to descendants. In the browser, starts it during the component's initialisation and stops it when the component is destroyed. On the server, never starts it. |
| `useAyme()` beneath an owner                      | Returns the owner's `{ ayme, webMCP }`; starts and stops nothing                                                                                                                                                 |
| `useAyme(options)` beneath an owner               | Throws `Configure Ayme on the ancestor useAyme(options) owner, not beneath it.`                                                                                                                                  |
| A second owner while one is active                | Throws a `RuntimeStateError`: `useAyme(options) already has an active owner. Call it once, in the root +layout.svelte or App.svelte.`                                                                            |
| Outside component initialisation                  | Svelte's own error, as for `getContext`                                                                                                                                                                          |

Because the runtime starts while the owner initialises, a descendant's `onMount` already sees a started runtime.

## Reading the runtime

Descendants call `useAyme()` without options:

```svelte
<script lang="ts">
  import { useAyme } from "@ayme-dev/svelte";

  const {
    ayme,
    webMCP: { publicationStatus, retryPublication },
  } = useAyme();
</script>

<p>Publication: {$publicationStatus.state}</p>
{#if $publicationStatus.state === "unavailable"}
  <button on:click={retryPublication}>Retry</button>
{/if}
```

`ayme` is the runtime session, so `ayme.pursueGoal(goal, { maxSteps })` runs a goal. `webMCP.publicationStatus` is a readable store of the session's status: `disabled`, `waiting`, `active`, `unavailable`, `failed` or `disposed`. It listens to the session only while it has subscribers. `$publicationStatus` needs a top-level variable, so destructure it as above; it works in legacy and runes components alike. The example above is Svelte 3 and 4 markup; with runes, the button uses `onclick={retryPublication}`. `webMCP.retryPublication` is the session's own function: it retries after unavailability or failure, shares a pending attempt and does not duplicate active publication.

In a Svelte 5 `.svelte.ts` module, `fromStore` turns the store into a rune-backed value. Create it during component initialisation, as `useAyme()` requires:

```ts
// publication.svelte.ts
import { fromStore } from "svelte/store";
import { useAyme } from "@ayme-dev/svelte";

export function usePublicationState() {
  const status = fromStore(useAyme().webMCP.publicationStatus);
  return {
    get state() {
      return status.current.state;
    },
  };
}
```

## Page Objects

```svelte
<script lang="ts">
  import { usePageObject } from "@ayme-dev/svelte";
  import { CounterPage } from "$lib/pom/CounterPage";

  const pom = usePageObject(CounterPage);
</script>

<button on:click={() => pom.increment()}>Call Page Object</button>
```

In the browser, `usePageObject(Model)` returns the concrete Page Object and keeps it registered until its component is destroyed. A remounted component gets a new instance. A SvelteKit page component reused across parameter changes keeps its instance. Constructors should only initialise fields and compose locators; call actions later, for example in an event handler or `onMount`.

`usePageObject` needs a `useAyme` owner in an ancestor component or in the same component. Without one it throws `usePageObject requires useAyme() in an ancestor component, such as the root +layout.svelte.`

Register each root POM in the component that owns its lifetime. Child POMs in compiled member metadata are discovered recursively.

## Server rendering

`useAyme` and `usePageObject` can run during server rendering. They never start the runtime, call `pageFactory`, construct Page Objects or register anything on the server. Each render creates its own session through Svelte context; nothing is kept at module scope, so requests share no state.

On the server, `usePageObject(Model)` returns an unconstructed object with the model's prototype, so markup can reference action methods in event handlers. Do not read locators or constructor-initialised fields, or call actions, during server rendering.

The initial publication status is `waiting` when the root setup enables publication and `disabled` otherwise, on the server and in the browser, so server HTML and hydration agree. Only the browser attempts publication.

## Limits

- Call `useAyme(options)` only in the root `+layout.svelte` or `App.svelte`. SvelteKit creates the next layout before it destroys the previous one, so an owner in a route-group layout becomes a second active owner on navigation and throws.
- POMs must be `.ts` modules. Decorators inside `.svelte` scripts are not compiled.
- The compiler follows SvelteKit's generated tsconfig, so POMs under `src` need nothing more. POMs outside `src`, such as a `playwright/` folder, need their own tsconfig with `experimentalDecorators`, passed to the plugin as `ayme({ tsconfigPath })`, as the [Nuxt example](https://github.com/ayme-labs/ayme/tree/main/apps/example-nuxt) does.
- Below Vite 6, editing a type a POM imports needs a dev-server restart before the published schema changes. Vite 6 and later rebuild it in place.
- SvelteKit 2 on Vite 8 needs `oxc: { decorator: { legacy: true } }` in `vite.config.ts`. Without it, the server fails on the untransformed decorators.

## Naming

The names are `useAyme` and `usePageObject`, not the `setX` and `getX` pairs common in Svelte libraries, so setup reads the same as in the Vue and React packages.

For Chrome or a coding agent connection, follow the skill's
[browser setup reference](https://github.com/ayme-labs/ayme/blob/main/skills/ayme/references/browser-setup.md).

## Coding agent skill

> Install the `ayme` skill from https://github.com/ayme-labs/ayme/tree/main/skills/ayme into this project's skill directory, including its references. Then use it to set up Ayme WebMCP here.
