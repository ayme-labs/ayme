# @ayme-dev/angular

The Angular package for [Ayme](https://github.com/ayme-labs/ayme): it starts Ayme in your application config and gives components their Page Objects.

## Install

```sh
ng add @ayme-dev/angular
```

`ng add` installs Ayme and the build plugin, switches the build and serve builders to `@angular-builders/custom-esbuild`, adds the plugin and adds `provideAyme()` to the application config.

## Setup

Install WebMCP publication, which `ng add` leaves out, and turn it on in the application config:

```sh
npm install @ayme-dev/webmcp
```

```ts
import { ApplicationConfig } from "@angular/core";
import { provideAyme } from "@ayme-dev/angular";

export const appConfig: ApplicationConfig = {
  providers: [provideAyme({ webMCP: { enabled: true } })],
};
```

## Peek at component state

While a coding agent or the Inspector is connected, `injectPeek(values, name, id?)` lets the agent read a component's state through the Peek Tool `peek.<name>`:

```ts
import { Component, signal } from "@angular/core";
import { injectPeek } from "@ayme-dev/angular";

@Component({
  selector: "app-counter",
  template: `<button (click)="count.set(count() + 1)">{{ count() }}</button>`,
})
export class Counter {
  protected readonly count = signal(0);

  constructor() {
    injectPeek({ count: this.count }, "counter");
  }
}
```

Each component is one instance of the Peek, under the `id` you pass or one of its own. The agent reads `values` when it asks: a signal is called, and so is each top-level property that is a signal; anything else is read as it was passed. The instance is added in `afterNextRender`, so server rendering adds none, and it is removed when the caller's `DestroyRef` fires. Call it in an injection context. `injectPeek` calls [`ayme.peek`](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/ayme.md#aymepeek), so it does nothing unless `provideAyme` has `agentConnection` or `inspector` on.

## Documentation

- [Quickstart: Angular](https://github.com/ayme-labs/ayme/blob/main/docs/guide/start/quickstart-angular.md): from an empty app to your first Page Object Tool.
- [Angular page](https://github.com/ayme-labs/ayme/blob/main/docs/guide/frameworks/angular.md): manual setup, `provideAyme`, `injectAyme`, `injectPageObject`, `injectPeek`, server rendering, bundle size, limits and API.
- [Ayme documentation](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md)

## Supported versions

Angular 19 to 22, standalone applications, client-rendered or server-rendered with hydration.

## License

[FSL-1.1-ALv2](https://github.com/ayme-labs/ayme/blob/main/LICENSE)
