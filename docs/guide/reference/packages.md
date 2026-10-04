# Packages

Each package Ayme publishes, what it owns, and which ones you install.

| Package                   | Owns                                                                                                                                                                      | Install                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `@ayme-dev/ayme`          | The decorators, the runtime and `createAyme`, `@ayme-dev/ayme/server` for the Decision Endpoint, and `@ayme-dev/ayme/testing` for tests. See [`@ayme-dev/ayme`](ayme.md). | Always                        |
| `@ayme-dev/vue`           | Starting Ayme in a Vue app and Page Objects in components. See [Vue](../frameworks/vue.md).                                                                               | Vue, Nuxt                     |
| `@ayme-dev/react`         | Starting Ayme in a React app and Page Objects in components. See [React](../frameworks/react.md).                                                                         | React, Next.js                |
| `@ayme-dev/svelte`        | Starting Ayme in a Svelte app and Page Objects in components. See [Svelte](../frameworks/svelte.md).                                                                      | Svelte, SvelteKit             |
| `@ayme-dev/angular`       | `ng add`, starting Ayme in an Angular app and Page Objects in components. See [Angular](../frameworks/angular.md).                                                        | Angular                       |
| `@ayme-dev/unplugin-ayme` | Compiling Page Object Models and their tool schemas into the browser build, for Vite, the Angular CLI and Turbopack. See [Build plugin](build-plugin.md).                 | Always, as a dev dependency   |
| `@ayme-dev/inspector`     | The in-page panel. See [Inspector](../guides/inspector.md).                                                                                                               | Optional, as a dev dependency |

`@ayme-dev/ayme` bundles what it needs from Ayme's internal packages and from playwright-lite, so you never install those. `@playwright/test` is not an Ayme package; install it as a dev dependency for the `Page` and `Locator` types. Keep all Ayme packages on the same version.
