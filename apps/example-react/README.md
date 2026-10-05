# React integration smoke app

A counter with one compiled Page Object, running beneath `AymeProvider` in React Strict Mode. It checks the integration without duplicating the Vue inspector demo.

From the workspace root:

```sh
pnpm run build
pnpm --filter @ayme-dev/example-react dev
pnpm --filter @ayme-dev/example-react test:e2e
```

The app works without a WebMCP driver through the direct Page Object button. End-to-end tests install a recording driver, execute a Page Object Tool, and check tool removal and restoration as the counter unmounts and mounts. Another test uses the same POM through real Playwright, and a smoke test opens the Inspector, which the app turns on unless built with `--mode inspector-disabled`, and runs a tool from it. The app turns the Agent Connection (`agentConnection`) on under the same condition, and an MCP client pairs with the page through a connect link and calls a tool.

See the [React page](../../docs/guide/frameworks/react.md) for setup and lifecycle rules.
