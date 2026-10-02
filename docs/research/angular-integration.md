# Angular integration, build extension and minimum versions

Research for #227 "Research Angular integration, build extension, and minimum versions" (map #225 "Specify Angular support for Ayme"). It proposes an Angular SPA and SSR integration against the alpha consumer API of #250 "Spec: alpha consumer API (packages, decorators, setup, tool names)", not against the names in today's code.

Sources were read and probes run on 2026-10-02. "Authority" marks each source as **docs** (official documentation), **implementation** (shipped package code, cited by exact version), **ayme** (this repository at the commit below) or **probe** (a run recorded in this file). A claim marked _inferred_ follows from the cited code but was not run.

## Baseline

- Ticket baseline: `95c789356823b1d146357b7c89079e7de51b6a92`. Worked on: upstream main `a94a159081c33fcc33071c713ee03e9b80ad0d5c` ("refactor!: rename the packages to the alpha names").
- Drift that matters here: package names are already the alpha names (`@ayme-dev/ayme`, `@ayme-dev/unplugin-ayme`, ...). The decorators are still `@WebMCP`/`@WebMCP.tool`, the runtime options are still `page` and `refTools`, and publication is still the build constant `__AYME_WEBMCP_PUBLISH__`. The probes therefore set that constant as a stand-in for `webMCP.enabled: true`. The runtime-decided publication path of #250 is **not** exercised by any probe.
- Playwright Lite pin: `github:ayme-labs/playwright-lite#e95ea4b7cadd62ff4f6d74a5101506e7e855a899`.

## Answer in brief

