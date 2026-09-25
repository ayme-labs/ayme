# @ayme-dev/webmcp-vue

Vue integration for Ayme WebMCP. Use a root provider or the existing standalone composable. Both own the same shared runtime behavior.

## Install and configure

```sh
npm install @ayme-dev/webmcp @ayme-dev/webmcp-vue
npm install -D @ayme-dev/unplugin-webmcp @playwright/test@~1.62.1
```

Packages are not published yet; use supplied tarballs before release.
Configure the [Vite plugin](https://github.com/ayme-labs/ayme/blob/main/packages/unplugin-webmcp/README.md)
alongside `@vitejs/plugin-vue`, and annotate your POM as shown in the
[core README](https://github.com/ayme-labs/ayme/blob/main/packages/webmcp/README.md).

## Vite setup

```ts
import vue from "@vitejs/plugin-vue";
import { aymeWebMcp } from "@ayme-dev/unplugin-webmcp/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue(), aymeWebMcp({ publish: true })],
});
```

Keep decorated Page Object Models in separate `.ts` files with `experimentalDecorators` enabled. Use `@WebMCP` on the model and `@WebMCP.tool(...)` on exposed actions, as shown in [ListPage](../../apps/example-vue/playwright/pom/ListPage.ts).

Publication is disabled unless enabled by the Vite plugin. Local Page Object calls remain available without publication or a WebMCP driver.

## Provider setup

```vue
<script setup lang="ts">
import { AymeWebMcpProvider } from "@ayme-dev/webmcp-vue";
import App from "./App.vue";
</script>

<template>
  <AymeWebMcpProvider><App /></AymeWebMcpProvider>
</template>
```

In the browser, the provider creates a Page for the current document. To supply a custom or decorated Page, pass a factory, `:page="() => customPage"`; the runtime calls it once, in the browser, on first use, and never during server rendering. `createPage(options)` from `@ayme-dev/webmcp` builds the default Page with your own settings. Keep the factory fixed while mounted; remount the provider and its consumers to change it. Wrappers must preserve the browser adapter's locator metadata for Ayme observation. Playwright `Page` type compatibility alone does not guarantee observation support.

Pass `:ignore="ignorePageState"` to keep matching elements and their descendants out of the Structural Page State:

```ts
const ignorePageState = (element: Element) =>
  element.matches("[data-assistant-panel]");
```

The same option is available to standalone setup as `useAymeWebMcp({ ignore })`. When the predicate returns `true`, the matching subtree is dropped from page state capture. This affects page state only; it does not change which tools are published. Keep the predicate fixed while its runtime owner is mounted.

Hooks in `App` and its descendants consume the provider:

```ts
import { useAymeWebMcp, usePageObject } from "@ayme-dev/webmcp-vue";
import { ListPage } from "./playwright/pom/ListPage";

const pom = usePageObject(ListPage);
const { publicationStatus, retryPublication } = useAymeWebMcp();

// Later, in an event handler:
await pom.addItem("Write release notes");
```

The status is a read-only Vue ref: read `publicationStatus.value.state` in script, or `publicationStatus.state` in templates. States are `disabled`, `waiting`, `active`, `unavailable`, `failed`, and `disposed`. Enabled publication waits up to two seconds for a driver. `retryPublication()` retries after unavailability or failure; it shares pending attempts and does not duplicate active publication.

## Standalone composable compatibility

Existing root setup continues to work:

```ts
const { publicationStatus, retryPublication } = useAymeWebMcp({
  page: () => customPage,
});
const pom = usePageObject(ListPage);
```

Omit the options to use the default Page. In the browser, the standalone owner starts immediately in the Vue scope and provides its runtime to descendant components. It also continues to support `effectScope()` usage and Page Object registration in the owner's own setup.

| Call                                                | Behavior                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| `useAymeWebMcp()` beneath an owner                  | Consume its status and retry; do not start or dispose another runtime |
| `useAymeWebMcp()` without an ancestor owner         | Start and own the default runtime in the current scope                |
| `useAymeWebMcp({ page })` without an ancestor owner | Start and own the supplied Page's runtime                             |
| `useAymeWebMcp({ page })` beneath an owner          | Throw; configure the Page on the ancestor owner                       |

Ancestor lookup follows the component tree. It does not find a provider rendered below the calling component, or automatically share a runtime between unrelated `effectScope()` calls. Call standalone root setup once in its scope. A second active owner is rejected, including nested providers. Only the creator disposes the runtime. Descendant consumer cleanup removes its own subscriptions and Page Object registrations.

In the browser, `usePageObject(Model)` returns the concrete instance and disposes its registration with its Vue scope. Constructors should only initialize fields and compose locators; invoke actions later. A remount creates a new instance. The hooks require an active Vue effect scope.

## Server rendering and Nuxt

The provider and composables can run during Vue server rendering. They do not construct Page Objects, start the browser runtime, observe the DOM, or publish tools on the server. Each render creates its own inert runtime session; no live browser registration is shared between requests.

On the server, `usePageObject(Model)` returns an unconstructed object with the model's prototype. This allows rendering to reference prototype methods in event closures without running the constructor. Do not read locators or constructor-initialized fields, or execute POM actions, during server rendering. A custom `page` factory runs only in the browser; server rendering never calls it.

Browser setup constructs and registers the real Page Object during hydration. Existing browser ownership, `effectScope()` support, and disposal behavior are unchanged. No client-only wrapper is needed around the application UI.

The Vite plugin skips its POM source transform for SSR while retaining shared build configuration. Keep publication settings consistent between server and browser builds: the initial status is `waiting` when publication is enabled and `disabled` otherwise. Only the browser attempts publication.

The [Nuxt example](../../apps/example-nuxt) shows the existing Vue provider and Vite plugin in an SSR app, including configuration for the built runtime packages and the POM TypeScript project. Its tests run against both Nuxt development and the production Node server. This prototype does not certify Nuxt islands, edge deployment, prerendering, or server-side POM execution.

## Framework parity and example

React has the same provider and Page Object/status/retry names. React requires an ancestor provider; it does not support Vue's standalone startup composable. React status is a plain snapshot instead of a Vue ref.

The [Vue example](../../apps/example-vue) retains standalone setup and external demo feedback. From the workspace root, run `pnpm run build`, then `pnpm --filter @ayme-dev/example-vue dev`. Provider and standalone compatibility are checked by this package's tests.

Register each root POM in the component that owns its lifetime. Child POMs in compiled member metadata are discovered recursively; action return values do not register independent roots.

For Chrome or a coding agent connection, follow the skill's
[browser setup reference](https://github.com/ayme-labs/ayme/blob/main/skills/ayme/references/browser-setup.md).

## Coding agent skill

> Install the `ayme` skill from https://github.com/ayme-labs/ayme/tree/main/skills/ayme into this project's skill directory, including its references. Then use it to set up Ayme WebMCP here.
