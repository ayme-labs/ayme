# Vue

Everything about Ayme in a Vue app: setup, the provider and the standalone composable, hooks, server rendering with Nuxt, limits and the API of `@ayme-dev/vue`.

## Setup

Install Ayme, the Vue package and the build plugin, and the Inspector if you want it:

```sh
npm install @ayme-dev/ayme @ayme-dev/vue
npm install -D @ayme-dev/unplugin-ayme @playwright/test @ayme-dev/inspector
```

Add the plugin alongside `@vitejs/plugin-vue`:

```ts
import vue from "@vitejs/plugin-vue";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue(), ayme()],
});
```

Mark your Page Object Models as [Page Object Models](../guides/page-object-models.md) shows.

## Start Ayme at the root

Wrap the app in `AymeProvider`:

```vue
<script setup lang="ts">
import { AymeProvider } from "@ayme-dev/vue";
import App from "./App.vue";
</script>

<template>
  <AymeProvider :webMCP="{ enabled: true }"><App /></AymeProvider>
</template>
```

Or start it with the standalone composable in the root component's setup, as the [Vue example](../../../apps/example-vue/README.md) does:

```ts
import { useAyme } from "@ayme-dev/vue";

useAyme({ webMCP: { enabled: true } });
```

Both take the [`createAyme` options](../reference/ayme.md#createayme); on the provider they are props, such as `:page-factory`, `:ignore` and `:inspector="isDev"`. Keep them fixed while the owner is mounted, and remount the provider and its consumers to change them. For the `navigate` tool to move through Vue Router, pass its `push` with the URL's path: `navigate: (url) => router.push(url.slice(location.origin.length))`, as `:navigate` on the provider; a different function on a later render is a change of options.

## Root ownership

One owner runs Ayme for the document: a provider or a standalone `useAyme(options?)`. A second active owner is rejected, including a provider nested in another. Only the owner disposes the session.

Put the owner at the application root, not in a route component or a layout that unmounts on navigation. Unmounting the owner stops Ayme, which ends its publication and agent connection, so a tool call whose action navigates away from that component can lose its answer.

| Call                                      | Behavior                                                              |
| ----------------------------------------- | --------------------------------------------------------------------- |
| `useAyme()` beneath an owner              | Returns its `{ ayme, webMCP }`; starts and disposes nothing.          |
| `useAyme()` without an owner above        | Starts and owns a session with the default Page in the current scope. |
| `useAyme(options)` without an owner above | Starts and owns a session with those options.                         |
| `useAyme(options)` beneath an owner       | Throws; configure the options on the owner.                           |

In the browser, the standalone owner starts immediately in its Vue scope and provides its session to descendant components. It supports `effectScope()` and using Page Objects in the owner's own setup. Ancestor lookup for `useAyme` follows the component tree: it does not find a provider rendered below the calling component, and unrelated `effectScope()` calls do not share a session. `usePageObject` without an owner above uses the started standalone owner. A consumer's cleanup removes only its own subscriptions and Page Object registrations.

## Composables

```ts
import { useAyme, usePageObject } from "@ayme-dev/vue";
import { ListPage } from "./playwright/pom/ListPage";

const pom = usePageObject(ListPage);
const { ayme, webMCP } = useAyme();

// Later, in an event handler:
await pom.addItem("Write release notes");
```

- `usePageObject(Model)` removes its registration with its Vue scope. The session keeps one instance per class, so every component, and a remount, gets the same one; keep no per-component state in a Page Object's fields. Constructors should only initialize fields and compose locators; run actions later.
- `useAyme()`'s `webMCP` is the session's publication made reactive and read-only: read `webMCP.publicationStatus.state` in script or templates.
- Both need an active Vue effect scope.
- Register each top-level Page Object in the component that owns its lifetime.

## Server rendering

The provider and composables render on the server without starting anything, and hydration constructs the real Page Objects. `usePeek` adds its instance in `onMounted`, which never runs on the server. With Nuxt, add the Vite plugin and decorators in `nuxt.config.ts`:

```ts
// nuxt.config.ts
import { defineNuxtConfig } from "nuxt/config";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";

export default defineNuxtConfig({
  build: { transpile: ["@ayme-dev/ayme", "@ayme-dev/vue"] },
  typescript: {
    tsConfig: { compilerOptions: { experimentalDecorators: true } },
  },
  vite: { plugins: [ayme()] },
});
```

Then wrap the app in `AymeProvider` in `app.vue`, as in any Vue app:

```vue
<!-- app/app.vue -->
<script setup lang="ts">
import { AymeProvider } from "@ayme-dev/vue";

const inspector = import.meta.dev;
</script>

<template>
  <AymeProvider :webMCP="{ enabled: true }" :inspector="inspector">
    <NuxtPage />
  </AymeProvider>
</template>
```

The [Nuxt example](../../../apps/example-nuxt/README.md) runs this setup, and [Server rendering](../guides/server-rendering.md) says what runs where.

## Limits

- The supported Vue and Nuxt versions are on [Install](../start/install.md#supported-versions).
- Options are read once per owner.

## Troubleshooting

| Error                                                                                                                       | Cause                                                           |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `AymeProvider cannot be nested beneath another Ayme runtime owner.`                                                         | A second owner beneath the first. Start Ayme once, at the root. |
| `The provider options must stay fixed while mounted. Remount the provider to change them.`                                  | A provider prop changed while mounted.                          |
| `Configure pageFactory, ignore, customTools, goalLoop and webMCP on the ancestor AymeProvider or standalone useAyme owner.` | `useAyme(options)` beneath an owner.                            |
| `useAyme must be called within an active Vue effect scope`, and the same for `usePageObject`                                | Called outside `setup` or an effect scope.                      |
| `usePageObject requires useAyme() or an AymeProvider in this scope or an ancestor component.`                               | No owner above.                                                 |
| `usePeek must be called in a component's setup`                                                                             | `usePeek` called outside a component's `setup`.                 |
| `usePeek requires useAyme() or an AymeProvider in this component or an ancestor.`                                           | No owner above.                                                 |

## API

| Export                       | Kind       | Does                                                                                                                |
| ---------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `AymeProvider`               | Component  | Starts and owns Ayme for its subtree. Props are the `createAyme` options.                                           |
| `useAyme(options?)`          | Composable | Without an owner above, starts and owns Ayme. Returns `{ ayme, webMCP }`.                                           |
| `usePageObject(Model)`       | Composable | Registers the class for the current scope and returns its instance.                                                 |
| `usePeek(values, name, id?)` | Composable | Adds the component's instance of the Peek `name` while it is mounted, reading the current values of `values`' refs. |
