# @ayme-dev/unplugin-ayme

The build plugin for [Ayme](https://github.com/ayme-labs/ayme): it compiles your Page Object Models and their tool schemas into the browser build.

## Install

```sh
npm install -D @ayme-dev/unplugin-ayme @playwright/test
```

## Setup

On Vite, add the plugin alongside your framework's plugin:

```ts
import { defineConfig } from "vite";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";

export default defineConfig({
  plugins: [ayme()],
});
```

Enable `compilerOptions.experimentalDecorators` in your Page Object Models' tsconfig, and import them from the application. On Angular, `ng add @ayme-dev/angular` sets the plugin up. On Next.js, the Turbopack loader compiles them.

## Production builds

A build that neither publishes tools nor calls Page Objects from your own code can ship none of Ayme: with `ayme({ remove: true })`, the runtime, the Inspector and WebMCP stay out of the output, and each Page Object Model compiles to a stand-in of the same name whose actions reject with an error naming them. Without it, a production build carries the runtime and every Page Object Model the app imports, whether or not publication is on. The [build plugin reference](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/build-plugin.md#remove-ayme-from-a-build) states what the option guarantees, what it does not, and how to set it per bundler.

## Documentation

- [Build plugin reference](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/build-plugin.md): the Vite, Angular and Next.js entries, their options and the Playwright settings.
- [Playwright in the browser](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/playwright-in-the-browser.md): which Playwright calls a Page Object Model can make.
- [Ayme documentation](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md)

## Supported versions

Node.js 20.19 and later 20.x, or 22.12 and later; Vite 7 and 8; Angular 19 to 22 through `@angular-builders/custom-esbuild`; Next.js 16.0 and later with Turbopack. The plugin brings its own TypeScript compiler. Loading a Playwright config needs `@playwright/test` 1.62 to 1.64.

## License

[FSL-1.1-ALv2](https://github.com/ayme-labs/ayme/blob/main/LICENSE)
