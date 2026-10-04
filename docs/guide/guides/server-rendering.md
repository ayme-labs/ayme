# Server rendering

What Ayme does on the server and in the browser when your app renders on the server with Next.js, Nuxt, SvelteKit or Angular SSR.

## What runs where

Ayme runs only in the browser. Your app keeps rendering on the server as it did, and the framework packages keep that safe:

- Each server render gets its own inert session. It never starts, never calls `pageFactory`, observes no DOM and publishes nothing.
- `usePageObject`, or `injectPageObject` in Angular, returns an unconstructed object with the model's prototype and registers nothing, so markup can reference its methods in event handlers. Do not read its locators or constructor-initialized fields, or run its actions, while rendering on the server.
- The publication status starts as `waiting` when publication is enabled and `disabled` otherwise, on the server and in the browser, so the hydrated markup matches.
- `ayme.tools.list()` is empty on the server, and `ayme.tools.run` throws.
- The build plugin compiles Page Object Models into the browser build only.

After hydration, the root owner starts the session in the browser, constructs and registers the real Page Objects, and publishes. No client-only wrapper is needed around your UI.

## Next.js

Use `@ayme-dev/react` with the build plugin's [Turbopack loader](../reference/build-plugin.md#nextjs). In the App Router, put `AymeProvider` and the components that call its hooks in a `"use client"` module. The provider renders on the server, and the session starts in its effect after hydration. The [Next.js example](../../../apps/example-next/README.md) shows the setup. See [React](../frameworks/react.md).

## Nuxt

Use `@ayme-dev/vue`'s `AymeProvider` with the Vite plugin. The [Nuxt example](../../../apps/example-nuxt/README.md) shows the configuration, including the Page Object Models' TypeScript project. See [Vue](../frameworks/vue.md).

## SvelteKit

Use `@ayme-dev/svelte` with the Vite plugin. `useAyme` in the root `+layout.svelte` creates each render's session through Svelte context, so nothing sits at module scope. SvelteKit's SPA mode, `export const ssr = false` in the root `+layout.ts`, needs no change. See [Svelte](../frameworks/svelte.md).

## Angular SSR

Use `@ayme-dev/angular` with the Angular builder's SSR. On the server, `provideAyme` creates a session per request but never starts it. See [Angular](../frameworks/angular.md).
