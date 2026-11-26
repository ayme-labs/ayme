# React integration smoke app

A counter with one compiled Page Object, running beneath `AymeProvider` in React Strict Mode. It checks the integration without duplicating the Vue inspector demo. Its Page Object Models are in `ayme/pom`, imported through `#pom/*`, the alias in the `imports` of `package.json`.

From the workspace root:

```sh
pnpm exec turbo run build --filter='@ayme-dev/example-react^...' --concurrency=50%
pnpm --filter @ayme-dev/example-react dev
pnpm --filter @ayme-dev/example-react test:e2e
```

The app works without a WebMCP driver through the direct Page Object button. End-to-end tests run the shared [example certification](../example-certification/README.md) with its recording driver, as a single-page app against the dev server and the production build (`test:e2e:dev`, `test:e2e:prod`). A StrictMode test checks that each tool is published once, and a smoke test opens the Inspector, which the app turns on unless built with `--mode inspector-disabled`, and runs a tool from it. An agent reaches the app through WebMCP publication only: the certification checks that it reads the Page Object Tree with `page_objects` and runs a Page Object Tool, in each mode.

See the [React page](../../docs/guide/frameworks/react.md) for setup and lifecycle rules.
