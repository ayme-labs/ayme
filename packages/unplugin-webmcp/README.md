# @ayme-dev/unplugin-webmcp

Compile annotated TypeScript POMs and their tool schemas into the browser build.
The documented consumer integration is Vite.

## Vite setup

Install this package as a development dependency alongside
[the core package](https://github.com/ayme-labs/ayme/blob/main/packages/webmcp/README.md).
Add the plugin alongside your existing framework plugins:

```ts
import { defineConfig } from "vite";
import { aymeWebMcp } from "@ayme-dev/unplugin-webmcp/vite";

export default defineConfig(({ command }) => ({
  plugins: [aymeWebMcp({ publish: command === "serve" })],
}));
```

This example enables publication for the dev server only. `publish` defaults
to false and controls publication, not runtime startup. Start the runtime using
your framework integration. Disabling publication does not strip POM code from
the bundle; production removal is not covered by this setup.

Enable `compilerOptions.experimentalDecorators: true` in the POMs' tsconfig.
Import the annotated `.ts` files from the application so Vite transforms them.

## Page Object Model subclasses

A class that extends a `@WebMCP` class is a Page Object Model too, even in a file
without the decorator. The compiler checks such a file when it contains
`extends` and imports, directly or through re-exports, a file containing
`@WebMCP`. Imports are resolved with the tsconfig's module resolution, and
external packages are skipped: a subclass whose base is reached only through an
import that resolution cannot follow is not recognised.

If your bundler rule filters files by content before they reach Ayme, such as
a Turbopack rule with a `content` condition, it must not exclude files that
extend a Page Object Model. Match `/@WebMCP|extends/` rather than `/@WebMCP/`.

## Playwright settings

An existing Playwright config is optional and is only loaded when explicitly
supplied:

```ts
aymeWebMcp({
  publish: true,
  playwright: {
    config: "./playwright.config.ts",
    project: "chromium",
  },
});
```

Config loading supports Playwright 1.62.x. See
[Playwright settings](https://github.com/ayme-labs/ayme#playwright-settings)
for selection, overrides, and supported fields.

## Coding agent skill

> Install the `ayme` skill from https://github.com/ayme-labs/ayme/tree/main/skills/ayme into this project's skill directory, including its references. Then use it to set up Ayme WebMCP here.
