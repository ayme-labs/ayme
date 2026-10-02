# @ayme-dev/svelte

Svelte and SvelteKit integration for Ayme. Call `useAyme(options)` once in the root component and `usePageObject(Model)` in the components that own a Page Object Model. It supports Svelte 3.54 and later, 4 and 5, with legacy syntax or runes.

## Install and configure

```sh
npm install @ayme-dev/ayme @ayme-dev/svelte
npm install -D @ayme-dev/unplugin-ayme @playwright/test@~1.62.1
```

Packages are not published yet; use supplied tarballs before release.
Configure the [Vite plugin](https://github.com/ayme-labs/ayme/blob/main/packages/unplugin-ayme/README.md)
next to `sveltekit()` or `svelte()`, and annotate your POM as shown in the
[main library README](https://github.com/ayme-labs/ayme/blob/main/packages/ayme/README.md).

```ts
import { sveltekit } from "@sveltejs/kit/vite";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit(), ayme()],
});
```

Keep decorated Page Object Models in separate `.ts` files with `experimentalDecorators` enabled. Decorators inside `.svelte` scripts are not compiled.

## Root setup

Call `useAyme(options)` in the root `+layout.svelte` (SvelteKit) or `App.svelte` (a Svelte app without SvelteKit):

```svelte
<script lang="ts">
  import { useAyme } from "@ayme-dev/svelte";

  useAyme({ webMCP: { enabled: true } });
</script>

<slot />
```

In Svelte 5 runes mode, the layout also declares `let { children } = $props();` and renders `{@render children()}` instead of `<slot />`. The `useAyme` call is the same.

The options are those of `createRuntimeSession` from `@ayme-dev/ayme`, passed to it unchanged: `pageFactory`, `ignore`, `customTools`, `goalLoop` and `webMCP: { enabled, toolNamePrefix }`. Publication is off unless `webMCP.enabled` is `true`; see the [main library README](https://github.com/ayme-labs/ayme/blob/main/packages/ayme/README.md#webmcp-publication). The options are read once. To change them, remount the owner.

| Call                                              | Behavior                                                                                                                                                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useAyme(options)` or `useAyme()`, no owner above | Creates the runtime session and makes it available to descendants. In the browser, starts it during the component's initialisation and stops it when the component is destroyed. On the server, never starts it. |
| `useAyme()` beneath an owner                      | Returns the owner's `{ ayme, webMCP }`; starts and stops nothing                                                                                                                                                 |
| `useAyme(options)` beneath an owner               | Throws `Configure Ayme on the ancestor useAyme(options) owner, not beneath it.`                                                                                                                                  |
| A second owner while one is active                | Throws a `RuntimeStateError`: `useAyme(options) already has an active owner. Call it once, in the root +layout.svelte or App.svelte.`                                                                            |
| Outside component initialisation                  | Svelte's own error, as for `getContext`                                                                                                                                                                          |

Keep the owner in the root layout. SvelteKit creates the next layout before it destroys the previous one, so an owner in a route-group layout becomes a second active owner on navigation.

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

`ayme` is the runtime session, so `ayme.pursueGoal(goal, { maxSteps })` runs a goal. `webMCP.publicationStatus` is a readable store of the session's status: `disabled`, `waiting`, `active`, `unavailable`, `failed` or `disposed`. It listens to the session only while it has subscribers. `$publicationStatus` needs a top-level variable, so destructure it as above. In a Svelte 5 `.svelte.ts` module, `fromStore(publicationStatus).current` reads it as a rune. `webMCP.retryPublication` is the session's own function: it retries after unavailability or failure, shares a pending attempt and does not duplicate active publication.

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

## Framework parity

The names follow the Vue and React packages: `useAyme` and `usePageObject`, not the `setX` and `getX` pairs common in Svelte libraries, so the same setup reads the same in every framework. Like Vue's standalone setup, the Svelte owner is a function call in the root component; there is no provider component. Unlike Vue, `usePageObject` always needs an owner.

For Chrome or a coding agent connection, follow the skill's
[browser setup reference](https://github.com/ayme-labs/ayme/blob/main/skills/ayme/references/browser-setup.md).

## Coding agent skill

> Install the `ayme` skill from https://github.com/ayme-labs/ayme/tree/main/skills/ayme into this project's skill directory, including its references. Then use it to set up Ayme WebMCP here.
