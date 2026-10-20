# Vue

Everything about Ayme in a Vue app: setup, the provider and the standalone composable, hooks, server rendering with Nuxt, limits and the API of `@ayme-dev/vue`.

## Setup

Install Ayme, the Vue package and the build plugin, with the Inspector and the Agent Connection for development, as the [Vue quickstart](../start/quickstart-vue.md) does:

```sh
npm install @ayme-dev/ayme @ayme-dev/vue
npm install -D @ayme-dev/unplugin-ayme @playwright/test @ayme-dev/inspector @ayme-dev/mcp
```

Add the plugin alongside `@vitejs/plugin-vue`:

```ts
import vue from "@vitejs/plugin-vue";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [vue(), ayme({ include: command === "serve" })],
}));
```

`include` keeps Ayme in the dev server and out of `vite build`; [Include Ayme in a build](../reference/build-plugin.md#include-ayme-in-a-build) covers the builds that keep it.

Mark your Page Object Models as [Page Object Models](../guides/page-object-models.md) shows.

## Start Ayme at the root

Wrap the app in `AymeProvider`, with the Inspector and the Agent Connection in development:

```vue
<!-- src/Root.vue -->
<script setup lang="ts">
import { AymeProvider } from "@ayme-dev/vue";
import App from "./App.vue";

const dev = import.meta.env.DEV;
</script>

<template>
  <AymeProvider :inspector="dev" :agentConnection="dev"><App /></AymeProvider>
</template>
```

Then mount that component instead of `App` in `src/main.ts`:

```ts
// src/main.ts
import Root from "./Root.vue";

createApp(Root).mount("#app");
```

Or start it with the standalone composable in the root component's setup, as the [Vue example](https://github.com/ayme-labs/ayme/blob/main/apps/example-vue/README.md) does:

```ts
import { useAyme } from "@ayme-dev/vue";

useAyme({
  inspector: import.meta.env.DEV,
  agentConnection: import.meta.env.DEV,
});
```

Both take the [`createAyme` options](../reference/ayme.md#createayme); on the provider they are props, such as `:page-factory`, `:ignore`, `:inspector` and `:agentConnection`. Your coding agent then connects to the page as [Connect an agent](../guides/connect-an-agent.md) shows. Keep them fixed while the owner is mounted, and remount the provider and its consumers to change them. For the `navigate` tool to move through Vue Router, pass its `push` with the URL's path: `navigate: (url) => router.push(url.slice(location.origin.length))`, as `:navigate` on the provider; a different function on a later render is a change of options.

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

Register the app's pages once, in the root component's setup, beneath the owner or in the same setup as the standalone `useAyme`; each page is present by its URL, as [Pages and components](../guides/page-object-models.md#pages-and-components) shows:

```ts
import { usePageObject } from "@ayme-dev/vue";
import { ListPage } from "./playwright/pom/ListPage";
import { SettingsPage } from "./playwright/pom/SettingsPage";

usePageObject(ListPage);
usePageObject(SettingsPage);
```

A component that calls an action gets the same instance from the same composable:

```ts
import { useAyme, usePageObject } from "@ayme-dev/vue";
import { ListPage } from "./playwright/pom/ListPage";

const pom = usePageObject(ListPage);
const { ayme } = useAyme();

// Later, in an event handler:
await pom.addItem("Write release notes");
```

- `usePageObject(Model)` removes its registration with its Vue scope, so a model registered only in a component is registered while the component lives; [Register Page Objects](../guides/publish-tools.md#register-page-objects) says when that is the right place. The session keeps one instance per class, so every component, and a remount, gets the same one; keep no per-component state in a Page Object's fields. Constructors should only initialize fields and compose locators; run actions later.
- `useAyme()` returns the owner's session, `ayme`, and its WebMCP publication, `webMCP`.
- Both need an active Vue effect scope.

## Optional: publish with WebMCP

To publish the same tools through WebMCP for agents that run in the browser, as [Publish tools](../guides/publish-tools.md) describes, install the publication package:

```sh
npm install @ayme-dev/webmcp
```

Then add `webMCP` to the owner's options, `:webMCP="{ enabled: true }"` on the provider or in the standalone call:

```ts
useAyme({
  inspector: import.meta.env.DEV,
  agentConnection: import.meta.env.DEV,
  webMCP: { enabled: true },
});
```

`useAyme()`'s `webMCP` is the session's publication made reactive and read-only: read `webMCP.publicationStatus.state` in script or templates, and call `webMCP.retryPublication()` to try again after publication found no WebMCP driver or failed:

```vue
<script setup lang="ts">
import { useAyme } from "@ayme-dev/vue";

const { webMCP } = useAyme();
</script>

<template>
  <p>Publication: {{ webMCP.publicationStatus.state }}</p>
  <button @click="webMCP.retryPublication()">Retry publication</button>
</template>
```

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
  // nuxi build sets NODE_ENV to production: Ayme stays in the dev server only.
  vite: { plugins: [ayme({ include: process.env.NODE_ENV !== "production" })] },
});
```

Then wrap the app in `AymeProvider` in `app.vue`, as in any Vue app:

```vue
<!-- app/app.vue -->
<script setup lang="ts">
import { AymeProvider } from "@ayme-dev/vue";

const dev = import.meta.dev;
</script>

<template>
  <AymeProvider :inspector="dev" :agentConnection="dev">
    <NuxtPage />
  </AymeProvider>
</template>
```

The [Nuxt example](https://github.com/ayme-labs/ayme/blob/main/apps/example-nuxt/README.md) runs this setup, and [Server rendering](../guides/server-rendering.md) says what runs where.

## Bundle size

Ayme's runtime adds about 800 to 950 kB raw (about 250 kB transferred) to the entry chunk of a build that includes it, which trips Vite's warning for chunks over 500 kB, and the Inspector is a separate chunk that loads only when it is on. A build includes Ayme only with the plugin's `include: true`; the config above keeps it in the dev server and out of `vite build`. See [Include Ayme in a build](../reference/build-plugin.md#include-ayme-in-a-build).

## Limits

- The supported Vue and Nuxt versions are on [Install](../start/install.md#supported-versions).
- Options are read once per owner.

## Troubleshooting

| Error                                                                                         | Cause                                                           |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `AymeProvider cannot be nested beneath another Ayme runtime owner.`                           | A second owner beneath the first. Start Ayme once, at the root. |
| `The provider options changed while the provider was mounted.`                                | A provider prop changed while mounted.                          |
| `useAyme(options) received options beneath an existing AymeProvider or useAyme owner.`        | `useAyme(options)` beneath an owner.                            |
| `useAyme must be called within an active Vue effect scope`, and the same for `usePageObject`  | Called outside `setup` or an effect scope.                      |
| `usePageObject requires useAyme() or an AymeProvider in this scope or an ancestor component.` | No owner above.                                                 |
| `usePeek must be called in a component's setup`                                               | `usePeek` called outside a component's `setup`.                 |
| `usePeek requires useAyme() or an AymeProvider in this component or an ancestor.`             | No owner above.                                                 |

## API

| Export                       | Kind       | Does                                                                                                                                                                   |
| ---------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AymeProvider`               | Component  | Starts and owns Ayme for its subtree. Props are the `createAyme` options.                                                                                              |
| `useAyme(options?)`          | Composable | Without an owner above, starts and owns Ayme. Returns `{ ayme, webMCP }`.                                                                                              |
| `usePageObject(Model)`       | Composable | Registers the class for the current scope and returns its instance.                                                                                                    |
| `usePeek(values, name, id?)` | Composable | [Experimental](../reference/experimental-apis.md). Adds the component's instance of the Peek `name` while it is mounted, reading the current values of `values`' refs. |
