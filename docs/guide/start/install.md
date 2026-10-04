# Install

Which packages to install for your framework, with which commands, and which versions of each framework, Node.js, Playwright and TypeScript Ayme supports.

## Packages

| Package                                                                       | Install as     | For                                                                    |
| ----------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------- |
| `@ayme-dev/ayme`                                                              | dependency     | The decorators and the runtime. Every app needs it.                    |
| `@ayme-dev/vue`, `@ayme-dev/react`, `@ayme-dev/svelte` or `@ayme-dev/angular` | dependency     | Starting Ayme at your app's root and using Page Objects in components. |
| `@ayme-dev/unplugin-ayme`                                                     | dev dependency | Compiling your Page Object Models into the browser build.              |
| `@playwright/test`                                                            | dev dependency | The `Page` and `Locator` types your Page Object Models use.            |
| `@ayme-dev/inspector`                                                         | dev dependency | The optional in-page [Inspector](../guides/inspector.md).              |

## Commands

Vue, React and Svelte, with your framework's package in place of `@ayme-dev/vue`:

```sh
npm install @ayme-dev/ayme @ayme-dev/vue
npm install -D @ayme-dev/unplugin-ayme @playwright/test
```

```sh
pnpm add @ayme-dev/ayme @ayme-dev/vue
pnpm add -D @ayme-dev/unplugin-ayme @playwright/test
```

```sh
yarn add @ayme-dev/ayme @ayme-dev/vue
yarn add -D @ayme-dev/unplugin-ayme @playwright/test
```

Angular installs everything, configures the build and adds `provideAyme()` in one step:

```sh
ng add @ayme-dev/angular
```

Then follow the quickstart for your framework: [Vue](quickstart-vue.md), [React](quickstart-react.md), [Svelte](quickstart-svelte.md) or [Angular](quickstart-angular.md).

## Supported versions

CI tests each lower bound together with the current release, except the
TypeScript floor, which comes from a one-time check.
These are compatibility floors, not security advice: follow each framework's
own support policy for which releases still receive fixes.

| Dependency         | Supported                                | Notes                                                                                                                                                                              |
| ------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React              | 18.0 and 19                              | Client rendering, server rendering and hydration.                                                                                                                                  |
| Vue                | 3.2.0 and later                          | With TypeScript and `skipLibCheck: false`, Vue 3.2.0 to 3.2.38 report errors inside Vue's own declarations; use 3.2.39 or later, or `skipLibCheck: true`.                          |
| Svelte             | 3.54 and later, 4 and 5                  |                                                                                                                                                                                    |
| Angular            | 19 to 22                                 | Standalone applications; see the [Angular page](../frameworks/angular.md#limits).                                                                                                  |
| Next.js            | 16.0 and later                           | With the experimental Turbopack loader, as in the [Next.js example](../../../apps/example-next/README.md). Next.js 15 and webpack are not supported.                               |
| Nuxt               | 4.0.1 and later                          | With the Vite plugin, as in the [Nuxt example](../../../apps/example-nuxt/README.md). Nuxt 3 is not supported.                                                                     |
| Vite               | 7 and 8                                  | The plugin is ESM-only, so the config must be loaded as ESM.                                                                                                                       |
| Node.js            | 20.19 and later 20.x, or 22.12 and later | Nuxt 4.4.6 and later need Node.js 22.12, and Nuxt 4.5 needs 22.19, so a current Nuxt release needs Node.js 22.                                                                     |
| `@playwright/test` | 1.29 to 1.62                             | Optional; see [Playwright in the browser](../reference/playwright-in-the-browser.md).                                                                                              |
| TypeScript         | 5.4 and later                            | 5.0 to 5.3 work with `skipLibCheck: true`. This is the version your project compiles with; the plugin brings its own compiler. Playwright 1.29's declarations need TypeScript 5.x. |

The Next.js and Nuxt rows cover the behavior the examples test: server
rendering, hydration, tool publication, Page Object actions, removal and
remounting, in development and production.
