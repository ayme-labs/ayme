# @ayme-dev/angular

The Angular package for [Ayme](https://github.com/ayme-labs/ayme): it starts Ayme in your application config and gives components their Page Objects.

## Install

```sh
ng add @ayme-dev/angular
```

`ng add` installs Ayme and the build plugin, switches the build and serve builders to `@angular-builders/custom-esbuild`, adds the plugin and adds `provideAyme()` to the application config.

## Setup

Turn publication on in the application config:

```ts
import { ApplicationConfig } from "@angular/core";
import { provideAyme } from "@ayme-dev/angular";

export const appConfig: ApplicationConfig = {
  providers: [provideAyme({ webMCP: { enabled: true } })],
};
```

## Documentation

- [Quickstart: Angular](https://github.com/ayme-labs/ayme/blob/main/docs/guide/start/quickstart-angular.md): from an empty app to your first Page Object Tool.
- [Angular page](https://github.com/ayme-labs/ayme/blob/main/docs/guide/frameworks/angular.md): manual setup, `provideAyme`, `injectAyme`, `injectPageObject`, server rendering, bundle size, limits and API.
- [Ayme documentation](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md)

## Supported versions

Angular 19 to 22, standalone applications, client-rendered or server-rendered with hydration.

## License

[FSL-1.1-ALv2](https://github.com/ayme-labs/ayme/blob/main/LICENSE)
