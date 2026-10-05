# Svelte

Everything about Ayme in a Svelte or SvelteKit app: setup, starting Ayme in the root component, root ownership, composables, server rendering, limits and the API of `@ayme-dev/svelte`.

## Setup

Install Ayme, the Svelte package and the build plugin, and the Inspector if you want it:

```sh
npm install @ayme-dev/ayme @ayme-dev/svelte
npm install -D @ayme-dev/unplugin-ayme @playwright/test @ayme-dev/inspector
```

Add the plugin after your Svelte plugin, `sveltekit()` or `svelte()`:

```ts
// vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit(), ayme()],
});
```

Enable `experimentalDecorators` in the tsconfig, keeping SvelteKit's generated base:

```jsonc
// tsconfig.json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": { "experimentalDecorators": true },
}
```

On SvelteKit 3, which reads its configuration from the `sveltekit()` call, extend `$app/tsconfig` instead and import Page Object Models with their `.ts` extension, such as `#lib/pom/ProjectsPage.ts`. Keep `svelte.config.js` and its adapter as they are. Mark your Page Object Models as [Page Object Models](../guides/page-object-models.md) shows, in `.ts` modules.

## Start Ayme at the root

Call `useAyme(options)` in the root `+layout.svelte`, or `App.svelte` without SvelteKit:

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";
  import { useAyme } from "@ayme-dev/svelte";

  let { children }: { children: Snippet } = $props();
  useAyme({ webMCP: { enabled: true } });
</script>

{@render children()}
```

Svelte 3 and 4, or Svelte 5 without runes, render `<slot />` instead; the `useAyme` call is the same. The options are the [`createAyme` options](../reference/ayme.md#createayme), passed through unchanged, such as `inspector: dev` from `$app/environment`. They are read once; to change them, remount the owner.

## Root ownership

| Call                                              | Behavior                                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `useAyme(options)` or `useAyme()`, no owner above | Creates the session and makes it available to descendants. In the browser, starts it while the component initializes and stops it when the component is destroyed. |
| `useAyme()` beneath an owner                      | Returns the owner's `{ ayme, webMCP }`; starts and stops nothing.                                                                                                  |
| `useAyme(options)` beneath an owner               | Throws; configure the options on the owner.                                                                                                                        |
| A second owner while one is active                | Throws a `RuntimeStateError`.                                                                                                                                      |
| Outside component initialization                  | Svelte's own error, as for `getContext`.                                                                                                                           |

Because the session starts while the owner initializes, a descendant's `onMount` already sees it started.

## Composables

```svelte
<script lang="ts">
  import { useAyme, usePageObject } from "@ayme-dev/svelte";
  import { ProjectsPage } from "$lib/pom/ProjectsPage";

  const pom = usePageObject(ProjectsPage);
  const {
    webMCP: { publicationStatus, retryPublication },
  } = useAyme();
</script>

<p>Publication: {$publicationStatus.state}</p>
<button onclick={() => pom.createProject("Launch plan")}>Show me how</button>
{#if $publicationStatus.state === "unavailable"}
  <button onclick={retryPublication}>Retry</button>
{/if}
```

- `usePageObject(Model)` needs a `useAyme` owner in an ancestor or the same component. It removes its registration when its component is destroyed. The session keeps one instance per class, so every component, and a remount, gets the same one; keep no per-component state in a Page Object's fields. Constructors should only initialize fields and compose locators; call actions later, such as in an event handler or `onMount`.
- `webMCP.publicationStatus` is a readable store that listens to the session only while it has subscribers. `$publicationStatus` needs a top-level variable, so destructure it as above; it works in legacy and runes components alike. Svelte 3 and 4 write `on:click` instead of `onclick`.
- In a Svelte 5 `.svelte.ts` module, `fromStore(useAyme().webMCP.publicationStatus)` from `svelte/store` turns the store into a rune-backed value; create it during component initialization.
- Register each top-level Page Object in the component that owns its lifetime.

## Server rendering

SvelteKit renders on the server by default, and the setup above needs nothing more: `useAyme` and `usePageObject` run during server rendering without starting anything, and hydration constructs the real Page Objects. The same files work in SvelteKit's SPA mode:

```ts
// src/routes/+layout.ts
export const ssr = false;
```

The [SvelteKit example](../../../apps/example-sveltekit/README.md) runs both, and [Server rendering](../guides/server-rendering.md) says what runs where.

## Limits

- Call `useAyme(options)` only in the root `+layout.svelte` or `App.svelte`. SvelteKit creates the next layout before it destroys the previous one, so an owner in a route-group layout becomes a second active owner on navigation and throws.
- Decorators inside `.svelte` scripts are not compiled.
- The compiler follows SvelteKit's generated tsconfig, so Page Object Models under `src` need nothing more. Models outside `src`, such as a `playwright/` folder, need their own tsconfig with `experimentalDecorators`, passed to the plugin as `ayme({ tsconfigPath })`.
- The supported Svelte versions are on [Install](../start/install.md#supported-versions). The [SvelteKit example](../../../apps/example-sveltekit/README.md) runs SvelteKit 2.

## Troubleshooting

| Error                                                                                                   | Cause                                          |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `useAyme(options) already has an active owner. Call it once, in the root +layout.svelte or App.svelte.` | A second owner, often in a route-group layout. |
| `Configure Ayme on the ancestor useAyme(options) owner, not beneath it.`                                | `useAyme(options)` beneath an owner.           |
| `usePageObject requires useAyme() in an ancestor component, such as the root +layout.svelte.`           | No owner above.                                |

## API

| Export                 | Kind       | Does                                                                              |
| ---------------------- | ---------- | --------------------------------------------------------------------------------- |
| `useAyme(options?)`    | Composable | Without an owner above, creates and owns the session. Returns `{ ayme, webMCP }`. |
| `usePageObject(Model)` | Composable | Registers the class while the component lives and returns its instance.           |
