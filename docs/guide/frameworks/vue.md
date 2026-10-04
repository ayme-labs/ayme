# Vue

Everything about Ayme in a Vue app: setup, the provider and the standalone composable, hooks, server rendering with Nuxt, limits and the API of `@ayme-dev/vue`.

## Setup

Install Ayme, the Vue package and the build plugin:

```sh
npm install @ayme-dev/ayme @ayme-dev/vue
npm install -D @ayme-dev/unplugin-ayme @playwright/test
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

Both take the [`createAyme` options](../reference/ayme.md#createayme); on the provider they are props, such as `:page-factory`, `:ignore` and `:inspector="isDev"`. Keep them fixed while the owner is mounted, and remount the provider and its consumers to change them.

## Root ownership

One owner runs Ayme for the document: a provider or a standalone `useAyme(options?)`. A second active owner is rejected, including a provider nested in another. Only the owner disposes the session.

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

The provider and composables run during server rendering without constructing Page Objects, starting the session, observing the DOM or publishing tools. No browser registration is shared between requests.

- On the server, `usePageObject(Model)` returns an unconstructed object with the model's prototype, so rendering can reference its methods in event handlers. Do not read locators or constructor-initialized fields, or run actions, during server rendering.
- A custom `pageFactory` runs only in the browser.
- Hydration constructs and registers the real Page Object. No client-only wrapper is needed around the app.
- The status starts as `waiting` when publication is enabled and `disabled` otherwise, on the server and in the browser. Only the browser publishes.

With Nuxt, use the provider and the Vite plugin; the [Nuxt example](../../../apps/example-nuxt/README.md) shows the configuration, including the Page Object Models' TypeScript project.

## Limits

- The supported Vue and Nuxt versions are on [Install](../start/install.md#supported-versions).
- Options are read once per owner.

## API

| Export                 | Kind       | Does                                                                      |
| ---------------------- | ---------- | ------------------------------------------------------------------------- |
| `AymeProvider`         | Component  | Starts and owns Ayme for its subtree. Props are the `createAyme` options. |
| `useAyme(options?)`    | Composable | Without an owner above, starts and owns Ayme. Returns `{ ayme, webMCP }`. |
| `usePageObject(Model)` | Composable | Registers the class for the current scope and returns its instance.       |
