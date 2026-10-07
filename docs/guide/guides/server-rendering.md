# Server rendering

What Ayme does on the server and in the browser when your app renders on the server with Next.js, Nuxt, SvelteKit or Angular SSR.

## What runs where

Ayme runs only in the browser. Your app keeps rendering on the server as it did, and Ayme keeps that safe:

- Each server render gets its own inert session. It never starts, never calls `pageFactory`, observes no DOM and publishes nothing.
- `usePageObject`, or `injectPageObject` in Angular, returns an unconstructed object with the model's prototype and registers nothing, so markup can reference its methods in event handlers. Do not read its locators or constructor-initialized fields, or run its actions, while rendering on the server.
- The publication status starts as `waiting` when publication is enabled and `disabled` otherwise, on the server and in the browser, so the hydrated markup matches.
- `ayme.tools.list()` is empty on the server, and `ayme.tools.run` throws.
- The build plugin compiles Page Object Models into the browser build only.

After hydration, the root owner starts the session in the browser, constructs and registers the real Page Objects, and publishes. No client-only wrapper is needed around your UI.

## Per framework

Each framework page has a server-rendering example: [Next.js on React](../frameworks/react.md#server-rendering), [Nuxt on Vue](../frameworks/vue.md#server-rendering), [SvelteKit](../frameworks/svelte.md#server-rendering) and [Angular SSR](../frameworks/angular.md#server-rendering).
