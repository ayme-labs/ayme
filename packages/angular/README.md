# @ayme-dev/angular

Angular integration for Ayme: start Ayme in the application config and use Page Objects inside components. Supports Angular `>=19.0.0 <23.0.0`, standalone apps.

## Install and configure

```sh
ng add @ayme-dev/angular
```

Packages are not published yet; use supplied tarballs before release. `ng add` installs `@ayme-dev/ayme`, and as dev dependencies `@ayme-dev/unplugin-ayme` and the `@angular-builders/custom-esbuild` major that matches your Angular major. It switches the project's build and serve builders to custom-esbuild, keeping their options, adds Ayme's plugin, writes the one-line plugin file and adds `provideAyme()` to the application config. It leaves bundle budgets alone. When your app uses another custom builder or bootstraps an NgModule, it changes only what it can change safely and prints the remaining steps.

### Manual setup

```sh
npm install @ayme-dev/ayme @ayme-dev/angular
npm install -D @ayme-dev/unplugin-ayme @angular-builders/custom-esbuild
```

Install the `@angular-builders/custom-esbuild` major that matches your Angular major. The standard Angular builder has no plugin option, so Ayme's compiler enters through custom-esbuild. Add a one-line plugin file at the workspace root, because custom-esbuild loads plugins by file path only:

```js
// ayme.plugin.mjs
export { default } from "@ayme-dev/unplugin-ayme/angular";
```

Then switch the project's builders in `angular.json`, keeping their existing options:

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

`provideAyme(options)` takes the options of `createRuntimeSession` (`pageFactory`, `ignore`, `customTools`, `goalLoop`, `webMCP`) and passes them through unchanged. It starts Ayme before the root component is created and stops it when the application is destroyed. Publication is off, with status `disabled`, unless `webMCP.enabled` is `true`; `webMCP.toolNamePrefix` prefixes every published tool name.

Put `provideAyme` in the application config, not in route providers. The router does not destroy a route's environment injector on navigation, so an owner there would outlive its route. One application owns Ayme per document: `provideAyme` beneath another `provideAyme` throws, and so does a second application that starts Ayme while the first is running.

In a component, `injectPageObject(Model)` returns the Page Object, whose tools stay registered until the component is destroyed, and `injectAyme()` returns `{ ayme, webMCP }`:

```ts
import { Component } from "@angular/core";
import { injectAyme, injectPageObject } from "@ayme-dev/angular";
import { CounterPage } from "../../playwright/pom/CounterPage";

@Component({
  selector: "app-counter",
  template: `
    <p>Publication: {{ webMCP.publicationStatus().state }}</p>
    <button (click)="pom.increment()">Call Page Object</button>
  `,
})
export class Counter {
  protected readonly pom = injectPageObject(CounterPage);
  protected readonly webMCP = injectAyme().webMCP;
}
```

`webMCP.publicationStatus` is a read-only signal, so templates follow it in zone and zoneless apps; `webMCP.retryPublication()` retries after a WebMCP driver becomes available. Both functions need an injection context and `provideAyme` in an ancestor injector, and say so when either is missing. A Page Object Model the build plugin did not compile fails at `injectPageObject` in the browser.

Page Object Models are authored as for React and Vue, with `@ayme` and `@ayme.action`; see the [main library README](https://github.com/ayme-labs/ayme/blob/main/packages/ayme/README.md).

## Server rendering

With Angular SSR, server rendering returns your ordinary UI. On the server `provideAyme` creates a runtime session per request but never starts it, `injectPageObject` returns an unconstructed object with the model's prototype and registers nothing, and `webMCP.publicationStatus` holds the initial status (`waiting` when publication is on, `disabled` when off), so the hydrated text matches. Do not read locator fields or run Page Object actions while rendering on the server; `ayme.page` and `ayme.pursueGoal` throw there. Hydration creates the real Page Objects in the browser. The plugin skips the server bundles.
