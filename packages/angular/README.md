# @ayme-dev/angular

Angular integration for Ayme: start Ayme in the application config and use Page Objects inside components. Supports Angular `>=19.0.0 <23.0.0`, standalone apps.

## Install and configure

```sh
npm install @ayme-dev/ayme @ayme-dev/angular
npm install -D @ayme-dev/unplugin-ayme @angular-builders/custom-esbuild @playwright/test@~1.62.1
```

Packages are not published yet; use supplied tarballs before release. Install the `@angular-builders/custom-esbuild` major that matches your Angular major.

The standard Angular builder has no plugin option, so Ayme's compiler enters through `@angular-builders/custom-esbuild`. Add a one-line plugin file at the workspace root, because custom-esbuild loads plugins by file path only:

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

## Use

Start Ayme once in the application config:

```ts
import { ApplicationConfig } from "@angular/core";
import { provideAyme } from "@ayme-dev/angular";

export const appConfig: ApplicationConfig = {
  providers: [provideAyme({ webMCP: { enabled: true } })],
};
```

`provideAyme(options)` takes the options of `createRuntimeSession` (`pageFactory`, `ignore`, `customTools`, `goalLoop`, `webMCP`). It starts Ayme before the root component is created and stops it when the application is destroyed.

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

Page Object Models are authored as for React and Vue, with `@ayme` and `@ayme.action`; see the [main library README](https://github.com/ayme-labs/ayme/blob/main/packages/ayme/README.md).
