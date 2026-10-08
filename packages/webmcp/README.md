# @ayme-dev/webmcp

Publishes an Ayme session's tools through WebMCP, for agents that run in the browser and read the page's `document.modelContext`.

## Setup

Install the package beside `@ayme-dev/ayme`, which declares it as an optional peer dependency:

```sh
npm install @ayme-dev/webmcp
```

Turn publication on where Ayme starts, with `webMCP: { enabled: true }`: `AymeProvider` in Vue and React, `useAyme` in Svelte, `provideAyme` in Angular, or `createAyme`:

```ts
const ayme = createAyme({ webMCP: { enabled: true } });
```

While the session is started in the browser, it loads this package and keeps the published tools in step with the page; `ayme.webMCP` reports where publication stands. With the option off, the page requests none of its code. You never import this package yourself.

The [Publish tools guide](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/publish-tools.md) covers the options, giving the page a WebMCP driver, and the publication status.

## Testing

`@ayme-dev/webmcp/testing` holds a recording WebMCP driver for Playwright tests: `recordPublishedTools` installs it in a browser context, and `waitForPublishedTool`, `publishedToolNames`, `publishedToolSchema` and `executePublishedTool` read and call what the session published. Only test files may import it.
