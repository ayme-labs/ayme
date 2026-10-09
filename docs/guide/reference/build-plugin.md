# Build plugin

The options of `@ayme-dev/unplugin-ayme`, which compiles your Page Object Models and their tool schemas into the browser build, and how its Playwright settings resolve.

## Entries

| Entry                                      | For                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `@ayme-dev/unplugin-ayme/vite`             | Vite 7 and 8, including Nuxt and SvelteKit. ESM-only, so the config must load as ESM. |
| `@ayme-dev/unplugin-ayme/angular`          | The Angular CLI's application builder, through `@angular-builders/custom-esbuild`.    |
| `@ayme-dev/unplugin-ayme/turbopack-loader` | Next.js 16 with Turbopack. Experimental.                                              |

The plugin runs on Node.js 20.19 and later 20.x, or 22.12 and later. It compiles Page Object Models with its own TypeScript dependency, whichever TypeScript version your project uses.

It has no publication or Inspector setting: you turn both on where Ayme starts in your app. Turning publication off does not remove Page Object Model code from the bundle.

## What it compiles

The plugin compiles the `.ts` files that mark a Page Object Model with `@ayme`, and the files that extend one. Enable `compilerOptions.experimentalDecorators` in their tsconfig, and import them from the application so the bundler transforms them.

A class that extends an `@ayme` class is a Page Object Model too, even in a file without the decorator. The plugin checks such a file when it contains `extends` and imports, directly or through re-exports, a file containing `@ayme`. Imports resolve with the tsconfig's module resolution, and external packages are skipped: a subclass whose base is reached only through an import that resolution cannot follow is not recognised. If a bundler rule filters files by content before they reach the plugin, such as a Turbopack rule with a `content` condition, match `/@ayme|extends/` rather than `/@ayme/`.

## Vite

```ts
import { defineConfig } from "vite";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";

export default defineConfig({
  plugins: [ayme()],
});
```

Add it alongside your framework's plugin. It skips its source transform for server rendering and compiles only the browser build.

| Option         | Type     | Meaning                                                                                                                                                                                                                                                                                                                                                  |
| -------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsconfigPath` | `string` | The tsconfig the compiler reads. A relative path resolves from the working directory. Defaults to the nearest `tsconfig.json` above each Page Object Model. When the tsconfig is solution-style (`"files": []` plus `references`, as in Vite's templates), the compiler follows its references to the project that includes the model, as `tsc -b` does. |
| `playwright`   | `object` | The Playwright settings the browser adapter uses; see [Playwright settings](#playwright-settings).                                                                                                                                                                                                                                                       |

On Vite 8, whose oxc transform does not always read the tsconfig, the plugin also sets `oxc: { decorator: { legacy: true } }`. It leaves the option alone when your config sets `oxc.decorator.legacy`, sets `oxc: false`, or sets `esbuild` options without `oxc`.

## Angular

`ng add @ayme-dev/angular` sets the plugin up. The standard builder, `@angular/build:application`, has no plugin option, so the plugin needs `@angular-builders/custom-esbuild` in the same major as Angular, which replaces the application and dev-server builders and passes plugins to Angular's build. custom-esbuild loads plugins by workspace file path only, so the plugin is a one-line file referenced from `angular.json`:

```js
// ayme.plugin.mjs
export { default } from "@ayme-dev/unplugin-ayme/angular";
```

```jsonc
"plugins": [{ "path": "./ayme.plugin.mjs", "options": { "tsconfigPath": "tsconfig.app.json" } }]
```

Reference it in this object form only: custom-esbuild calls a plain string entry with the builder's options, which the plugin rejects. Its one option, `tsconfigPath`, is the tsconfig the compiler reads, resolved from the workspace root. Point it at the app's own tsconfig, which Angular's watcher also reads, so editing a type a Page Object Model imports updates its schema during `ng serve`. Unknown options and a non-string `tsconfigPath` throw a `TypeError`.

The plugin compiles Page Object Models imported with relative paths or through tsconfig `paths`, skips modules under `node_modules`, and leaves every other module, including Angular components, to Angular's compiler. It compiles only the browser bundles; the server bundles keep Angular's own output. It sets no Playwright settings: pass them through `provideAyme({ pageFactory })`.

## Next.js

`@ayme-dev/unplugin-ayme/turbopack-loader` is an experimental loader for Turbopack's browser graph. Its one option is `tsconfigPath`, the tsconfig the compiler reads. Apply it to the `.ts` files on the browser graph that contain `@ayme` or `extends`:

```js
// next.config.mjs
import { fileURLToPath } from "node:url";

