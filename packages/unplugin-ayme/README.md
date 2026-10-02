# @ayme-dev/unplugin-ayme

Compile annotated TypeScript POMs and their tool schemas into the browser build.
The documented consumer integration is Vite.

## Vite setup

Install this package as a development dependency alongside
[the main library](https://github.com/ayme-labs/ayme/blob/main/packages/ayme/README.md).
Add the plugin alongside your existing framework plugins:

```ts
import { defineConfig } from "vite";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";

export default defineConfig({
  plugins: [ayme()],
});
```

The plugin compiles Page Object Models and, with `inspector: true`, injects
the Inspector. It has no publication setting: start the runtime and turn WebMCP
publication on with `webMCP.enabled` in your framework integration's `useAyme`
or `AymeProvider`. Turning publication off does not strip POM code from the
bundle; production removal is not covered by this setup.

Enable `compilerOptions.experimentalDecorators: true` in the POMs' tsconfig.
Import the annotated `.ts` files from the application so Vite transforms them.

## Page Object Model subclasses

A class that extends an `@ayme` class is a Page Object Model too, even in a file
without the decorator. The compiler checks such a file when it contains
`extends` and imports, directly or through re-exports, a file containing
`@ayme`. Imports are resolved with the tsconfig's module resolution, and
external packages are skipped: a subclass whose base is reached only through an
import that resolution cannot follow is not recognised.

If your bundler rule filters files by content before they reach Ayme, such as
a Turbopack rule with a `content` condition, it must not exclude files that
extend a Page Object Model. Match `/@ayme|extends/` rather than `/@ayme/`.

## Playwright settings

An existing Playwright config is optional and is only loaded when explicitly
supplied:

```ts
ayme({
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
