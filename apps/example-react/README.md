# React integration smoke app

A counter with one compiled Page Object, running beneath `AymeProvider` in React Strict Mode. It checks the integration without duplicating the Vue inspector demo.

From the workspace root:

```sh
pnpm run build
pnpm --filter @ayme-dev/example-react dev
pnpm --filter @ayme-dev/example-react test:e2e
```

The app works without a WebMCP driver through the direct Page Object button. End-to-end tests run the shared [example certification](../example-certification/README.md) with its recording driver, as a single-page app against the dev server and the production build (`test:e2e:dev`, `test:e2e:prod`). A StrictMode test checks that each tool is published once, and a smoke test opens the Inspector, which the app turns on unless built with `--mode inspector-disabled`, and runs a tool from it. The app turns the Agent Connection (`agentConnection`) on under the same condition, and an MCP client pairs with the page through a connect link and calls a tool. The counter adds the Peek `counter` with `usePeek`, which the client reads before and after an increment and sees go when the counter unmounts.

See the [React page](../../docs/guide/frameworks/react.md) for setup and lifecycle rules.