1. **Runtime adapter.** A new package `@ayme-dev/angular` (name confirmed) with three functions: `provideAyme(options)` for the application's environment providers, `injectAyme()` returning `{ ayme, webMCP }`, and `injectPageObject(Model)` returning the Page Object directly. It is plain functions over `createRuntimeSession`; it declares no Angular components or decorators, so it builds with tsdown like the Vue and React packages (no ng-packagr, no Angular linker). A prototype of exactly this shape passed dev and production SSR probes on Angular 17.1.0, 19.0.0, 20.0.0 and 22.2.1.
2. **Build integration.** The standard Angular CLI builder `@angular/build:application` has **no** plugin option, and its use of Vite does not give access to Vite plugins. Ayme's compiler can be carried by an esbuild code plugin passed through the builder's programmatic `codePlugins` extension. Consumers reach that extension through the community builder **`@angular-builders/custom-esbuild`**, which replaces `@angular/build:application` and `:dev-server` in `angular.json`. **This is a nonstandard-builder requirement and needs explicit acceptance.** The plugin ships as `@ayme-dev/unplugin-ayme/angular`.
3. **Versions.** API availability puts the adapter floor at Angular 17.0 and the build floor at 17.1. Probes passed on 17.1.0, 19.0.0, 20.0.0 and 22.2.1. On 2026-10-02 the user chose "the lowest we can easily support": **19.0.0**, the first version where a consumer needs no workarounds and the adapter needs no deprecated API. Angular 17 to 19 are no longer maintained upstream. See [Versions](#versions).

## Facts

1. The application builder's schema has no `plugins` option. Its options at 22.2.1 are `allowedCommonJsDependencies aot appShell assets baseHref browser budgets clearScreen conditions crossOrigin define deleteOutputPath deployUrl externalDependencies extractLicenses fileReplacements i18nDuplicateTranslation i18nMissingTranslation index inlineStyleLanguage loader localize namedChunks optimization outputHashing outputMode outputPath poll polyfills prerender preserveSymlinks progress scripts security server serviceWorker sourceMap ssr statsJson stylePreprocessorOptions styles subresourceIntegrity tsConfig verbose watch webWorkerTsConfig` ([schema.json](https://unpkg.com/@angular/build@22.2.1/src/builders/application/schema.json)). Authority: implementation.
2. `@angular/build` exports `buildApplication(options, context, extensions?)` with `ApplicationBuilderExtensions { codePlugins?: Plugin[]; indexHtmlTransformer? }`, and `executeDevServerBuilder(options, context, extensions?)` with `{ buildPlugins?, middleware?, indexHtmlTransformer? }`. Both are documented "@experimental Direct usage of this function is considered experimental." ([index.d.ts](https://unpkg.com/@angular/build@22.2.1/src/index.d.ts), [application/index.d.ts L23](https://unpkg.com/@angular/build@22.2.1/src/builders/application/index.d.ts), [application/options.d.ts L28-L31](https://unpkg.com/@angular/build@22.2.1/src/builders/application/options.d.ts), [dev-server/builder.d.ts L23-L29](https://unpkg.com/@angular/build@22.2.1/src/builders/dev-server/builder.d.ts)). Authority: implementation.
3. Code plugins are appended **after** Angular's compiler plugin: `buildOptions.plugins.push(createWasmPlugin(...), createAngularLocalizeInitWarningPlugin(), createCompilerPlugin(...)); if (options.plugins) buildOptions.plugins.push(...options.plugins);` ([application-code-bundle.js L63-L71](https://unpkg.com/@angular/build@22.2.1/src/tools/esbuild/application-code-bundle.js), same pattern for the server bundles at L257 and L356; `codePlugins` become `plugins` at [options.js L315](https://unpkg.com/@angular/build@22.2.1/src/builders/application/options.js)). Authority: implementation.
4. Angular's compiler plugin registers `build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, ...)` with no namespace and serves every TypeScript file from its own program's emit ([compiler-plugin.js L356-L420](https://unpkg.com/@angular/build@22.2.1/src/tools/esbuild/angular/compiler-plugin.js)). It registers no `onResolve`. Because esbuild runs `onLoad` callbacks in plugin order, a later plugin's `.ts` `onLoad` never runs for program files. Authority: implementation; confirmed by probe 1.
5. In watch mode Angular watches esbuild metafile inputs plus its own load-cache `watchFiles`; it does not read `watchFiles` returned by other plugins' `onLoad` ([bundler-context.js L204-L230](https://unpkg.com/@angular/build@22.2.1/src/tools/esbuild/bundler-context.js)). Authority: implementation.
6. `ng serve` prebundles third-party dependencies with Vite. The builder's `define` option is passed to that prebundle ([dev-server/vite/index.js L63-L74, L324](https://unpkg.com/@angular/build@22.2.1/src/builders/dev-server/vite/index.js), [tools/vite/utils.js L33-L44](https://unpkg.com/@angular/build@22.2.1/src/tools/vite/utils.js)). A define written into esbuild's `initialOptions` by a code plugin is not. Authority: implementation; confirmed by probe 2.
7. `buildApplication(options, context, plugins?: Plugin[])` exists in `@angular-devkit/build-angular@17.0.0`; the `extensions?: ApplicationBuilderExtensions` form arrives in 17.1.0. The 17.0.0 dev server already takes `extensions?: { buildPlugins?, middleware? }` (`src/builders/application/index.d.ts` and `src/builders/dev-server/builder.d.ts` in [17.0.0](https://unpkg.com/@angular-devkit/build-angular@17.0.0/src/builders/application/index.d.ts) and [17.1.0](https://unpkg.com/@angular-devkit/build-angular@17.1.0/src/builders/application/index.d.ts)). Authority: implementation.
8. `@angular-builders/custom-esbuild` wraps those two functions: it loads plugins listed in `angular.json` and calls `buildApplication(options, context, { codePlugins, indexHtmlTransformer })` and `executeDevServerBuilder(options, context, { buildPlugins, middleware, indexHtmlTransformer })` (`dist/application/index.js`, `dist/dev-server/index.js` in [22.0.1](https://unpkg.com/@angular-builders/custom-esbuild@22.0.1/dist/application/index.js)). Its first release is 17.1.0 (2024-02-15), peer `@angular/compiler-cli ^17.1.0`. Each major pins the matching Angular major (22.0.1: `@angular/build ^22.0.0`). Authority: implementation (npm registry).
9. custom-esbuild resolves a plugin as `path.join(workspaceRoot, pluginConfig)` and imports it with jiti, so a plugin must be a file path inside the workspace, not a package specifier ([load-plugins.js](https://unpkg.com/@angular-builders/custom-esbuild@22.0.1/dist/load-plugins.js), [@angular-builders/common load-module.js](https://unpkg.com/@angular-builders/common@6.0.1/dist/load-module.js)). The `{ path, options }` form that passes options to a plugin factory exists from 19.0.0; 17.1.x and 18.0.0 accept strings only (`PluginConfig` in `dist/custom-esbuild-schema.d.ts`). Authority: implementation; the 17.1.0 string-only schema was hit by probe 3.
10. Angular API boundaries, from the published `@angular/core` and `@angular/platform-browser` declarations: `makeEnvironmentProviders` and `ENVIRONMENT_INITIALIZER` exist in 15.0.0; `DestroyRef` and `assertInInjectionContext` first appear in 16.0.0; `signal` is `@developerPreview` in 16.0.0 and public in 17.0.0; `provideClientHydration` is `@developerPreview` in 16.0.0 and public in 17.0.0; `provideEnvironmentInitializer` first appears in 19.0.0, where `ENVIRONMENT_INITIALIZER` becomes `@deprecated from v19.0.0` (still exported in 22.2.1, `types/core.d.ts` L742-L751). Authority: implementation.
11. The application builder's `define` option first appears in 17.2 (17.1.0 rejects it: "Data path "" must NOT have additional properties(define)"). `prebundle` is not a 17.1.0 dev-server option. Authority: implementation; observed in probe 3.
12. New-project templates: 17.3.0 sets `"moduleResolution": "node"`; 18.0.0 and 19.0.0 set `"bundler"`; 20.0.0 sets `"module": "preserve"`. All set `"experimentalDecorators": true` (`workspace/files/tsconfig.json.template` in `@schematics/angular`). Ayme's packages publish types only through `exports`, so `moduleResolution: node` cannot resolve them (probe 3: `TS2307: Cannot find module '@ayme-dev/ayme'`). Authority: implementation, probe.
13. Angular's support table ([angular.dev/reference/releases](https://angular.dev/reference/releases), read 2026-10-02): `^22.0.0` Active, released 2026-06-03, active ends 2027-06, LTS ends 2028-06; `^21.0.0` LTS, released 2025-11-19, LTS ends 2027-06; `^20.0.0` LTS, released 2025-05-28, LTS ends 2026-11-28. "Angular versions v2 to v19 are no longer supported." Authority: docs.
14. Toolchain requirements ([angular.dev/reference/versions](https://angular.dev/reference/versions)): 17.1.x Node `^18.13.0 || ^20.9.0`, TypeScript `>=5.2.0 <5.4.0`; 20.0.x Node `^20.19.0 || ^22.12.0 || ^24.0.0`, TypeScript `>=5.8.0 <5.9.0`; 21.x TypeScript `>=5.9.0 <6.0.0`; 22.0.x Node `^22.22.3 || ^24.15.0 || ^26.0.0`, TypeScript `>=6.0.0 <6.1.0`. The 22.2.1 CLI refuses Node 24.12.0, the version this repository's `devbox.json` resolves ("The Angular CLI requires a minimum Node.js version of v22.22.3 or v24.15.0 or v26.0.0"). Authority: docs, probe.
15. `@ayme-dev/unplugin-ayme` depends on `unplugin ^3.3.0`, whose `engines.node` is `^20.19.0 || >=22.12.0` (npm registry). The Ayme build integration therefore needs Node 20.19 even where Angular 17 allows Node 18. Authority: implementation.
16. In Ayme, the runtime session touches no module state until `start()`, `construct` returns a prototype-only inert object when `window` is undefined, and a second `start()` in the same document throws "The Ayme runtime already has an active owner." ([runtime.ts](https://github.com/ayme-labs/ayme/blob/a94a159081c33fcc33071c713ee03e9b80ad0d5c/packages/ayme/src/runtime.ts), [registry.ts L115-L137](https://github.com/ayme-labs/ayme/blob/a94a159081c33fcc33071c713ee03e9b80ad0d5c/packages/ayme/src/registry.ts#L115-L137)). Constructing a Page Object whose class was not compiled throws "The imported page object has no compiler-derived Ayme metadata." ([registry.ts L169-L177](https://github.com/ayme-labs/ayme/blob/a94a159081c33fcc33071c713ee03e9b80ad0d5c/packages/ayme/src/registry.ts#L169-L177)). Authority: ayme.
17. In `@angular/build@19.0.0` the dev server prebundles dependencies without the builder's `define`: the probe showed `Publication: disabled` in `ng serve` with `define` set, and `prebundle: { exclude: ["@ayme-dev/ayme"] }` did not change it; `prebundle: false` did. By 20.0.0 `define` reaches the prebundle (Fact 6, probe on 20.0.0). Under #250 publication no longer uses a define, so this affects only the Playwright settings constants, which the proposal moves to `pageFactory`. Authority: probe.
18. The Turbopack loader already packages the shared POM transform plus a TypeScript transpile (ES2022, `experimentalDecorators`) into one JavaScript-returning function, and sets no build constants ([turbopack-loader.ts](https://github.com/ayme-labs/ayme/blob/a94a159081c33fcc33071c713ee03e9b80ad0d5c/packages/unplugin-ayme/src/turbopack-loader.ts), [example-next README](https://github.com/ayme-labs/ayme/blob/a94a159081c33fcc33071c713ee03e9b80ad0d5c/apps/example-next/README.md)). `createPomTransform` itself is not exported. Authority: ayme.

## Probes

All probe sources are in [`angular-integration/probe/`](angular-integration/probe). Each app was generated with the CLI of its version (`ng new <app> --ssr --style=css --skip-git --package-manager=npm --defaults --skip-tests`), then given those files, the packed Ayme tarballs, and the `angular.json` edits listed below. Ayme was packed from `a94a159` with `pnpm pack` in `packages/ayme`, `packages/unplugin-ayme` and `packages/inspector` after `pnpm exec turbo run build` in the repository Devbox. Each run used [`run-probe.sh`](angular-integration/probe/run-probe.sh) inside a probe-specific Devbox environment.

| App  | Angular                         | Builder               | TypeScript | esbuild / Vite   | Node    | Zone               | Result (prod / dev)                                                   |
| ---- | ------------------------------- | --------------------- | ---------- | ---------------- | ------- | ------------------ | --------------------------------------------------------------------- |
| ng17 | core, ssr, build-angular 17.1.0 | custom-esbuild 17.1.0 | 5.3.3      | 0.19.11 / 5.0.11 | 20.19.5 | zone.js 0.14.10    | 2 passed, 1 skipped / 3 passed                                        |
| ng19 | core, ssr, build-angular 19.0.0 | custom-esbuild 19.0.0 | 5.6.3      | 0.24.0 / 5.4.21  | 20.19.5 | zone.js 0.15.1     | 2 passed, 1 skipped / 3 passed (dev with `prebundle: false`, Fact 17) |
| ng20 | core, ssr, build 20.0.0         | custom-esbuild 20.0.0 | 5.8.3      | 0.25.5 / 6.3.5   | 20.19.5 | zone.js 0.15.1     | 2 passed, 1 skipped / 3 passed                                        |
| ng22 | core, ssr, build 22.2.1         | custom-esbuild 22.0.1 | 6.0.3      | 0.28.2 / 8.3.0   | 26.8.1  | zoneless (default) | 2 passed, 1 skipped / 3 passed                                        |

All runs: Playwright 1.62.1, Chromium from `playwright install chromium`, npm, macOS. Devbox could not install `nodejs@24.15.0` or `nodejs@24.19.0` ("Package ... not found") although `devbox search` lists them, so Angular 22 ran on `nodejs@26`.

`angular.json` edits: `build.builder` → `@angular-builders/custom-esbuild:application`; `serve.builder` → `@angular-builders/custom-esbuild:dev-server`; `build.options.plugins` → `[{ "path": "./ayme-esbuild-plugin.mjs", "options": { "tsconfigPath": "tsconfig.pom.json" } }]` (ng17: `["./ayme-esbuild-plugin.17.mjs"]`); `build.options.define` → `{ "__AYME_WEBMCP_PUBLISH__": "true" }` (ng17: passed through the plugin instead, Fact 11, plus `cli.cache.enabled: false` so `ng serve` does not prebundle). Routes render with `RenderMode.Server` (20, 22) or `prerender: false` (17). Angular 22 also needs `security.allowedHosts: ["127.0.0.1"]`, or SSR answers 400. Angular 17 needed `standalone: true` on components and `moduleResolution: "bundler"` ([diff](angular-integration/probe/src/ayme-angular.17.diff)).

The tests are [`integration.spec.ts`](angular-integration/probe/tests/integration.spec.ts) and [`incremental.spec.ts`](angular-integration/probe/tests/incremental.spec.ts), modelled on the Nuxt and Next certification specs:

- With JavaScript disabled, two consecutive requests return the Ayme subtree, `Publication: waiting`, and the Page Object's button. This proves per-request server rendering with an inert Page Object and no browser registration.
- With JavaScript enabled: publication reaches `active`; the published `CounterPage.increment` schema equals the compiled one; a component button calls the Page Object; `executePublishedTool` runs it; `new CounterPage(page)` drives the page from Playwright; unmounting removes the tool and remounting restores it with fresh state; router navigation away removes the tool and back restores it; no page errors, no `NG0xxx` or mismatch console messages. In dev the hydration log must report `hydrated 3 component(s) ... 0 component(s) were skipped`.
- Dev only: editing the type `CounterMode` imported by the POM, while `ng serve` runs, changes the published `setMode` schema after a reload, without restarting the server.

What each probe proves:

- **Probe 1 (ordering).** A plain `onLoad` for `.ts` in a code plugin never runs: the bundle contained Angular's emit (`__decorateClass`) and no `registerCompiledPom`. An `onResolve` that moves a module into a separate namespace is not enough either, because Angular's `onLoad` has no namespace filter. What works: `onResolve` claims a POM module by returning `{ path: file + "?ayme-pom", namespace: "ayme-pom" }`, which Angular's `/\.[cm]?[jt]sx?$/` filter does not match, and the plugin's own `onLoad` returns the compiled JavaScript. Checking `build.initialOptions.platform === "node"` skips the two server bundles, and their output contained no `registerCompiledPom`.
- **Probe 2 (defines).** In `ng serve` a constant set on `initialOptions.define` did not reach the prebundled `@ayme-dev/ayme`, and the page showed `Publication: disabled`. The builder's `define` option did reach it.
- **Probe 3 (lower bound).** Every API and build boundary above holds at 17.1.0 with the adjustments listed. This is the lowest version where custom-esbuild exists.
- **Probe 4 (chosen floor).** 19.0.0 from a fresh `ng new ng19 --ssr --server-routing` passed with the 22.2.1 adapter and components unchanged (`provideEnvironmentInitializer`, standalone by default, `moduleResolution: "bundler"`, plugin options in `angular.json`). Its only deviation is `prebundle: false` in `ng serve`, needed for the stand-in publication constant (Fact 17).
- **Not proven by these probes:** runtime `webMCP.enabled`, `toolNamePrefix` and `customTools`; tsconfig `paths` or other bare-specifier imports of POMs (the probe plugin handled relative imports only); POMs in a prebuilt package; NgModule bootstrap; `provideAyme` in route providers; `@defer` and incremental hydration; `RouteReuseStrategy`; the Inspector; declarations without `skipLibCheck`; Angular 18, 19 and 21; Windows and Linux.

A first version of the plugin claimed any `.ts` file containing `extends`. It pulled the adapter (`T extends object`) into its namespace and transpiled it with TypeScript, outside Angular's compiler. That is harmless for a file without Angular decorators but breaks a component file. The final plugin claims a module only when the transform produced a registration.

## Proposed API

### Packages and setup

| Package                            | Role                                                                    | Install        |
| ---------------------------------- | ----------------------------------------------------------------------- | -------------- |
| `@ayme-dev/ayme`                   | main library                                                            | dependency     |
| `@ayme-dev/angular`                | Angular lifecycle and Page Object integration                           | dependency     |
| `@ayme-dev/unplugin-ayme`          | compiler; Angular entry `@ayme-dev/unplugin-ayme/angular`               | dev dependency |
| `@angular-builders/custom-esbuild` | third-party builder that accepts esbuild plugins, same major as Angular | dev dependency |

`@ayme-dev/angular` peer dependencies: `@angular/core` and `@angular/common` at the chosen floor (`>=19.0.0 <23.0.0`, the floor the user chose), plus the optional `@playwright/test` peer the Vue package already declares.

### `@ayme-dev/angular`

```ts
import type { EnvironmentProviders, Signal } from "@angular/core";
import type {
  AymeRuntimeOptions,
  AymeWebMcpPublicationStatus,
  RuntimeSession,
} from "@ayme-dev/ayme";
import type { PageObjectConstructor } from "@ayme-dev/ayme/internal";

/** The options of createRuntimeSession: pageFactory, ignore, customTools, goalLoop, webMCP. */
export type AymeOptions = AymeRuntimeOptions;

export type AymeWebMCP = {
  /** The session's publication status as a signal; `disabled` unless webMCP.enabled. */
  readonly publicationStatus: Signal<AymeWebMcpPublicationStatus>;
  retryPublication(): Promise<void>;
};

export type AymeSetup = {
  /** The runtime session (createRuntimeSession). */
  readonly ayme: RuntimeSession;
  readonly webMCP: AymeWebMCP;
};

/** Starts Ayme with the environment that receives these providers; stops it when that environment is destroyed. */
export function provideAyme(options?: AymeOptions): EnvironmentProviders;

/** Reads the nearest Ayme setup. Call in an injection context. */
export function injectAyme(): AymeSetup;

/** Returns the Page Object for this injector's lifetime. Call in an injection context. */
export function injectPageObject<T extends object>(
  model: PageObjectConstructor<T>
): T;
```

The type names follow whatever #250 names the session's status type. `webMCP` is the session's `webMCP` member with `publicationStatus` wrapped as a read-only signal, as #250 requires.

Behaviour:

|                    | Browser                                                                                                                                                                                     | Server render                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provideAyme`      | Creates one session per environment injector and starts it eagerly with an environment initializer. Stops it on the injector's `DestroyRef`, which `ApplicationRef.destroy()` triggers.     | Creates one session per request (each request bootstraps a new application), never starts it, touches no module state.                                                                 |
| `injectAyme`       | Returns `{ ayme, webMCP }`; `publicationStatus` follows the session through `subscribe`.                                                                                                    | Returns the same shape; `publicationStatus` holds the initial status, so server and hydrated text agree. `ayme.page` and `ayme.pursueGoal` throw `RuntimeStateError` as they do today. |
| `injectPageObject` | Constructs the real POM through `ayme.construct` and registers it; the caller's `DestroyRef` disposes the registration. Component destroy, `@if` removal and route navigation all reach it. | Returns the inert prototype-only object from `ayme.construct`; no registration.                                                                                                        |

Errors:

| Situation                                                                       | Error                                                                                                           |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `provideAyme` in an injector beneath another `provideAyme`                      | `Error("provideAyme cannot be nested beneath another Ayme runtime owner.")`, matching the React and Vue wording |
| A second Ayme owner in the same document, such as two bootstrapped applications | the runtime's existing `RuntimeStateError("The Ayme runtime already has an active owner.")`                     |
| `injectAyme` or `injectPageObject` with no `provideAyme` above                  | `Error("Ayme requires provideAyme() in an ancestor injector.")`                                                 |
| Either called outside an injection context                                      | Angular's own `NG0203`, through `assertInInjectionContext`                                                      |
| Page Object not compiled (build integration missing or not applied)             | the runtime's existing `RuntimeStateError`, thrown in the browser at `injectPageObject`                         |

No "options must stay fixed" error is needed. Angular providers are evaluated once per injector and have no reactive inputs to change, unlike the React provider's props or Vue's provider component.

Setup (standalone; an NgModule app puts the same `provideAyme(...)` into its root module's `providers`, which accept `EnvironmentProviders`):

```ts
// app.config.ts (shared by browser and server through mergeApplicationConfig)
import { ApplicationConfig } from "@angular/core";
import { provideClientHydration } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import { decisionEndpoint } from "@ayme-dev/ayme";
import { provideAyme } from "@ayme-dev/angular";
import { routes } from "./app.routes";

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideClientHydration(),
    provideAyme({
      goalLoop: decisionEndpoint("/api/decide"),
      webMCP: { enabled: true },
    }),
  ],
};
```

Use:

```ts
import { Component, signal } from "@angular/core";
import { injectAyme, injectPageObject } from "@ayme-dev/angular";
import { CounterPage } from "../../playwright/pom/CounterPage";

@Component({
  selector: "app-counter",
  template: `
    <p role="status">Publication: {{ webMCP.publicationStatus().state }}</p>
    <output>{{ count() }}</output>
    <button (click)="count.set(count() + 1)">Increment</button>
    <button (click)="pom.increment()">Call Page Object</button>
    <button (click)="webMCP.retryPublication()">Retry</button>
  `,
})
export class Counter {
  protected readonly count = signal(0);
  protected readonly pom = injectPageObject(CounterPage);
  protected readonly webMCP = injectAyme().webMCP;
}
```

Option mapping:

| #250 option                               | Angular                                                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pageFactory`                             | `provideAyme({ pageFactory })`; called once, lazily, in the browser. Use it for `createPage({ testIdAttribute, actionTimeout, navigationTimeout })` (see below). |
| `ignore`                                  | `provideAyme({ ignore })`                                                                                                                                        |
| `customTools`                             | `provideAyme({ customTools })`                                                                                                                                   |
| `goalLoop`                                | `provideAyme({ goalLoop })`                                                                                                                                      |
| `webMCP.enabled`, `webMCP.toolNamePrefix` | `provideAyme({ webMCP })`; the status starts `disabled` when off.                                                                                                |
| return `{ ayme, webMCP }`                 | `injectAyme()`                                                                                                                                                   |

Why this shape:

- ADR-0017 asks for matching capabilities and names where the framework permits. Angular's idiom for application-level setup is a `provideX()` function, and for reading it an `injectX()` function. A `useAyme` name would be foreign there. The split mirrors React's `AymeProvider` plus `useAyme()`, and the return shape is identical.
- ADR-0030 (#250): one owner per document. Root setup owns start and cleanup, and Page Object integration owns one registration. The environment injector is Angular's application-root lifetime; a component's `DestroyRef` is its scope lifetime.
- Eager start, not start on first injection, keeps startup in root setup instead of in whichever component injects first (the reason ADR-0016 rejected implicit startup). The environment initializer runs before the root component is created, so the runtime starts before hydration, as Vue's setup does in Nuxt. The probes showed no hydration errors and no skipped components. Starting after first render (`afterNextRender`) was not needed.
- Registration happens at construction, like Vue's `usePageObject`. The runtime decides availability from root reachability (ADR-0019), so registering before the view is attached is safe. A component detached by a custom `RouteReuseStrategy` stays registered but unreachable (_inferred_).
- `provideAyme` belongs at the application root. Route-level `providers` create environment injectors that the router does not destroy on navigation (_inferred_ from Angular's router behaviour; not run), so an owner there would outlive its route. The nesting error covers a route below a root owner.
- Initializer API: from 19.0, `provideEnvironmentInitializer`. With a 17 or 18 floor, the package must use the `ENVIRONMENT_INITIALIZER` token, deprecated since 19 but still exported in 22 (Fact 10). The probe ran the token on 17.1.0 and `provideEnvironmentInitializer` on 20 and 22.
- Zone and zoneless both work: a signal write from the session's listener updates the view in a zone app (17.1, 20.0) and in a zoneless app (22.2.1, the 22 default).

### `@ayme-dev/unplugin-ayme/angular`

```ts
import type { Plugin } from "esbuild";

export type AymeAngularOptions = {
  /** tsconfig the POM compiler reads; relative paths resolve from the workspace root. */
  tsconfigPath?: string;
};

/** esbuild code plugin for Angular's application builder. */
export function aymeAngular(options?: AymeAngularOptions): Plugin;

/** Factory in the shape @angular-builders/custom-esbuild calls with { path, options }. */
export default function aymeAngularPlugin(options?: AymeAngularOptions): Plugin;
```

Consumer setup:

```js
// ayme.plugin.mjs, at the workspace root. custom-esbuild imports plugins by file path only.
export { default } from "@ayme-dev/unplugin-ayme/angular";
```

```jsonc
// angular.json, inside the project's "architect"
"build": {
  "builder": "@angular-builders/custom-esbuild:application",
  "options": {
    // ...the existing @angular/build:application options, unchanged...
    "plugins": [{ "path": "./ayme.plugin.mjs", "options": { "tsconfigPath": "tsconfig.app.json" } }]
  }
},
"serve": { "builder": "@angular-builders/custom-esbuild:dev-server" }
```

Behaviour, carried over from the probe plugin:

- **Claiming.** `onResolve` resolves each import with `build.resolve`, skips `node_modules`, reads `.ts` candidates (the same text gate as the shared transform), runs the shared POM transform, and claims the module only when it registers a POM. It returns `{ path: file + "?ayme-pom", namespace: "ayme-pom" }`, and `onLoad` in that namespace returns the transpiled JavaScript. All other modules, including every Angular component, stay with Angular's compiler. Unlike the probe, it must handle bare specifiers that resolve to workspace files (tsconfig `paths`, which Angular workspaces commonly use).
- **Browser and server.** The transform runs only when `build.initialOptions.platform !== "node"`. The server bundles keep Angular's emit, so SSR gets the plain class, which the adapter never constructs.
- **Settings defines.** It sets no build constants, following the Turbopack loader (Fact 18). The publication constant disappears with #250. For the Playwright settings, use `pageFactory: () => createPage({ testIdAttribute, actionTimeout, navigationTimeout })`, or the builder's `define` option for `__AYME_PLAYWRIGHT_*__`, which reaches both bundles and the dev prebundle (Facts 6 and 11; 17.2+). An Angular `playwright: { config }` option is deferred: it would have to write into the builder's `define`, which a code plugin cannot do.
- **Dependency invalidation.** Proved for a type imported by a POM in dev on all three versions: Angular's watcher sees the change through its TypeScript program, and the rebuild reruns the plugin. Files only Ayme's compiler reads, such as a separate `tsconfig.pom.json`, are not watched (Fact 5; _inferred_, not run). Point `tsconfigPath` at the app's own tsconfig. The compiler parses it with Ayme's TypeScript 6, so a 17.x app tsconfig may need its own POM tsconfig if TypeScript 6 rejects deprecated settings (_inferred_). Each rebuild recompiles claimed POMs, one TypeScript Program each, as the Vite path already does; cache by input mtimes if large apps make that matter.
- **Transpile settings.** Claimed POMs are transpiled with the Turbopack loader's fixed settings (ES2022, `experimentalDecorators`), not the app's tsconfig. Angular templates already enable `experimentalDecorators` (Fact 12).
- **Errors.** Unknown options and a non-string `tsconfigPath` fail with a `TypeError` naming the option, as the Vite plugin does. Compiler diagnostics, including the #250 error for the removed `@WebMCP` decorators, come from the shared transform. Without the plugin, the app builds, and `injectPageObject` throws the runtime's "no compiler-derived Ayme metadata" error in the browser (Fact 16).
- **Built packages.** POMs inside `node_modules` are not compiled, matching the Next rule's `not foreign`.
- **Bundle size.** Ayme with Lite adds about 0.9 MB raw (240 kB transfer) to the initial chunk in a production build, which trips Angular's default 500 kB budget warning. Consumers will see that warning.
- **Inspector.** Not designed. The Vite path injects it through `transformIndexHtml` and a virtual module. Candidate Angular paths are esbuild `inject` from the plugin, custom-esbuild's `indexHtmlTransformer`, or a documented `import` in `main.ts`. #250 story 6 (Inspector without extra setup) is open for Angular.

### Alternatives considered

| Option                                                                                                                                       | Consumer setup                                                                                                                 | Ayme maintenance                                                                                                                                                                                                 | Verdict                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **custom-esbuild + Ayme code plugin** (recommended)                                                                                          | Two builder strings, a `plugins` entry, a one-line plugin file, one dev dependency that tracks the Angular major               | A small esbuild plugin over the shared transform; relies on the experimental `codePlugins` contract through a third party                                                                                        | Smallest working path; probed on 17.1, 19.0, 20.0, 22.2                                                                                                            |
| Ayme-owned builders (`@ayme-dev/unplugin-ayme:application`, `:dev-server`) calling `buildApplication` and `executeDevServerBuilder` directly | Two builder strings, options under one key, no extra file, no third-party package. The builder could also set `define` itself. | Must ship Angular's builder option schema for each supported major (custom-esbuild does this per release), or accept a permissive schema that loses Angular's defaults. Couples Ayme releases to Angular majors. | Revisit if custom-esbuild lags or consumer feedback asks for it                                                                                                    |
| A plain esbuild `onLoad` plugin, or the existing unplugin esbuild adapter                                                                    | n/a                                                                                                                            | n/a                                                                                                                                                                                                              | Does not run for program files (Fact 4, probe 1)                                                                                                                   |
| Standard builder with no plugin                                                                                                              | none                                                                                                                           | none                                                                                                                                                                                                             | Not possible: no extension point (Fact 1). Companion files in the consumer repository are rejected by ADR-0006 (OC2).                                              |
| Vite-based Angular pipelines (AnalogJS)                                                                                                      | Replaces the CLI build                                                                                                         | Would reuse `@ayme-dev/unplugin-ayme/vite`                                                                                                                                                                       | Nonstandard and outside the "standard CLI first" scope; not investigated                                                                                           |
| Webpack builder (`@angular-devkit/build-angular:browser`)                                                                                    | Legacy                                                                                                                         | A webpack loader like the Turbopack one                                                                                                                                                                          | Not the default since 17; not investigated                                                                                                                         |
| Code generation step (`ayme compile` writes a module of `registerCompiledPom` calls that `main.ts` imports)                                  | Standard builder kept; one generated file plus a second watch process beside `ng serve`                                        | A CLI and watch mode                                                                                                                                                                                             | Avoids the builder swap, but is the companion-file option ADR-0006 rejected (OC2), and a stale generated file fails silently in dev. Would need a superseding ADR. |

### Removing the setup hassle

**Decision (user, 2026-10-02): keep the code plugin through custom-esbuild, and make setup one command with `ng add @ayme-dev/angular`.**

- **`ng add @ayme-dev/angular`.** Angular libraries make multi-step setup one command with an `ng-add` schematic ([angular.dev: Schematics for libraries](https://angular.dev/tools/cli/schematics-for-libraries)); `@angular/ssr` and `@angular/material` set themselves up this way. Ayme's schematic would install `@ayme-dev/unplugin-ayme` and the matching `@angular-builders/custom-esbuild` major, switch the two builders, add the plugin entry and the one-line plugin file, and add `provideAyme()` to `app.config.ts`. The consumer then edits nothing by hand. Not probed.
- **Nx workspaces need no builder swap.** Nx's `@nx/angular:application` executor already has a `plugins` option ("A list of ESBuild plugins", `{ path, options }` or a path relative to the workspace root, the same shape custom-esbuild uses) in `@nx/angular@23.2.1` (`dist/src/executors/application/schema.json`). `@nx/angular` had 1.15 M npm downloads in the week to 2026-10-02. The same Ayme plugin file applies. Not probed.

## Versions

### Boundaries

| Requirement                                                                                              | First version | Evidence    |
| -------------------------------------------------------------------------------------------------------- | ------------- | ----------- |
| `makeEnvironmentProviders`, `ENVIRONMENT_INITIALIZER`                                                    | 15.0          | Fact 10     |
| `DestroyRef`, `assertInInjectionContext`                                                                 | 16.0          | Fact 10     |
| `signal` public, `provideClientHydration` public                                                         | 17.0          | Fact 10     |
| Application builder with SSR, code plugins (`buildApplication(..., plugins)`, dev-server `buildPlugins`) | 17.0          | Fact 7      |
| `ApplicationBuilderExtensions`, first custom-esbuild                                                     | 17.1          | Facts 7, 8  |
| Builder `define` option                                                                                  | 17.2          | Fact 11     |
| Template `moduleResolution: "bundler"` (Ayme types resolve without edits)                                | 18.0          | Fact 12     |
| `provideEnvironmentInitializer`; standalone by default; custom-esbuild `{ path, options }`               | 19.0          | Facts 9, 10 |
| Node for `@ayme-dev/unplugin-ayme`                                                                       | 20.19         | Fact 15     |

So the **runtime adapter floor** is 17.0 and the **build integration floor** is 17.1.

### Version history and status

| Angular | Released                        | Node                            | TypeScript | esbuild / Vite in `@angular/build` | Upstream status on 2026-10-02 | Ran here               |
| ------- | ------------------------------- | ------------------------------- | ---------- | ---------------------------------- | ----------------------------- | ---------------------- |
| 17.0.0  | 2023-11-08                      | ^18.13 \|\| ^20.9               | >=5.2 <5.3 | 0.19.5 / 4.5.0                     | unsupported                   | no (no custom-esbuild) |
| 17.1.0  | 2024-01-17                      | ^18.13 \|\| ^20.9               | >=5.2 <5.4 | 0.19.11 / 5.0.11                   | unsupported                   | **yes, passed**        |
| 18.0.0  | 2024-05-22                      | ^18.19.1 \|\| ^20.11.1 \|\| ^22 | >=5.4 <5.5 | 0.21.3 / 5.2.11                    | unsupported                   | no                     |
| 19.0.0  | 2024-11-19                      | ^18.19.1 \|\| ^20.11.1 \|\| ^22 | >=5.5 <5.7 | 0.24.0 / 5.4.11                    | unsupported                   | **yes, passed**        |
| 20.0.0  | 2025-05-28                      | ^20.19 \|\| ^22.12 \|\| ^24     | >=5.8 <5.9 | 0.25.5 / 6.3.5                     | LTS until 2026-11-28          | **yes, passed**        |
| 21.0.0  | 2025-11-19                      | ^20.19 \|\| ^22.12 \|\| ^24     | >=5.9 <6.0 | 0.26.0 / 7.2.2                     | LTS until 2027-06             | no                     |
| 22.2.1  | 2026-09-30 (22.0.0: 2026-06-03) | ^22.22.3 \|\| ^24.15 \|\| ^26   | >=6.0 <6.1 | 0.28.2 / 8.3.0                     | active until 2027-06          | **yes, passed**        |

Release dates are from the npm registry; Node and TypeScript ranges are from Fact 14; esbuild and Vite are the `@angular/build` (or `@angular-devkit/build-angular` for 17) dependency pins.

### Technical compatibility, verification, maintenance and proposal

|                            | 17.1                                                                                                                                               | 19.0                                                                            | 20.0                             | 22.x                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------- |
| Technically compatible     | yes, with `moduleResolution: "bundler"`, `standalone: true`, a plugin file with inline options, the deprecated initializer token, and Node ≥ 20.19 | yes, no app changes beyond setup                                                | yes, no app changes beyond setup | yes, plus `security.allowedHosts` for SSR (an Angular 22 default, not Ayme) |
| Runnable verification here | probe, dev and prod SSR                                                                                                                            | probe, dev and prod SSR (dev with `prebundle: false` for the stand-in constant) | probe, dev and prod SSR          | probe, dev and prod SSR                                                     |
| Upstream maintained        | no                                                                                                                                                 | no (ended 2026-05)                                                              | LTS until 2026-11-28             | active                                                                      |
| Proposed                   | no                                                                                                                                                 | **floor**                                                                       | inside range                     | current lane                                                                |

**Decision (user, 2026-10-02): "the lowest we can easily support" → 19.0.0.**

- 17.1 and 18 work but are not easy: consumers need `moduleResolution: "bundler"` (17), `standalone: true` (17, 18) and a plugin file with inline options (custom-esbuild before 19, Fact 9), the adapter must use the deprecated `ENVIRONMENT_INITIALIZER`, and Ayme's published declarations would have to type-check under TypeScript 5.3 for every Ayme package, tying the main library to #220's TypeScript floor.
- 19.0 is the first version where none of that applies: the CLI template, the adapter and the `angular.json` setup are the same as on 22. It brings TypeScript ≥ 5.5 for Ayme's declarations and Node ≥ 20.19 (unplugin's floor already).
- 19 is no longer maintained upstream (ended 2026-05); 20 leaves LTS on 2026-11-28. Supporting it is Ayme's choice, not Angular's.

Peer range: `@angular/core` and `@angular/common` `>=19.0.0 <23.0.0`. The upper bound is the tested major; widen it when a new major passes the current lane. 21 is inside the range but was not run; the CI lanes below cover the ends only, as the Vue minimum lane does.

## Certification matrix

Fixture: `apps/example-angular`, an SSR app (`outputMode: "server"`, `RenderMode.Server`, `provideClientHydration()`) at the current Angular, built with custom-esbuild and `@ayme-dev/unplugin-ayme/angular`, importing only the public `@ayme-dev/angular`. POMs are shared with Playwright under `playwright/pom`, including an undecorated subclass and a POM imported through a tsconfig `paths` alias.

| Lane               | Angular      | Node          | Runs                                                                         |
| ------------------ | ------------ | ------------- | ---------------------------------------------------------------------------- |
| current dev        | latest 22.x  | ≥ 24.15 or 26 | `ng serve`: all E2E checks below, including invalidation                     |
| current prod       | latest 22.x  | same          | `ng build` then `node dist/<app>/server/server.mjs`: all except invalidation |
| minimum dev + prod | 19.0.0 exact | 20.19.x       | same checks; installs pinned versions, like the Vue 3.2 lane                 |

E2E checks (Playwright, through the recording driver in `@ayme-dev/ayme/testing`):

1. JS disabled, two requests: Ayme subtree, `Publication: disabled` (default) or `waiting` (enabled), Page Object button rendered.
2. Hydration: dev log reports 0 skipped components; no `NG0xxx`, mismatch or page errors.
3. Published schemas equal the POM source, including the subclass and path-alias POMs.
4. Tool calls: `executePublishedTool`, a component button calling the Page Object, and `new CounterPage(page)` from Playwright.
5. Cleanup: `@if` unmount and remount, and router navigation away and back, remove and restore the tools.
6. Publication: off by default (status `disabled`, no tools); on with `toolNamePrefix` (prefixed names); `retryPublication` after a late driver.
7. Dev invalidation: editing a type imported by a POM changes the schema without restarting `ng serve`.

Unit tests in `@ayme-dev/angular`, using `createEnvironmentInjector` and `TestBed` or a bare `bootstrapApplication`: the `{ ayme, webMCP }` shape, signal updates, the nesting error, the missing-provider error, stop on `DestroyRef`, the server platform path (no start, inert POM), and a single owner across two applications. Unit tests for the plugin run esbuild directly with a small fake of Angular's compiler `onLoad` placed first: claiming, the namespace and suffix, platform `node` skip, path aliases, `node_modules` skip, and option errors. The packed-consumer test adds `@ayme-dev/angular`, type-checked at the minimum TypeScript.

Prerequisite: this repository's Devbox Node (24.12.0) cannot run the Angular 22 CLI (Fact 14). The fixture needs a Devbox Node of at least 24.15. Devbox resolved `nodejs@26`, but not 24.15.0 or 24.19.0, on this machine.

## Implementation slices

In dependency order. Each builds on #250's renamed runtime options landing first.

1. **Angular code plugin** in `@ayme-dev/unplugin-ayme/angular`, exporting the shared transform internally, with the plugin unit tests above. Handles path aliases.
2. **`@ayme-dev/angular`**: `provideAyme`, `injectAyme`, `injectPageObject`, unit tests, README, packed-consumer coverage, release-set membership.
3. **`apps/example-angular`** certification fixture with dev and prod E2E, plus the Devbox Node bump it needs.
4. **Minimum lane** at the chosen floor.
5. **`ng add @ayme-dev/angular`** schematic in the Angular package. Start with a short spike against fresh 19.0.0 and 22.x `ng new --ssr` apps: the schematic must edit `angular.json`, create the plugin file and add `provideAyme()` to `app.config.ts`, and say clearly what to do when the app already uses another custom builder or an NgModule bootstrap. Its acceptance check is that the certification fixture can be produced by `ng new` plus `ng add` alone.
6. **Docs**: root README integration list and the shipped `ayme` skill's Angular setup, including the custom-esbuild requirement and the budget warning.
7. **Inspector for Angular**: needs its own short design probe first.

## Unresolved

- Acceptance of the custom-esbuild requirement (third-party, experimental upstream contract). Usage on npm, week to 2026-10-02: `@angular/build` 5.43 M downloads, `@angular-builders/custom-esbuild` 66 k, `@angular-builders/custom-webpack` (the webpack-era sibling) 432 k. Few apps replace the standard builder; among those that do, angular-builders is the established project. If it is not accepted, the alternative is Ayme-owned builders, at the schema maintenance cost above.
- Inspector injection for Angular.
- Watching compiler-only inputs (a separate POM tsconfig) in `ng serve`.
- Angular `ng test` (the Vitest unit-test builder in 21+) with compiled POMs: custom-esbuild has a unit-test builder with `plugins`, not investigated.
