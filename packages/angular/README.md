# @ayme-dev/angular

Angular integration for Ayme: start Ayme in the application config and use Page Objects inside components. It supports Angular `>=19.0.0 <23.0.0`, standalone applications, client-rendered and server-rendered with hydration.

## Install and configure

```sh
ng add @ayme-dev/angular
```

Packages are not published yet; use supplied tarballs before release. `ng add` installs `@ayme-dev/ayme`, and as dev dependencies `@ayme-dev/unplugin-ayme`, the `@angular-builders/custom-esbuild` major that matches your Angular major, and `@playwright/test` for the types Page Object Models use, unless the project already has it. It switches the project's build and serve builders to custom-esbuild, keeping their options, adds Ayme's plugin, writes the one-line plugin file and adds `provideAyme()` to the application config. It leaves bundle budgets alone; see [Bundle size](#bundle-size). When your app uses another custom builder or bootstraps an NgModule, it changes only what it can change safely and prints the remaining steps.

### Manual setup

```sh
npm install @ayme-dev/ayme @ayme-dev/angular
npm install -D @ayme-dev/unplugin-ayme @angular-builders/custom-esbuild@^22 @playwright/test@~1.62.1
```

Install the `@angular-builders/custom-esbuild` major that matches your Angular major. Then set up the plugin as the [build integration README](https://github.com/ayme-labs/ayme/blob/main/packages/unplugin-ayme/README.md#angular-setup) describes: a one-line `ayme.plugin.mjs` at the workspace root, and in `angular.json` the custom-esbuild builders with the plugin entry, keeping the existing options:

```jsonc
"build": {
  "builder": "@angular-builders/custom-esbuild:application",
  "options": {
    // ...the existing options...
    "plugins": [{ "path": "./ayme.plugin.mjs", "options": { "tsconfigPath": "tsconfig.app.json" } }]
  }
},
"serve": { "builder": "@angular-builders/custom-esbuild:dev-server" }
```

Finally add `provideAyme()` to the application config, as shown below.

## Use

Start Ayme once in the application config:

```ts
import { ApplicationConfig } from "@angular/core";
import { provideAyme } from "@ayme-dev/angular";

export const appConfig: ApplicationConfig = {
  providers: [provideAyme({ webMCP: { enabled: true } })],
};
```

In a component, `injectPageObject(Model)` returns the Page Object and `injectAyme()` returns `{ ayme, webMCP }`:

```ts
import { Component } from "@angular/core";
import { injectAyme, injectPageObject } from "@ayme-dev/angular";
import { CounterPage } from "../../playwright/pom/CounterPage";

@Component({
  selector: "app-counter",
  template: `
    <p>Publication: {{ webMCP.publicationStatus().state }}</p>
    <button (click)="pom.increment()">Call Page Object</button>
    <button (click)="webMCP.retryPublication()">Retry publication</button>
  `,
})
export class Counter {
  protected readonly pom = injectPageObject(CounterPage);
  protected readonly webMCP = injectAyme().webMCP;
}
```

## API

| Function                  | Returns                | Behavior                                                                                                                                                                                                                                                                      |
| ------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provideAyme(options?)`   | `EnvironmentProviders` | Starts Ayme with the environment injector that receives it, before the root component is created, and stops it when that injector is destroyed.                                                                                                                               |
| `injectAyme()`            | `{ ayme, webMCP }`     | `ayme` is the [runtime session](https://github.com/ayme-labs/ayme/blob/main/packages/ayme/README.md#runtime-session): `ayme.tools.run(name, input)` runs any live tool. `webMCP.publicationStatus` is a read-only signal and `webMCP.retryPublication()` retries publication. |
| `injectPageObject(Model)` | the Page Object        | Registers the class with the session and returns its instance; its Page Object Tools stay registered until the caller is destroyed: component destruction, `@if` removal and router navigation all end it.                                                                    |

`provideAyme` takes the options of `createAyme` (`AymeOptions`) and passes them through unchanged:

- `pageFactory`: builds the browser Page; called once, lazily, in the browser. Use `() => createPage({ testIdAttribute, actionTimeout, navigationTimeout })` from `@ayme-dev/ayme` for Playwright settings.
- `ignore`: keeps matching elements out of the Structural Page State.
- `customTools` and `goalLoop`: as described in the [main library README](https://github.com/ayme-labs/ayme/blob/main/packages/ayme/README.md).
- `webMCP.enabled`: publication is off, with status `disabled`, unless it is `true`.
- `webMCP.toolNamePrefix`: prefixes every published tool name.

The status signal updates templates in zone and zoneless apps. `retryPublication()` publishes once a WebMCP driver that appeared after Ayme's initial wait is available.

`injectAyme` and `injectPageObject` need an injection context, such as a field initializer or a constructor, and `provideAyme` in an ancestor injector. Each says so when it is missing: outside an injection context Angular throws NG0203, and without `provideAyme` they throw "Ayme requires provideAyme() in an ancestor injector.".

### Root only

Put `provideAyme` in the application config, not in route providers. The router does not destroy a route's environment injector on navigation, so an owner there would outlive its route. One application owns Ayme per document: `provideAyme` beneath another `provideAyme` throws, and so does a second application that starts Ayme while the first runs.

## Page Object Models

Page Object Models are authored as for React and Vue, with `@ayme` and `@ayme.action`; see the [main library README](https://github.com/ayme-labs/ayme/blob/main/packages/ayme/README.md). Keep each in its own `.ts` file; new Angular workspaces already enable `experimentalDecorators`. They use Playwright's `Page` and `Locator` types from `@playwright/test`, which `ng add` installs. Import them with relative paths or through tsconfig `paths` aliases, and share them with your Playwright tests. A Page Object Model inside `node_modules` is not compiled. A model the plugin did not compile fails at `injectPageObject` in the browser with the runtime's "no compiler-derived Ayme metadata" error.

During `ng serve`, editing a type a Page Object Model imports updates its tool schema after a reload, without restarting the server.

## Server rendering

With Angular SSR, server rendering returns your ordinary UI. On the server `provideAyme` creates a runtime session per request but never starts it, `injectPageObject` returns an unconstructed object with the model's prototype and registers nothing, and `webMCP.publicationStatus` holds the initial status (`waiting` when publication is on, `disabled` when off), so the hydrated text matches. Do not read locator fields or run Page Object actions while rendering on the server; `ayme.tools.run` throws there and `ayme.tools.list()` is empty. Hydration creates the real Page Objects in the browser. The plugin skips the server bundles.

## Bundle size

Ayme adds about 240 kB transferred (about 900 kB raw) to the initial chunk of a production build. That trips Angular's default 500 kB initial-budget warning, and a blank application then sits just under the default 1 MB `maximumError`, so most applications need a higher error budget. `ng add` leaves budgets to you: raise `maximumError` of the `initial` budget under `configurations.production.budgets` in `angular.json`.

## Supported versions and limits

`@ayme-dev/angular` declares `@angular/core` `>=19.0.0 <23.0.0`. It is tested on Angular 19.0.0 and on the current major. The [example app's limits](https://github.com/ayme-labs/ayme/blob/main/apps/example-angular/README.md#limits) list what is not certified, including NgModule apps, route-level `provideAyme`, `@defer` and incremental hydration, Nx workspaces and the Inspector.
