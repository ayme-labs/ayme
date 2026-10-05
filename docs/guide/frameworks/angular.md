# Angular

Everything about Ayme in an Angular app: `ng add` and manual setup, starting Ayme in the application config, Page Objects in components, server rendering, bundle size, limits and the API of `@ayme-dev/angular`.

## Install and configure

```sh
ng add @ayme-dev/angular
```

`ng add` installs `@ayme-dev/ayme`, and as dev dependencies `@ayme-dev/unplugin-ayme`, the `@angular-builders/custom-esbuild` major that matches your Angular major, and `@playwright/test` for the types Page Object Models use. It switches the project's build and serve builders to custom-esbuild, keeping their options, adds Ayme's plugin, writes the one-line plugin file and adds `provideAyme()` to the application config. It leaves bundle budgets alone; see [Bundle size](#bundle-size). When your app uses another custom builder or bootstraps an NgModule, it changes only what it can change safely and prints the remaining steps.

### Manual setup

```sh
npm install @ayme-dev/ayme @ayme-dev/angular
npm install -D @ayme-dev/unplugin-ayme @angular-builders/custom-esbuild @playwright/test
```

Install the `@angular-builders/custom-esbuild` major that matches your Angular major. Then set up the plugin as the [build plugin reference](../reference/build-plugin.md#angular) describes: a one-line `ayme.plugin.mjs` at the workspace root, and in `angular.json` the custom-esbuild `application` and `dev-server` builders with the plugin entry, keeping the existing options.

Finally add `provideAyme()` to the application config, as shown below.

## Start Ayme in the application config

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
import { ProjectsPage } from "../../playwright/pom/ProjectsPage";

@Component({
  selector: "app-counter",
  template: `
    <p>Publication: {{ webMCP.publicationStatus().state }}</p>
    <button (click)="pom.createProject('Launch plan')">Show me how</button>
    <button (click)="webMCP.retryPublication()">Retry publication</button>
  `,
})
export class Counter {
  protected readonly pom = injectPageObject(ProjectsPage);
  protected readonly webMCP = injectAyme().webMCP;
}
```

`provideAyme` takes the [`createAyme` options](../reference/ayme.md#createayme) and passes them through unchanged. For Playwright settings, pass `pageFactory: () => createPage({ testIdAttribute, actionTimeout, navigationTimeout })` from `@ayme-dev/ayme`; for the Inspector, `inspector: isDevMode()`. The status signal updates templates in zone and zoneless apps.

`injectAyme` and `injectPageObject` need an injection context, such as a field initializer or a constructor, and `provideAyme` in an ancestor injector; each throws when either is missing.

## Root ownership

Put `provideAyme` in the application config, not in route providers. The router does not destroy a route's environment injector on navigation, so an owner there would outlive its route. One application owns Ayme per document: `provideAyme` beneath another `provideAyme` throws, and so does a second application that starts Ayme while the first runs.

## Page Object Models

Page Object Models are marked with `@ayme` and `@ayme.action`, as [Page Object Models](../guides/page-object-models.md) shows. Keep each in its own `.ts` file; new Angular workspaces already enable `experimentalDecorators`. Import them with relative paths or through tsconfig `paths` aliases, and share them with your Playwright tests. A Page Object Model inside `node_modules` is not compiled. A model the plugin did not compile fails at `injectPageObject` in the browser.

During `ng serve`, editing a type a Page Object Model imports updates its tool schema after a reload, without restarting the server.

## Server rendering

With Angular SSR, keep `provideAyme` in the shared application config; the server config merges it unchanged:

```ts
// src/app/app.config.server.ts
import { mergeApplicationConfig, ApplicationConfig } from "@angular/core";
import { provideServerRendering, withRoutes } from "@angular/ssr";
import { appConfig } from "./app.config";
import { serverRoutes } from "./app.routes.server";

const serverConfig: ApplicationConfig = {
  providers: [provideServerRendering(withRoutes(serverRoutes))],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
```

On the server, `provideAyme` creates a session per request but never starts it, and hydration creates the real Page Objects. The [Angular example](../../../apps/example-angular/README.md) runs this setup, and [Server rendering](../guides/server-rendering.md) says what runs where.

## Bundle size

Ayme adds about 240 kB transferred (about 900 kB raw) to the initial chunk of a production build. That trips Angular's default 500 kB initial-budget warning, and a blank application then sits just under the default 1 MB `maximumError`, so most applications need a higher error budget. `ng add` leaves budgets to you: raise `maximumError` of the `initial` budget under `configurations.production.budgets` in `angular.json`.

## Limits

The supported Angular versions are on [Install](../start/install.md#supported-versions). These are not covered:

- NgModule-bootstrapped apps
- `provideAyme` in route-level providers; see [Root ownership](#root-ownership)
- `ng test` with compiled Page Object Models
- Nx workspaces
- a separate tsconfig for Page Object Models watched during `ng serve`
- Page Object Models inside prebuilt packages
- `@defer` and incremental hydration
- a custom `RouteReuseStrategy`

## Troubleshooting

| Error                                                                                          | Cause                                                       |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `provideAyme cannot be nested beneath another Ayme runtime owner.`                             | `provideAyme` beneath another, such as in route providers.  |
| `Ayme requires provideAyme() in an ancestor injector.`                                         | `injectAyme` or `injectPageObject` without `provideAyme`.   |
| `Ayme needs an Angular application project; …`                                                 | `ng add` ran in a workspace without an application project. |
| `Ayme could not read the Angular major from the @angular/core dependency in package.json (…).` | `ng add` found no readable `@angular/core` version.         |
| A production build fails the `initial` budget                                                  | See [Bundle size](#bundle-size).                            |

## API

| Function                  | Returns                | Behavior                                                                                                                                                                                                   |
| ------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provideAyme(options?)`   | `EnvironmentProviders` | Starts Ayme with the environment injector that receives it, before the root component is created, and stops it when that injector is destroyed.                                                            |
| `injectAyme()`            | `{ ayme, webMCP }`     | `ayme` is the [session](../reference/ayme.md). `webMCP.publicationStatus` is a read-only signal.                                                                                                           |
| `injectPageObject(Model)` | the Page Object        | Registers the class with the session and returns its instance; its Page Object Tools stay registered until the caller is destroyed: component destruction, `@if` removal and router navigation all end it. |
