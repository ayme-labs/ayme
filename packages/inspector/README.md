# @ayme-dev/inspector

The in-page panel for [ayme](https://github.com/ayme-labs/ayme): it shows your page's Page Objects, its Structural Page State and its tools, and lets you run those tools by hand.

## Install

```sh
npm install -D @ayme-dev/inspector
```

## Turn it on

Pass `inspector: true` where ayme starts, such as `useAyme`, `AymeProvider`, `provideAyme` or `createAyme`:

```ts
useAyme({ inspector: import.meta.env.DEV });
```

The session loads the Inspector when it starts in the browser and unmounts it when it stops. With the option off, the page requests no Inspector code. To show people what an agent does, `inspector: { demo: true }` also pauses before each action and shows where each click lands.

On a Session of the `ayme` command, `ayme inspect` opens the Inspector in your default browser, and `ayme mcp` shows it in an Agent App's chat, with nothing in the app; `@ayme-dev/cli` brings it.

## Documentation

- [Inspector guide](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/inspector.md): the lenses, running tools, the panel and what it never changes.
- [ayme documentation](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md)

## Supported versions

Any framework ayme supports; the Inspector bundles its own React. `@playwright/test` 1.29 to 1.64 for the types.

## License

[FSL-1.1-ALv2](https://github.com/ayme-labs/ayme/blob/main/LICENSE). Bundled third-party code keeps its original license; see `THIRD_PARTY_NOTICES.txt` in the package.
