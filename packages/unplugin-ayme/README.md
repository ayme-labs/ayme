# @ayme-dev/unplugin-ayme

Compile annotated TypeScript POMs and their tool schemas into the browser build.
The documented consumer integrations are Vite and the Angular CLI.

It runs on Node.js 20.19 and later 20.x, or 22.12 and later, and supports
Vite 7 and 8. The Vite entry is ESM-only, so the config must be loaded as ESM.
The plugin compiles POMs with its own TypeScript dependency, independent of the
TypeScript version your project uses.

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
On Vite 8, whose oxc transform does not always read that tsconfig, the plugin
also sets `oxc: { decorator: { legacy: true } }`. It leaves the option alone
when your config sets `oxc.decorator.legacy`, sets `oxc: false`, or sets
`esbuild` options without `oxc`.
Import the annotated `.ts` files from the application so Vite transforms them.

## Angular setup

The `angular` entry is an esbuild code plugin for the Angular CLI's application
builder. Prefer `ng add @ayme-dev/angular`, which sets it up; the
[Angular README](https://github.com/ayme-labs/ayme/blob/main/packages/angular/README.md)
lists the manual steps.

The standard builder, `@angular/build:application`, has no plugin option, so
the plugin needs `@angular-builders/custom-esbuild` in the same major as
Angular, which replaces the application and dev-server builders and passes
plugins to Angular's build. custom-esbuild loads plugins by workspace file path
only, so add a one-line plugin file and reference it from `angular.json`:

```js
// ayme.plugin.mjs
export { default } from "@ayme-dev/unplugin-ayme/angular";
```

```jsonc
"plugins": [{ "path": "./ayme.plugin.mjs", "options": { "tsconfigPath": "tsconfig.app.json" } }]
```

Reference the plugin in this object form only: custom-esbuild calls a plain
string entry with the builder's options, which the plugin rejects. Its one
option, `tsconfigPath`, is the tsconfig the compiler reads, resolved
from the workspace root. Point it at the app's own tsconfig, which Angular's
watcher also reads, so editing a type a Page Object Model imports updates its
schema during `ng serve`. Unknown options and a non-string `tsconfigPath`
throw a `TypeError`.

The plugin compiles Page Object Models imported with relative paths or through
tsconfig `paths`, skips modules under `node_modules`, and leaves every other
module, including Angular components, to Angular's compiler. It compiles only
the browser bundles; the server bundles keep Angular's own output. Like the
Vite plugin it has no publication setting, and it sets no build constants: pass
Playwright settings through `provideAyme({ pageFactory })`.

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