export default {
  turbopack: {
    rules: {
      "*.ts": {
        condition: {
          all: ["browser", { not: "foreign" }, { content: /@ayme|extends/ }],
        },
        loaders: [
          {
            loader: "@ayme-dev/unplugin-ayme/turbopack-loader",
            options: {
              tsconfigPath: fileURLToPath(
                new URL("./tsconfig.json", import.meta.url)
              ),
            },
          },
        ],
        as: "*.js",
      },
    },
  },
};
```

The loader reports the tsconfig and source files the compiler read, so Turbopack recompiles a Page Object Model when a type it imports changes. A bundler without loader dependency tracking makes it fail rather than serve a stale schema. Next.js 15 and webpack are not supported.

## Playwright settings

The Vite plugin accepts the small part of Playwright's configuration that the browser adapter uses:

```ts
ayme({
  playwright: {
    config: "./playwright.config.ts",
    project: "chromium",
    use: {
      testIdAttribute: "data-testid",
      actionTimeout: 10_000,
      navigationTimeout: 30_000,
    },
  },
});
```

`config` is optional. Without it, Ayme does not search for a Playwright config or import Playwright's config loader, and the values come from `use` and the adapter defaults. A relative config path resolves against Vite's root.

With a config, Ayme loads it through the config loader of your Playwright 1.62.x, reached through the `playwright` dependency of `@playwright/test`. That loader is a private Playwright module, so other versions fail with an explicit compatibility error. Ayme reads only `testIdAttribute`, `actionTimeout` and `navigationTimeout`; no other config field enters the browser bundle.

Without `project`, a config with no projects uses its top-level `use` values, a single project is selected automatically, and several projects must agree on all three values. If they do not, set `project` to the name of exactly one project.

Each field resolves on its own. `use` wins over the selected project, then the top-level config, then the adapter default: 1,000 ms for actions and 30,000 ms for navigation. An `undefined` value does not erase an inherited one. Navigation has its own default and does not follow `actionTimeout`; set `navigationTimeout` to change it. The timeouts apply to the page the runtime creates, which Page Object Models and Browser Tools act on. A timeout passed to a single call, and later `setDefaultTimeout` or `setDefaultNavigationTimeout` calls, still win, and `0` means no timeout.

## Errors

These fail the build or the dev server.

| Message                                                                                                                                                | When                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `Unsupported Page Object Tool input type for <Model>.<method>(<parameter>): <type>. Compiled with <tsconfig>.`                                         | A parameter type the compiler cannot turn into a schema; see [Page Object Models](../guides/page-object-models.md). |
| `Page Object Action <Model>.<method> needs identifier parameter names.`                                                                                | A destructured parameter.                                                                                           |
| `Page Object Child "<member>" is ambiguous: <classes>.`                                                                                                | A member's type intersects several Page Object Models.                                                              |
| `Could not find a tsconfig.json for POM source <file>.`                                                                                                | No tsconfig above the model and no `tsconfigPath`.                                                                  |
| `Could not read TypeScript project configuration <path>: …`                                                                                            | The tsconfig the compiler found has errors.                                                                         |
| `Could not read POM source <file>.`                                                                                                                    | The model's file could not be read.                                                                                 |
| `A Page Object Model needs a class name.`, `Page Object Action in <Model> needs an identifier method name.`                                            | An anonymous class, or an action with a computed name.                                                              |
| `Could not transpile Ayme POM <file>: …`                                                                                                               | TypeScript could not compile the model.                                                                             |
| `playwright contains unsupported option(s): …`, `playwright.config must be a non-empty string`, and the other `playwright` option checks (`TypeError`) | A malformed `playwright` option; see [Playwright settings](#playwright-settings).                                   |
| `playwright.project requires an explicit playwright.config path` (`TypeError`)                                                                         | `project` without `config`.                                                                                         |
| `Could not load Playwright config "<path>": …`                                                                                                         | The config file is missing or failed to load.                                                                       |
| `Unsupported Playwright config loader …`                                                                                                               | Loading a config needs Playwright 1.62; the installed loader has another version or shape.                          |
| `Playwright project "<name>" must exist exactly once in <path>; found <count>.`                                                                        | `project` names no project, or several.                                                                             |
| `Playwright projects have different supported settings (<fields>); set playwright.project explicitly.`                                                 | Several projects disagree and no `project` was set.                                                                 |
| `Ayme's Angular plugin has no option(s): …` (`TypeError`)                                                                                              | An unknown Angular plugin option, or the plugin referenced as a plain string.                                       |
| `Ayme did not compile Page Object Model <file>.`                                                                                                       | The Angular plugin could not compile a model it claimed.                                                            |
| `tsconfigPath must be a string` (`TypeError`)                                                                                                          | A non-string Angular `tsconfigPath`.                                                                                |
| `Ayme's Turbopack loader requires loader dependency tracking.`                                                                                         | The bundler running the loader cannot track dependencies.                                                           |
