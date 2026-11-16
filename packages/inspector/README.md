# @ayme-dev/inspector

The in-page panel for [Ayme](https://github.com/ayme-labs/ayme): it shows your page's Page Objects, its Structural Page State and its tools, and lets you run those tools by hand.

## Install

```sh
npm install -D @ayme-dev/inspector
```

## Turn it on

Pass `inspector: true` where Ayme starts, such as `useAyme`, `AymeProvider`, `provideAyme` or `createAyme`:

```ts
useAyme({ inspector: import.meta.env.DEV });
```

The session loads the Inspector when it starts in the browser and unmounts it when it stops. With the option off, the page requests no Inspector code. To show people what an agent does, `inspector: { demo: true }` also pauses before each action and shows where each click lands.

To run it outside the page instead, pass `inspector: { placement: "external" }` and open the URL that `ayme inspect` prints, or that the agent's `ayme_inspect` returns, in a window beside the app. `@ayme-dev/mcp`'s `ayme mcp` serves the Inspector's `./external` build and relays it to the page.

## Documentation

- [Inspector guide](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/inspector.md): the lenses, running tools, the panel and what it never changes.
- [Ayme documentation](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md)

## Supported versions

Any framework Ayme supports; the Inspector bundles its own React. `@playwright/test` 1.29 to 1.64 for the types.

## License

[FSL-1.1-ALv2](https://github.com/ayme-labs/ayme/blob/main/LICENSE)
