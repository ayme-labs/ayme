# Troubleshooting

The common reasons an Ayme setup fails, by what you see.

## The build fails

- **`Unsupported Page Object Tool input type for …`**: an action takes a parameter type the compiler cannot describe, such as an array. [Page Object Models](guides/page-object-models.md#tool-names-and-inputs) lists the supported types.
- **`… is marked with @WebMCP, which was replaced by @ayme`**: rename the decorators to `@ayme` and `@ayme.action`.
- **`Could not find a tsconfig.json for POM source …`**: the Page Object Model is outside every tsconfig. Add one, or pass `tsconfigPath` to the [build plugin](reference/build-plugin.md).
- **Angular's `maximumError` budget fails**: Ayme adds about 240 kB transferred to the initial chunk. Raise the `initial` budget; see [Angular](frameworks/angular.md#bundle-size).
- **`Unsupported Playwright config loader version …`**: loading a Playwright config through `playwright.config` needs `@playwright/test` 1.62. Remove `config` and pass `use` values directly, or upgrade.

## A Page Object has no tools

- **`The imported page object has no compiler-derived Ayme metadata`**: the build plugin did not compile the class. Check that it is marked `@ayme`, lives in a `.ts` file the app imports, and that `experimentalDecorators` is on. On Vite 8 with your own `oxc` or `esbuild` settings, see the [build plugin reference](reference/build-plugin.md#vite). A subclass in a file without `@ayme` needs a bundler content filter that matches it; see [What it compiles](reference/build-plugin.md#what-it-compiles).
- **The tool is not in `ayme.tools.list()`**: the class is not registered, or its Page Object Root is not on the page or not available. A child model needs a `root`.
- **A Svelte decorator in a `.svelte` file is ignored**: Page Object Models must be `.ts` modules.
- **Editing a type an action uses does not change its schema** with Angular: reload the page.

## Agents see no tools

- **The publication status is `disabled`**: pass `webMCP: { enabled: true }` where Ayme starts. See [Publish tools](guides/publish-tools.md).
- **The status is `unavailable`**: no WebMCP driver appeared within two seconds. Load the polyfill or enable Chrome's flag before your app's entry module, or call `retryPublication()` once it is there.
- **The status is `failed`**: most often two published tools share a name, such as a Custom Tool named like a Page Object Tool, or the WebMCP driver rejected a registration. The message says which.
- **The agent lists no source**: check that the relay scripts load, the relay runs, and its `--widget-origin` matches the page's origin, port included. From a non-local origin, allow Chrome's local network access prompt. See [Connect an agent](guides/connect-an-agent.md).
- **The tools have unexpected names**: `webMCP.toolNamePrefix` is set; agents and the testing entry see the prefixed names.

## Ayme starts twice

- **`The Ayme runtime already has an active owner`**, or a framework's nested-owner error: start Ayme once, at the app's root. In SvelteKit, only the root `+layout.svelte` may call `useAyme(options)`; in Angular, put `provideAyme` in the application config, not in route providers.

[Errors](reference/errors.md) lists every message with its cause.
