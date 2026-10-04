# @ayme-dev/vue

Vue integration for Ayme. Use a root provider or the existing standalone composable. Both own the same shared runtime behavior.

It supports Vue 3.2.0 and later. With TypeScript and `skipLibCheck: false`, Vue 3.2.0 to 3.2.38 report errors inside Vue's own declarations; use Vue 3.2.39 or later, or keep `skipLibCheck: true`.

## Install and configure

```sh
npm install @ayme-dev/ayme @ayme-dev/vue
npm install -D @ayme-dev/unplugin-ayme @playwright/test@~1.62.1
```

Configure the [Vite plugin](https://github.com/ayme-labs/ayme/blob/main/packages/unplugin-ayme/README.md)
alongside `@vitejs/plugin-vue`, and annotate your POM as shown in the
[main library README](https://github.com/ayme-labs/ayme/blob/main/packages/ayme/README.md).

## Vite setup

```ts
import vue from "@vitejs/plugin-vue";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue(), ayme()],
});
```

Keep decorated Page Object Models in separate `.ts` files with `experimentalDecorators` enabled. Use `@ayme` on the model and `@ayme.action` on exposed actions, as shown in [ListPage](https://github.com/ayme-labs/ayme/blob/main/apps/example-vue/playwright/pom/ListPage.ts).

Publication is off unless the root setup enables it with `webMCP: { enabled: true }` (on `AymeProvider` as `:webMCP="{ enabled: true }"`). `webMCP.toolNamePrefix` prefixes every published tool name; see the [main library README](https://github.com/ayme-labs/ayme/blob/main/packages/ayme/README.md#webmcp-publication). Local Page Object calls remain available without publication or a WebMCP driver.

## Provider setup

```vue
<script setup lang="ts">
import { AymeProvider } from "@ayme-dev/vue";
import App from "./App.vue";
</script>

<template>
  <AymeProvider :webMCP="{ enabled: true }"><App /></AymeProvider>
</template>
```

In the browser, the provider creates a Page for the current document. To supply a custom or decorated Page, pass a factory, `:page-factory="() => customPage"`; the runtime calls it once, in the browser, on first use, and never during server rendering. `createPage(options)` from `@ayme-dev/ayme` builds the default Page with your own settings. Keep the factory fixed while mounted; remount the provider and its consumers to change it. Wrappers must preserve the browser adapter's locator metadata for Ayme observation. Playwright `Page` type compatibility alone does not guarantee observation support.

Pass `:ignore="ignorePageState"` to keep matching elements and their descendants out of the Structural Page State:

```ts
const ignorePageState = (element: Element) =>
  element.matches("[data-assistant-panel]");
```

The same option is available to standalone setup as `useAyme({ ignore })`. When the predicate returns `true`, the matching subtree is dropped from page state capture. This affects page state only; it does not change which tools are published. Keep the predicate fixed while its runtime owner is mounted.

Hooks in `App` and its descendants consume the provider:

```ts
import { useAyme, usePageObject } from "@ayme-dev/vue";
import { ListPage } from "./playwright/pom/ListPage";

const pom = usePageObject(ListPage);
const { ayme, webMCP } = useAyme();

// Later, in an event handler:
await pom.addItem("Write release notes");
```

`ayme` is the runtime session, so `ayme.pursueGoal(goal, { maxSteps })` runs a goal. `webMCP` is the session's `webMCP` member made reactive and read-only: read `webMCP.publicationStatus.state` in script or templates. States are `disabled`, `waiting`, `active`, `unavailable`, `failed`, and `disposed`. Enabled publication waits up to two seconds for a driver. `webMCP.retryPublication()` retries after unavailability or failure; it shares pending attempts and does not duplicate active publication.

## Standalone root setup

Without a provider, `useAyme(options)` owns the runtime:

```ts
const { ayme, webMCP } = useAyme({
  pageFactory: () => customPage,
});
const pom = usePageObject(ListPage);
```

Omit the options to use the default Page. In the browser, the standalone owner starts immediately in the Vue scope and provides its runtime to descendant components. It also continues to support `effectScope()` usage and Page Object registration in the owner's own setup.

| Call                                                 | Behavior                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `useAyme()` beneath an owner                         | Consume its session and `webMCP`; do not start or dispose another runtime |
| `useAyme()` without an ancestor owner                | Start and own the default runtime in the current scope                    |
| `useAyme({ pageFactory })` without an ancestor owner | Start and own the supplied Page's runtime                                 |
| `useAyme({ pageFactory })` beneath an owner          | Throw; configure the Page on the ancestor owner                           |

Ancestor lookup follows the component tree. It does not find a provider rendered below the calling component, or automatically share a runtime between unrelated `effectScope()` calls. Call standalone root setup once in its scope. A second active owner is rejected, including nested providers. Only the creator disposes the runtime. Descendant consumer cleanup removes its own subscriptions and Page Object registrations.

In the browser, `usePageObject(Model)` returns the concrete instance and disposes its registration with its Vue scope. Constructors should only initialize fields and compose locators; invoke actions later. A remount creates a new instance. The hooks require an active Vue effect scope.

## Server rendering and Nuxt

The provider and composables can run during Vue server rendering. They do not construct Page Objects, start the browser runtime, observe the DOM, or publish tools on the server. Each render creates its own inert runtime session; no live browser registration is shared between requests.

On the server, `usePageObject(Model)` returns an unconstructed object with the model's prototype. This allows rendering to reference prototype methods in event closures without running the constructor. Do not read locators or constructor-initialized fields, or execute POM actions, during server rendering. A custom `pageFactory` runs only in the browser; server rendering never calls it.

Browser setup constructs and registers the real Page Object during hydration. Existing browser ownership, `effectScope()` support, and disposal behavior are unchanged. No client-only wrapper is needed around the application UI.

The Vite plugin skips its POM source transform for SSR while retaining shared build configuration. The initial status is `waiting` when the root setup enables publication and `disabled` otherwise, on the server and in the browser. Only the browser attempts publication.

The [Nuxt example](https://github.com/ayme-labs/ayme/tree/main/apps/example-nuxt) shows the existing Vue provider and Vite plugin in an SSR app, including configuration for the built runtime packages and the POM TypeScript project. Its tests run against both Nuxt development and the production Node server.

## Framework parity and example

React has the same provider and Page Object/status/retry names. React requires an ancestor provider; it does not support Vue's standalone startup composable. React status is a plain snapshot instead of a Vue ref.

The [Vue example](https://github.com/ayme-labs/ayme/tree/main/apps/example-vue) retains standalone setup and external demo feedback. From the workspace root, run `pnpm run build`, then `pnpm --filter @ayme-dev/example-vue dev`. Provider and standalone compatibility are checked by this package's tests.

Register each root POM in the component that owns its lifetime. Child POMs in compiled member metadata are discovered recursively; action return values do not register independent roots.

For Chrome or a coding agent connection, follow the skill's
[browser setup reference](https://github.com/ayme-labs/ayme/blob/main/skills/ayme/references/browser-setup.md).

## Coding agent skill

> Install the `ayme` skill from https://github.com/ayme-labs/ayme/tree/main/skills/ayme into this project's skill directory, including its references. Then use it to set up Ayme WebMCP here.
