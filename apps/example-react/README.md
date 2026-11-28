# React integration smoke app

A counter with one compiled Page Object, running beneath `AymeProvider` in React Strict Mode. It checks the integration without duplicating the Vue inspector demo. Its Page Object Models are in `ayme/pom`, imported through `#pom/*`, the alias in the `imports` of `package.json`.

From the workspace root:

```sh
pnpm exec turbo run build --filter='@ayme-dev/example-react^...' --concurrency=50%
pnpm --filter @ayme-dev/example-react dev
pnpm --filter @ayme-dev/example-react test:e2e
```

The app works without a WebMCP driver through the direct Page Object button. End-to-end tests run the shared [example certification](../example-certification/README.md) with its recording driver, as a single-page app against the dev server and the production build, on Playwright (`test:e2e:dev`, `test:e2e:prod`) and on [e2e](https://e2e.com) (`e2e:dev`, `e2e:prod`); Turbo's `test:e2e` task runs both runners. A StrictMode test checks that each tool is published once, and a smoke test opens the Inspector, which the app turns on unless built with `--mode inspector-disabled`, and runs a tool from it. The app turns the Agent Connection (`agentConnection`) on under the same condition, and an MCP client pairs with the page through a connect link and calls a tool. The counter adds the Peek `counter` with `usePeek`, which the client reads before and after an increment and sees go when the counter unmounts.

See the [React page](../../docs/guide/frameworks/react.md) for setup and lifecycle rules.
