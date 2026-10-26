# Build plugin

The options of `@ayme-dev/unplugin-ayme`, which compiles your Page Object Models and their tool schemas into the browser build, and how its Playwright settings resolve.

## Entries

| Entry                                      | For                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `@ayme-dev/unplugin-ayme/vite`             | Vite 7 and 8, including Nuxt and SvelteKit. ESM-only, so the config must load as ESM. |
| `@ayme-dev/unplugin-ayme/angular`          | The Angular CLI's application builder, through `@angular-builders/custom-esbuild`.    |
| `@ayme-dev/unplugin-ayme/turbopack-loader` | Next.js 16 with Turbopack.                                                            |

The plugin runs on Node.js 20.19 and later 20.x, or 22.12 and later. It compiles Page Object Models with its own TypeScript dependency, whichever TypeScript version your project uses.

It has no publication or Inspector setting: you turn both on where Ayme starts in your app. Turning publication off does not remove Page Object Model code from the bundle: whether a build has Ayme in it at all is the `include` option, false by default, as [Include Ayme in a build](#include-ayme-in-a-build) describes.

## What it compiles

The plugin compiles the `.ts` files that mark a Page Object Model with `@ayme`, and the files that extend one. Enable `compilerOptions.experimentalDecorators` in their tsconfig, and import them from the application so the bundler transforms them.

A class that extends an `@ayme` class is a Page Object Model too, even in a file without the decorator. The plugin checks such a file when it contains `extends` and imports, directly or through re-exports, a file containing `@ayme`. Imports resolve with the tsconfig's module resolution, and external packages are skipped: a subclass whose base is reached only through an import that resolution cannot follow is not recognised. If a bundler rule filters files by content before they reach the plugin, such as a Turbopack rule with a `content` condition, match `/@ayme|extends/` rather than `/@ayme/`.

## Vite

```ts
import { defineConfig } from "vite";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";

export default defineConfig(({ command }) => ({
  plugins: [ayme({ include: command === "serve" })],
}));
```

Add it alongside your framework's plugin. `include` keeps Ayme in the dev server and out of `vite build`; [Include Ayme in a build](#include-ayme-in-a-build) covers the builds that keep it. It skips its source transform for server rendering and compiles only the browser build.

| Option         | Type                               | Meaning                                                                                                                                                                                                                                                                                                                                                  |
| -------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `include`      | `boolean`                          | Whether the build includes Ayme. Defaults to `false`, a build without Ayme; see [Include Ayme in a build](#include-ayme-in-a-build).                                                                                                                                                                                                                     |
| `tsconfigPath` | `string`                           | The tsconfig the compiler reads. A relative path resolves from the working directory. Defaults to the nearest `tsconfig.json` above each Page Object Model. When the tsconfig is solution-style (`"files": []` plus `references`, as in Vite's templates), the compiler follows its references to the project that includes the model, as `tsc -b` does. |
| `playwright`   | `object`                           | The Playwright settings the browser adapter uses; see [Playwright settings](#playwright-settings).                                                                                                                                                                                                                                                       |
| `report`       | `"none" \| "unsupported" \| "all"` | Which methods that are not tools a build lists when it ends; see [Report](#report). Defaults to `"unsupported"`.                                                                                                                                                                                                                                         |

On Vite 8, whose oxc transform does not always read the tsconfig, the plugin also sets `oxc: { decorator: { legacy: true } }`. It leaves the option alone when your config sets `oxc.decorator.legacy`, sets `oxc: false`, or sets `esbuild` options without `oxc`.

### Report

At the end of a `vite build`, the plugin prints the public methods of your Page Object Models and their Page Object Children that are not Page Object Actions, one line each with the reason:

```text
[ayme] Page Object methods that are not tools:
  RunCard.run: no @ayme.action mark, and a parameter is destructured
  SchedulePage.pick: no @ayme.action mark, and parameter at has the unsupported type Date
  SchedulePage.row: no @ayme.action mark
```

With the default `"unsupported"`, it lists only the methods that could not become tools as they are, because a parameter has no schema. `"all"` also lists unmarked methods whose parameters have one, and `"none"` prints nothing. Methods that are Page Object Children are never listed. An action whose parameter has no schema fails the build instead.

## Angular

`ng add @ayme-dev/angular` sets the plugin up. The standard builder, `@angular/build:application`, has no plugin option, so the plugin needs `@angular-builders/custom-esbuild` in the same major as Angular, which replaces the application and dev-server builders and passes plugins to Angular's build. custom-esbuild loads plugins by workspace file path only, so the plugin is a one-line file referenced from `angular.json`:

```js
// ayme.plugin.mjs
export { default } from "@ayme-dev/unplugin-ayme/angular";
```

```jsonc
"options": {
  "plugins": [{ "path": "./ayme.plugin.mjs", "options": { "tsconfigPath": "tsconfig.app.json" } }]
},
"configurations": {
  "development": {
    "plugins": [{ "path": "./ayme.plugin.mjs", "options": { "tsconfigPath": "tsconfig.app.json", "include": true } }]
  }
}
```

Reference it in this object form only: custom-esbuild calls a plain string entry with the builder's options, which the plugin rejects. `tsconfigPath` is the tsconfig the compiler reads, resolved from the workspace root. Point it at the app's own tsconfig, which Angular's watcher also reads, so editing a type a Page Object Model imports updates its schema during `ng serve`. `include` is whether the build includes Ayme, false by default: the entry under the build target's `options` leaves it out, so `ng build` is a build without Ayme, and the development configuration's entry, which `ng serve` uses, sets it. A configuration's `plugins` array replaces the option's, so the development entry repeats `tsconfigPath`. [Include Ayme in a build](#include-ayme-in-a-build) covers the other configurations. Unknown options, a non-string `tsconfigPath` and a non-boolean `include` throw a `TypeError`.

The plugin compiles Page Object Models imported with relative paths or through tsconfig `paths`, skips modules under `node_modules`, and leaves every other module, including Angular components, to Angular's compiler. It compiles only the browser bundles; the server bundles keep Angular's own output. It sets no Playwright settings: pass them through `provideAyme({ pageFactory })`.

## Next.js

`@ayme-dev/unplugin-ayme/turbopack-loader` is a loader for Turbopack's browser graph. Its options are `tsconfigPath`, the tsconfig the compiler reads, and `include`, whether the build includes Ayme, false by default. Apply it to the `.ts` files on the browser graph that contain `@ayme` or `extends`. The config below keeps Ayme in every build; [Include Ayme in a build](#include-ayme-in-a-build) shows the one that keeps it in the dev server only:

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
              include: true,
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

In a `next.config.ts`, put the same `turbopack` block in the config object it exports, next to the options already there.

The loader reports the tsconfig and source files the compiler read, so Turbopack recompiles a Page Object Model when a type it imports changes. A bundler without loader dependency tracking makes it fail rather than serve a stale schema. Next.js 15 and webpack are not supported.

## Include Ayme in a build

`include` is the one setting that decides whether a build has Ayme in it, and it defaults to `false`. Without `include: true`, a build or a dev server is a build without Ayme: `@ayme-dev/ayme` and its internal entry resolve to a small absent entry, which leaves the runtime, Playwright in the browser, the Inspector, WebMCP and the Agent Connection out of the output, and each Page Object Model the plugin compiles becomes a stand-in with the same class name and exports, without the imports only the model used. Everything else in a Page Object Model's module stays. The framework packages leave the build too: `@ayme-dev/vue`, `@ayme-dev/react`, `@ayme-dev/svelte` and `@ayme-dev/angular` resolve to an absent entry of their own, with the same names and types as the package, so a component tree renders as before. `AymeProvider`, `useAyme` and `provideAyme` hand out an inert session whose publication status stays `disabled` and whose tool list is empty, `usePageObject` and `injectPageObject` return the stand-in, an instance of the model's class, and the Peek hook does nothing. An action of a stand-in rejects, and any other member, a Page Object Child, a field or a method, throws, with a `RuntimeStateError` naming it: `Ayme was removed from this build. ProjectsPage.createProject is not in it.`

With `include: true`, the build carries the runtime, with Playwright in the browser, and every Page Object Model the app imports: their Playwright code, the generated schemas and the action descriptions, about 800 to 950 kB raw in a hello-world app, plus the Inspector as a chunk that loads only when it is on. That is the build for development, for a test build that a Playwright suite drives, and for an app that publishes tools in production or drives a Page Object from its own code there, as the quickstarts' "Show me how" button does.

Nothing is inferred from the bundler: Vite treats every `vite build` as production, staging included, and Next.js tells only its dev server from a build, so no mode could say what your team means. A config file is code, and the rule for staging, test or any other mode is the boolean you compute in it. The option is checked on built output, in the plugin's own tests and on the built Vue and Next.js example apps. A value that is not a boolean throws a `TypeError`.

The source maps of a build without Ayme carry the stand-in too, not the model it replaced: each bundler maps a Page Object Model's module to what the plugin hands it, on Vite while loading the module, so no map, inline or in a file, holds the model's locators or descriptions. A build without Ayme guarantees nothing about Page Object Models the plugin does not compile, such as classes under `node_modules` or ones a bundler rule keeps from it, nor about Playwright code the app imports outside a Page Object Model. Turning publication off at runtime removes nothing; `include` is the one way to decide. Every build, and a dev server when it starts, prints one line saying what it decided and why, such as `[ayme] Ayme is not in this build: include is not set.`, so a build log shows it before anything reaches users. On Vite the line comes from the client build, so a SvelteKit or Nuxt build prints it once. On Next.js the Turbopack loader prints it from the first module it compiles, so a build that compiles no Page Object Model prints nothing.

On Vite, keep Ayme in the dev server and out of every `vite build`:

```ts
export default defineConfig(({ command }) => ({
  plugins: [ayme({ include: command === "serve" })],
}));
```

For a staging build that keeps it, decide from the mode instead, so `vite build --mode staging` includes Ayme and `vite build` does not:

```ts
export default defineConfig(({ mode }) => ({
  plugins: [ayme({ include: mode !== "production" })],
}));
```

On Angular, the plugin entry under the build target's `options` has no `include`, so every configuration is a build without Ayme unless it carries its own entry, and the development configuration, which `ng serve` uses, carries one with `"include": true`, as [Angular](#angular) shows and `ng add` writes. A staging configuration that keeps Ayme repeats the development entry:

```jsonc
"configurations": {
  "staging": {
    "plugins": [{ "path": "./ayme.plugin.mjs", "options": { "tsconfigPath": "tsconfig.app.json", "include": true } }]
  }
}
```

On Next.js, the config function computes the boolean from the phase Next passes it. The loader takes `include`, and because a loader cannot alias, `turbopack.resolveAlias` points the runtime's two entries and the framework package at their absent entries for the browser when the build is without Ayme:

```js
// next.config.mjs
import { fileURLToPath } from "node:url";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

export default function nextConfig(phase) {
  const include = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    turbopack: {
      resolveAlias: include
        ? {}
        : {
            "@ayme-dev/ayme": { browser: "@ayme-dev/ayme/absent" },
            "@ayme-dev/ayme/internal": { browser: "@ayme-dev/ayme/absent" },
            "@ayme-dev/react": { browser: "@ayme-dev/react/absent" },
          },
      rules: {
        "*.ts": {
          condition: {
            all: ["browser", { not: "foreign" }, { content: /@ayme|extends/ }],
          },
          loaders: [
            {
              loader: "@ayme-dev/unplugin-ayme/turbopack-loader",
              options: {
                include,
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
}
```

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

With a config, Ayme loads it through the config loader of your Playwright 1.62 to 1.64, reached through the `playwright` dependency of `@playwright/test`. That loader is a private Playwright module, so other versions fail with an explicit compatibility error. Ayme reads only `testIdAttribute`, `actionTimeout` and `navigationTimeout`; no other config field enters the browser bundle.

Without `project`, a config with no projects uses its top-level `use` values, a single project is selected automatically, and several projects must agree on all three values. If they do not, set `project` to the name of exactly one project.

Each field resolves on its own. `use` wins over the selected project, then the top-level config, then the adapter default: 1,000 ms for actions and 30,000 ms for navigation. An `undefined` value does not erase an inherited one. Navigation has its own default and does not follow `actionTimeout`; set `navigationTimeout` to change it. The timeouts apply to the page the runtime creates, which Page Object Models and Browser Tools act on. A timeout passed to a single call, and later `setDefaultTimeout` or `setDefaultNavigationTimeout` calls, still win, and `0` means no timeout.

## Errors

These fail the build or the dev server. The shared root-less class check follows Page Object Children, not action return types. A root declared in inline decorator options counts, including one inherited from a readable base class in another module. Computed or spread options and unreadable or ambient base classes can prevent proving that a class has no root; the runtime handles those cases.

| Message                                                                                                                                                | When                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Unsupported Page Object Tool input type for <Model>.<method>(<parameter>): <type>. Compiled with <tsconfig>.`                                         | A parameter type the compiler cannot turn into a schema; see [Page Object Models](../guides/page-object-models.md#tool-names-and-inputs). |
| `Page Object Action <Model>.<method> needs identifier parameter names.`                                                                                | A destructured parameter.                                                                                                                 |
| `Page Object Child "<member>" is ambiguous: <classes>.`                                                                                                | A member's type intersects several Page Object Models.                                                                                    |
| `The Page Object class "<Model>" declares no root and …: <paths>.`                                                                                     | The class violates the [root-less class rules](ayme.md#page-object-root).                                                                 |
| `Could not find a tsconfig.json for POM source <file>.`                                                                                                | No tsconfig above the model and no `tsconfigPath`.                                                                                        |
| `Could not read TypeScript project configuration <path>: …`                                                                                            | The tsconfig the compiler found has errors.                                                                                               |
| `Could not read POM source <file>.`                                                                                                                    | The model's file could not be read.                                                                                                       |
| `A Page Object Model needs a class name.`, `Page Object Action in <Model> needs an identifier method name.`                                            | An anonymous class, or an action with a computed name.                                                                                    |
| `Could not transpile Ayme POM <file>: …`                                                                                                               | TypeScript could not compile the model.                                                                                                   |
| `Ayme could not remove Page Object Model <Model> from <file>: it is not a top-level class.`                                                            | In a build without Ayme, a model declared inside another statement, which the plugin cannot replace.                                      |
| `report must be "none", "unsupported" or "all"` (`TypeError`)                                                                                          | A `report` option of another value.                                                                                                       |
| `playwright contains unsupported option(s): …`, `playwright.config must be a non-empty string`, and the other `playwright` option checks (`TypeError`) | A malformed `playwright` option; see [Playwright settings](#playwright-settings).                                                         |
| `playwright.project requires an explicit playwright.config path` (`TypeError`)                                                                         | `project` without `config`.                                                                                                               |
| `Could not load Playwright config "<path>": …`                                                                                                         | The config file is missing or failed to load.                                                                                             |
| `Unsupported Playwright config loader …`                                                                                                               | Loading a config needs Playwright 1.62 to 1.64; the installed loader has another version or shape.                                        |
| `Playwright project "<name>" must exist exactly once in <path>; found <count>.`                                                                        | `project` names no project, or several.                                                                                                   |
| `Playwright projects have different supported settings (<fields>).`                                                                                    | Several projects disagree and no `project` was set.                                                                                       |
| `Ayme's Angular plugin has no option(s): …` (`TypeError`)                                                                                              | An unknown Angular plugin option, or the plugin referenced as a plain string.                                                             |
| `Ayme did not compile Page Object Model <file>.`                                                                                                       | The Angular plugin could not compile a model it claimed.                                                                                  |
| `tsconfigPath must be a string`, `include must be a boolean` (`TypeError`)                                                                             | A non-string Angular `tsconfigPath`, or a non-boolean `include`.                                                                          |
| `Ayme's Turbopack loader requires loader dependency tracking.`                                                                                         | The bundler running the loader cannot track dependencies.                                                                                 |
